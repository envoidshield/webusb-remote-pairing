import { parseNcmTransfer, buildNcmTransfer, resetNcmSequence, setNcmDebugLog } from './ncm'
import { parseEthernet, buildEthernet, ETHERTYPE_IPV6, macToString, solicitedNodeMac } from './ethernet'
import {
    parseIPv6, buildIPv6, skipExtensionHeaders, IPPROTO_TCP, IPPROTO_UDP, IPPROTO_ICMPV6,
    ICMPV6_NEIGHBOR_SOLICITATION, ICMPV6_NEIGHBOR_ADVERTISEMENT, ipv6ToString, ipv6LinkLocalFromMac,
    solicitedNodeAddress, buildNeighborSolicitation, parseNeighborAdvertisement, icmpv6Checksum, setIpv6DebugLog,
} from './ipv6'
import { parseMdns, findRemotePairingService, listAllServices, RemotePairingService, setMdnsDebugLog } from './mdns'
import { parseTcp, TcpConnection, TcpState, setTcpDebugLog } from './tcpstack'
import { Http2Connection, setHttp2DebugLog } from './xhttp'
import { RemoteXpcConnection, setXpcDebugLog, parseRsdHandshake } from './remotexpc'
import { ControlChannel } from './pairing/channel'
import { setupNewPairingGetHostKey } from './pairing/remotePair'
import {
    getOrCreateSelfIdentity, saveTrustRecord, buildTrustRecordPlist, SelfIdentity,
} from './pairing/record'
import { claimCdcNcmInterface, releaseCdcNcmInterface, getAuthorizedAppleDevice } from './usb-claim'
import type { PairDeviceOptions, PairingPhase, PairingProgress, TrustRecord } from './types'

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
}

export class RemotePairingSession {
    private opts: PairDeviceOptions
    private phase: PairingPhase = 'idle'
    private device: USBDevice | null = null
    private reading = false
    private epIn = 8
    private epOut = 6
    private claimedIface = -1

    private ourMac = new Uint8Array([0x02, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE])
    private ourIpv6 = ipv6LinkLocalFromMac(new Uint8Array([0x02, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE]))

    private deviceMac: Uint8Array | null = null
    private deviceIpv6Addr: Uint8Array | null = null
    private resolvedDeviceMac: Uint8Array | null = null

    private remotePairingSvc: RemotePairingService | null = null
    private mdnsCollected = false

    private tcpConn: TcpConnection | null = null
    private http2Conn: Http2Connection | null = null
    private xpcConn: RemoteXpcConnection | null = null
    private tcpConnections: TcpConnection[] = []

    private pairTcpConn: TcpConnection | null = null
    private pairHttp2Conn: Http2Connection | null = null
    private pairXpcConn: RemoteXpcConnection | null = null

    private rsdUdid: string | null = null
    private tunnelPort: number | null = null
    private pairingStarted = false
    private pairAfterInit = false
    private pairingInProgress = false

    private pairResolve: ((r: TrustRecord) => void) | null = null
    private pairReject: ((e: Error) => void) | null = null
    private aborted = false
    private discoverTimer: ReturnType<typeof setTimeout> | null = null

    constructor(options: PairDeviceOptions = {}) {
        this.opts = options
        if (options.debug) {
            const log = (msg: string) => this.emitLog(msg)
            setNcmDebugLog(log)
            setIpv6DebugLog(log)
            setMdnsDebugLog(log)
            setTcpDebugLog(log)
            setHttp2DebugLog(log)
            setXpcDebugLog(log)
        }
        if (options.signal) {
            options.signal.addEventListener('abort', () => this.abort())
        }
    }

    get currentPhase(): PairingPhase {
        return this.phase
    }

    private emitLog(msg: string) {
        if (this.opts.onLog) this.opts.onLog(msg)
    }

    private setPhase(phase: PairingPhase, message?: string) {
        this.phase = phase
        if (this.opts.onProgress) this.opts.onProgress({ phase, message })
    }

    abort() {
        this.aborted = true
        this.reading = false
        this.clearDiscoverTimer()
        if (this.tcpConn) this.tcpConn.close()
        if (this.pairTcpConn) this.pairTcpConn.close()
        void this.cleanupUsb()
        if (this.pairReject) {
            const rej = this.pairReject
            this.pairReject = null
            this.pairResolve = null
            rej(new Error('Pairing aborted'))
        }
    }

    /** Run the full USB → RSD → manual pairing flow. */
    async pair(): Promise<TrustRecord> {
        if (this.phase !== 'idle' && this.phase !== 'complete' && this.phase !== 'error') {
            throw new Error('Session already running')
        }

        return new Promise<TrustRecord>((resolve, reject) => {
            this.pairResolve = resolve
            this.pairReject = reject
            void this.run().catch(reject)
        })
    }

    private finishSuccess(hostKey: string, selfId: SelfIdentity) {
        if (!this.rsdUdid || !this.pairResolve) return
        const rec: TrustRecord = {
            udid: this.rsdUdid,
            hostIdentifier: selfId.identifier,
            privateKey: selfId.privateKey,
            publicKey: selfId.publicKey,
            remoteUnlockHostKey: hostKey,
            plistXml: buildTrustRecordPlist({
                private_key: selfId.privateKey,
                public_key: selfId.publicKey,
                remote_unlock_host_key: hostKey,
            }),
            deviceRecord: {
                private_key: selfId.privateKey,
                public_key: selfId.publicKey,
                remote_unlock_host_key: hostKey,
            },
        }
        this.setPhase('complete', 'Paired')
        this.clearDiscoverTimer()
        this.pairResolve(rec)
    }

    private clearDiscoverTimer() {
        if (this.discoverTimer != null) {
            clearTimeout(this.discoverTimer)
            this.discoverTimer = null
        }
    }

    private async cleanupUsb() {
        const dev = this.device
        const iface = this.claimedIface
        this.device = null
        this.claimedIface = -1
        if (dev) await releaseCdcNcmInterface(dev, iface)
    }

    private rejectPair(msg: string): void {
        this.clearDiscoverTimer()
        this.reading = false
        this.setPhase('error', msg)
        void this.cleanupUsb()
        if (this.pairReject) {
            const rej = this.pairReject
            this.pairReject = null
            this.pairResolve = null
            rej(new Error(msg))
        }
    }

    private fail(msg: string): never {
        this.rejectPair(msg)
        throw new Error(msg)
    }

    private async run() {
        resetNcmSequence()
        this.mdnsCollected = false
        this.remotePairingSvc = null
        this.deviceMac = null
        this.deviceIpv6Addr = null
        this.resolvedDeviceMac = null
        this.tcpConn = null
        this.http2Conn = null
        this.xpcConn = null
        this.pairTcpConn = null
        this.pairHttp2Conn = null
        this.pairXpcConn = null
        this.tcpConnections = []
        this.rsdUdid = null
        this.tunnelPort = null
        this.pairingStarted = false
        this.aborted = false

        this.setPhase('claiming', 'Opening USB device')
        const dev = this.opts.device != null ? this.opts.device : await getAuthorizedAppleDevice()
        if (!dev) this.fail('No authorized Apple USB device — call requestAppleUsbDevice() first')
        this.device = dev

        try {
            if (!dev.opened) await dev.open()
            this.emitLog(`Device: ${dev.productName} (${dev.serialNumber})`)

            const claimed = await claimCdcNcmInterface(dev, m => this.emitLog(m), this.opts.signal)
            this.device = claimed.device
            this.epIn = claimed.epIn
            this.epOut = claimed.epOut
            this.claimedIface = claimed.claimedIface

            this.setPhase('discovering', 'Waiting for _remoted._tcp')
            this.discoverTimer = setTimeout(() => {
                if (this.phase === 'discovering') {
                    this.rejectPair(
                        'No mDNS from the iPhone after claiming CDC-NCM. Unlock the phone, use a data cable, and retry.',
                    )
                }
            }, 45000)
            this.reading = true
            void this.readLoop(claimed.device)
        } catch (e: any) {
            const msg = e && e.message ? e.message : String(e)
            this.rejectPair(msg)
        }
    }

    private sendEthernetFrame(frame: Uint8Array) {
        if (!this.device) return
        const ncm = buildNcmTransfer(frame)
        void this.device.transferOut(this.epOut, ncm).catch((e: any) => this.emitLog(`USB out error: ${e.message}`))
    }

    private sendIPv6Packet(dstMac: Uint8Array, ipv6Packet: Uint8Array) {
        const ethFrame = buildEthernet(dstMac, this.ourMac, ETHERTYPE_IPV6, ipv6Packet)
        this.sendEthernetFrame(ethFrame)
    }

    private async readLoop(dev: USBDevice) {
        while (this.reading && !this.aborted) {
            try {
                const result = await dev.transferIn(this.epIn, 16384)
                if (result.data && result.data.byteLength > 0) {
                    this.processNcmTransfer(result.data)
                }
            } catch (e: any) {
                if (this.aborted || !this.reading) break
                const msg = e && e.message ? e.message : String(e)
                if (/disconnected|cancelled|device not found|The device was disconnected/i.test(msg)) {
                    this.rejectPair(`USB disconnected during pairing: ${msg}`)
                    break
                }
                this.emitLog(`USB in error: ${msg}`)
                await new Promise(r => setTimeout(r, 200))
            }
        }
    }

    private processNcmTransfer(raw: DataView) {
        const block = parseNcmTransfer(raw)
        if (!block) return
        for (const dg of block.datagrams) this.processEthernetFrame(dg.data)
    }

    private processEthernetFrame(data: Uint8Array) {
        const eth = parseEthernet(data)
        if (!eth) return
        if (!this.deviceMac) {
            this.deviceMac = new Uint8Array(eth.srcMac)
            this.emitLog(`Device MAC: ${macToString(this.deviceMac)}`)
        }
        if (eth.ethertype === ETHERTYPE_IPV6) this.processIPv6(eth.payload, eth.srcMac)
    }

    private processIPv6(data: Uint8Array, srcMac: Uint8Array) {
        const ipv6 = parseIPv6(data)
        if (!ipv6) return
        if (!this.deviceIpv6Addr && ipv6.srcAddr[0] === 0xfe && (ipv6.srcAddr[1] & 0xc0) === 0x80) {
            this.deviceIpv6Addr = new Uint8Array(ipv6.srcAddr)
            this.emitLog(`Device IPv6: ${ipv6ToString(this.deviceIpv6Addr)}`)
        }
        const result = skipExtensionHeaders(ipv6.nextHeader, ipv6.payload)
        switch (result.nextHeader) {
            case IPPROTO_UDP: this.processUDP(result.payload); break
            case IPPROTO_ICMPV6: this.processICMPv6(result.payload, ipv6, srcMac); break
            case IPPROTO_TCP: this.processTCP(result.payload); break
        }
    }

    private processUDP(data: Uint8Array) {
        if (data.length < 8) return
        const srcPort = (data[0] << 8) | data[1]
        const dstPort = (data[2] << 8) | data[3]
        if (srcPort === 5353 || dstPort === 5353) this.processMdns(data.slice(8))
    }

    private processMdns(data: Uint8Array) {
        const msg = parseMdns(data)
        if (!msg || this.mdnsCollected) return
        const services = listAllServices(msg)
        if (services.length > 0) this.emitLog(`mDNS: ${services.join('; ')}`)
        const svc = findRemotePairingService(msg)
        if (!svc) return
        this.mdnsCollected = true
        this.remotePairingSvc = svc
        this.clearDiscoverTimer()
        this.emitLog(`Found ${svc.serviceName} at ${ipv6ToString(svc.address)}:${svc.port}`)
        this.sendNeighborSolicitation()
    }

    private processICMPv6(data: Uint8Array, ipv6: ReturnType<typeof parseIPv6>, srcMac: Uint8Array) {
        if (!ipv6 || data.length < 4) return
        if (data[0] === ICMPV6_NEIGHBOR_ADVERTISEMENT) {
            const na = parseNeighborAdvertisement(data)
            if (na && this.phase === 'ndp' && this.remotePairingSvc && arraysEqual(na.targetAddr, this.remotePairingSvc.address)) {
                this.resolvedDeviceMac = new Uint8Array(na.targetMac || srcMac)
                this.emitLog(`NDP resolved: ${macToString(this.resolvedDeviceMac)}`)
                this.startTcpConnection()
            }
        }
        if (data[0] === ICMPV6_NEIGHBOR_SOLICITATION && data.length >= 24) {
            const targetAddr = data.slice(8, 24)
            if (arraysEqual(targetAddr, this.ourIpv6)) this.sendNeighborAdvertisement(ipv6.srcAddr)
        }
    }

    private processTCP(data: Uint8Array) {
        const seg = parseTcp(data)
        if (!seg) return
        for (let i = 0; i < this.tcpConnections.length; i++) {
            const conn = this.tcpConnections[i]
            if (seg.srcPort === conn.dstPort && seg.dstPort === conn.srcPort) {
                conn.handleSegment(seg)
                break
            }
        }
    }

    private sendNeighborSolicitation() {
        if (!this.remotePairingSvc || !this.deviceMac) return
        this.setPhase('ndp', 'Resolving link-layer address')
        const targetAddr = this.remotePairingSvc.address
        const icmpPayload = buildNeighborSolicitation(targetAddr, this.ourMac, this.ourIpv6)
        const dstAddr = solicitedNodeAddress(targetAddr)
        const ipv6Packet = buildIPv6(58, 255, this.ourIpv6, dstAddr, icmpPayload)
        const dstMac = solicitedNodeMac(targetAddr)
        this.sendIPv6Packet(dstMac, ipv6Packet)
        setTimeout(() => {
            if (this.phase === 'ndp' && this.deviceMac) this.sendIPv6Packet(this.deviceMac, ipv6Packet)
        }, 400)
        setTimeout(() => {
            if (this.phase === 'ndp' && this.deviceMac && !this.resolvedDeviceMac) {
                this.resolvedDeviceMac = new Uint8Array(this.deviceMac)
                this.startTcpConnection()
            }
        }, 1200)
    }

    private sendNeighborAdvertisement(dstAddr: Uint8Array) {
        const icmp = new Uint8Array(32)
        icmp[0] = ICMPV6_NEIGHBOR_ADVERTISEMENT
        icmp[4] = 0x60
        icmp.set(this.ourIpv6, 8)
        icmp[24] = 2
        icmp[25] = 1
        icmp.set(this.ourMac, 26)
        const cksum = icmpv6Checksum(this.ourIpv6, dstAddr, icmp)
        icmp[2] = (cksum >> 8) & 0xff
        icmp[3] = cksum & 0xff
        const ipv6Packet = buildIPv6(58, 255, this.ourIpv6, dstAddr, icmp)
        const dstMac = this.deviceMac || new Uint8Array([0x33, 0x33, 0x00, 0x00, 0x00, 0x01])
        this.sendIPv6Packet(dstMac, ipv6Packet)
    }

    private startTcpConnection() {
        if (!this.remotePairingSvc || !this.resolvedDeviceMac) return
        this.setPhase('rsd-tcp', 'Connecting to RSD')
        const dstAddr = this.remotePairingSvc.address
        const dstPort = this.remotePairingSvc.port
        const srcPort = 49200 + Math.floor(Math.random() * 1000)
        const dstMac = this.resolvedDeviceMac
        this.tcpConn = new TcpConnection(this.ourIpv6, dstAddr, srcPort, dstPort, tcpSegment => {
            this.sendIPv6Packet(dstMac, buildIPv6(IPPROTO_TCP, 64, this.ourIpv6, dstAddr, tcpSegment))
        })
        this.tcpConn.log = m => this.emitLog(m)
        this.tcpConn.onConnected = () => this.startHttp2()
        this.tcpConn.onData = data => { if (this.http2Conn) this.http2Conn.feed(data) }
        this.tcpConn.onError = msg => this.rejectPair(msg)
        this.tcpConn.connect()
        this.tcpConnections.push(this.tcpConn)
    }

    private startHttp2() {
        if (!this.tcpConn) return
        this.http2Conn = new Http2Connection(data => {
            if (this.tcpConn && this.tcpConn.state === TcpState.ESTABLISHED) this.tcpConn.send(data)
        })
        this.http2Conn.log = m => this.emitLog(m)
        this.http2Conn.onReady = () => this.startRemoteXpc()
        this.http2Conn.onStreamData[1] = data => { if (this.xpcConn) this.xpcConn.feed(data) }
        this.http2Conn.onStreamData[3] = data => { if (this.xpcConn) this.xpcConn.feed(data) }
        this.http2Conn.start()
    }

    private startRemoteXpc() {
        if (!this.http2Conn) return
        this.setPhase('rsd-handshake', 'RemoteXPC init')
        this.xpcConn = new RemoteXpcConnection((streamId, data) => {
            this.http2Conn!.sendData(streamId, data)
        })
        this.xpcConn.log = m => this.emitLog(m)
        this.xpcConn.onMessage = (parsed) => {
            if (!parsed) return
            const rsd = parseRsdHandshake(parsed)
            if (rsd) {
                this.rsdUdid = rsd.udid
                this.tunnelPort = rsd.tunnelPort
                this.emitLog(`RSD: UDID=${rsd.udid} tunnelPort=${rsd.tunnelPort}`)
                this.beginPairing()
            }
        }
        void this.xpcConn.initialize().catch((e: Error) => this.rejectPair(e.message))
    }

    private beginPairing() {
        if (this.pairingStarted || !this.tunnelPort) return
        this.pairingStarted = true
        this.pairAfterInit = true
        this.startPairingConnection()
    }

    private startPairingConnection() {
        if (!this.tunnelPort || !this.deviceIpv6Addr) return
        this.setPhase('pair-tcp', 'Connecting to untrusted.tunnelservice')
        const dstAddr = this.deviceIpv6Addr
        const dstPort = this.tunnelPort
        const srcPort = 49300 + Math.floor(Math.random() * 1000)
        const dstMac = this.resolvedDeviceMac || this.deviceMac
        if (!dstMac) return

        this.pairTcpConn = new TcpConnection(this.ourIpv6, dstAddr, srcPort, dstPort, tcpSegment => {
            this.sendIPv6Packet(dstMac, buildIPv6(IPPROTO_TCP, 64, this.ourIpv6, dstAddr, tcpSegment))
        })
        this.pairTcpConn.log = m => this.emitLog(m)
        this.pairTcpConn.onConnected = () => this.startPairingHttp2()
        this.pairTcpConn.onData = data => { if (this.pairHttp2Conn) this.pairHttp2Conn.feed(data) }
        this.pairTcpConn.onError = msg => this.rejectPair(msg)
        this.pairTcpConn.connect()
        this.tcpConnections.push(this.pairTcpConn)
    }

    private startPairingHttp2() {
        if (!this.pairTcpConn) return
        this.pairHttp2Conn = new Http2Connection(data => {
            if (this.pairTcpConn && this.pairTcpConn.state === TcpState.ESTABLISHED) this.pairTcpConn.send(data)
        })
        this.pairHttp2Conn.log = m => this.emitLog(m)
        this.pairHttp2Conn.onReady = () => this.startPairingXpc()
        this.pairHttp2Conn.onStreamData[1] = data => { if (this.pairXpcConn) this.pairXpcConn.feed(data) }
        this.pairHttp2Conn.onStreamData[3] = data => { if (this.pairXpcConn) this.pairXpcConn.feed(data) }
        this.pairHttp2Conn.start()
    }

    private startPairingXpc() {
        if (!this.pairHttp2Conn) return
        const afterInit = this.pairAfterInit
        this.pairXpcConn = new RemoteXpcConnection((streamId, data) => {
            this.pairHttp2Conn!.sendData(streamId, data)
        })
        this.pairXpcConn.log = m => this.emitLog(m)
        void this.pairXpcConn.initialize().then(() => {
            if (afterInit) {
                this.pairAfterInit = false
                void this.runPairingCrypto()
            }
        }).catch((e: Error) => this.rejectPair(e.message))
    }

    private async runPairingCrypto() {
        if (this.pairingInProgress || !this.pairXpcConn || !this.rsdUdid) return
        this.pairingInProgress = true
        this.setPhase('pairing', 'Waiting for Trust on device')
        try {
            const channel = new ControlChannel(this.pairXpcConn)
            const selfId = this.opts.identity != null ? this.opts.identity : await getOrCreateSelfIdentity()
            const hostKey = await setupNewPairingGetHostKey(channel, selfId, m => this.emitLog(m))
            if (this.opts.persist !== false) {
                await saveTrustRecord(this.rsdUdid, selfId, hostKey)
            }
            this.finishSuccess(hostKey, selfId)
        } catch (e: any) {
            this.rejectPair(e.message)
        } finally {
            this.pairingInProgress = false
        }
    }
}

export async function pairUsbDevice(options: PairDeviceOptions = {}): Promise<TrustRecord> {
    const session = new RemotePairingSession(options)
    return session.pair()
}
