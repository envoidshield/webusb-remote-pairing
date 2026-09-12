import { parseNcmTransfer, buildNcmTransfer, resetNcmSequence, setNcmDebugLog } from './ncm';
import { parseEthernet, buildEthernet, ETHERTYPE_IPV6, macToString, solicitedNodeMac } from './ethernet';
import { parseIPv6, buildIPv6, skipExtensionHeaders, IPPROTO_TCP, IPPROTO_UDP, IPPROTO_ICMPV6, ICMPV6_NEIGHBOR_SOLICITATION, ICMPV6_NEIGHBOR_ADVERTISEMENT, ipv6ToString, ipv6LinkLocalFromMac, solicitedNodeAddress, buildNeighborSolicitation, parseNeighborAdvertisement, icmpv6Checksum, setIpv6DebugLog, } from './ipv6';
import { parseMdns, findRemotePairingServiceCached, listAllServices, setMdnsDebugLog, } from './mdns';
import { parseTcp, TcpConnection, TcpState, setTcpDebugLog } from './tcpstack';
import { Http2Connection, setHttp2DebugLog } from './xhttp';
import { RemoteXpcConnection, setXpcDebugLog, parseRsdHandshake } from './remotexpc';
import { LockdownConnection } from './lockdown';
import { ControlChannel } from './pairing/channel';
import { setupNewPairingGetHostKey } from './pairing/remotePair';
import { getOrCreateSelfIdentity, saveTrustRecord, buildTrustRecordPlist, } from './pairing/record';
import { claimCdcNcmInterface, releaseCdcNcmInterface, getAuthorizedAppleDevice } from './usb-claim';
import { UsbReselectRequiredError, isUsbReselectRequiredError, isPairingTrustDeniedError, PAIRING_TRUST_DENIED_MSG, } from './errors';
function arraysEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            return false;
    return true;
}
function withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(value => {
            clearTimeout(timer);
            resolve(value);
        }, error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
export class RemotePairingSession {
    constructor(options = {}) {
        this.phase = 'idle';
        this.device = null;
        this.reading = false;
        this.epIn = 8;
        this.epOut = 6;
        this.claimedIface = -1;
        this.ourMac = new Uint8Array([0x02, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE]);
        this.ourIpv6 = ipv6LinkLocalFromMac(new Uint8Array([0x02, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE]));
        this.deviceMac = null;
        this.deviceIpv6Addr = null;
        this.resolvedDeviceMac = null;
        this.remotePairingSvc = null;
        this.mdnsCollected = false;
        this.tcpConn = null;
        this.http2Conn = null;
        this.xpcConn = null;
        this.tcpConnections = [];
        this.pairTcpConn = null;
        this.pairHttp2Conn = null;
        this.pairXpcConn = null;
        this.rsdUdid = null;
        this.tunnelPort = null;
        this.lockdownPort = null;
        this.pairingStarted = false;
        this.pairAfterInit = false;
        this.pairingInProgress = false;
        this.trustEstablished = false;
        this.pairResolve = null;
        this.pairReject = null;
        this.aborted = false;
        this.discoverTimer = null;
        this.usbTrafficSeen = false;
        this.mdnsSrvCache = [];
        this.claimedFallbackConfig = false;
        this.opts = options;
        if (options.debug) {
            const log = (msg) => this.emitLog(msg);
            setNcmDebugLog(log);
            setIpv6DebugLog(log);
            setMdnsDebugLog(log);
            setTcpDebugLog(log);
            setHttp2DebugLog(log);
            setXpcDebugLog(log);
        }
        if (options.signal) {
            options.signal.addEventListener('abort', () => this.abort());
        }
    }
    get currentPhase() {
        return this.phase;
    }
    emitLog(msg) {
        if (this.opts.onLog)
            this.opts.onLog(msg);
    }
    setPhase(phase, message) {
        this.phase = phase;
        if (this.opts.onProgress)
            this.opts.onProgress({ phase, message });
    }
    abort() {
        this.aborted = true;
        this.reading = false;
        this.clearDiscoverTimer();
        if (this.tcpConn)
            this.tcpConn.close();
        if (this.pairTcpConn)
            this.pairTcpConn.close();
        void this.cleanupUsb();
        if (this.pairReject) {
            const rej = this.pairReject;
            this.pairReject = null;
            this.pairResolve = null;
            rej(new Error('Pairing aborted'));
        }
    }
    /** Run the full USB → RSD → manual pairing flow. */
    async pair() {
        if (this.phase !== 'idle' && this.phase !== 'complete' && this.phase !== 'error' && this.phase !== 'needs-reselect') {
            throw new Error('Session already running');
        }
        return new Promise((resolve, reject) => {
            this.pairResolve = resolve;
            this.pairReject = reject;
            void this.run().catch(reject);
        });
    }
    finishSuccess(hostKey, selfId, deviceInfo) {
        if (!this.rsdUdid || !this.pairResolve)
            return;
        const rec = {
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
            deviceInfo,
        };
        this.setPhase('complete', 'Paired');
        this.clearDiscoverTimer();
        this.pairResolve(rec);
    }
    clearDiscoverTimer() {
        if (this.discoverTimer != null) {
            clearTimeout(this.discoverTimer);
            this.discoverTimer = null;
        }
    }
    triggerNeedsReselect() {
        this.clearDiscoverTimer();
        this.reading = false;
        this.setPhase('needs-reselect');
        void this.cleanupUsb();
        if (this.pairReject) {
            const rej = this.pairReject;
            this.pairReject = null;
            this.pairResolve = null;
            rej(new UsbReselectRequiredError());
        }
    }
    async cleanupUsb() {
        const dev = this.device;
        const iface = this.claimedIface;
        this.device = null;
        this.claimedIface = -1;
        if (dev)
            await releaseCdcNcmInterface(dev, iface);
    }
    rejectPair(msg, phase = 'error') {
        this.clearDiscoverTimer();
        this.reading = false;
        this.setPhase(phase, msg);
        void this.cleanupUsb();
        if (this.pairReject) {
            const rej = this.pairReject;
            this.pairReject = null;
            this.pairResolve = null;
            rej(new Error(msg));
        }
    }
    fail(msg) {
        this.rejectPair(msg);
        throw new Error(msg);
    }
    async run() {
        resetNcmSequence();
        this.mdnsCollected = false;
        this.remotePairingSvc = null;
        this.deviceMac = null;
        this.deviceIpv6Addr = null;
        this.resolvedDeviceMac = null;
        this.tcpConn = null;
        this.http2Conn = null;
        this.xpcConn = null;
        this.pairTcpConn = null;
        this.pairHttp2Conn = null;
        this.pairXpcConn = null;
        this.tcpConnections = [];
        this.rsdUdid = null;
        this.tunnelPort = null;
        this.lockdownPort = null;
        this.pairingStarted = false;
        this.trustEstablished = false;
        this.aborted = false;
        this.usbTrafficSeen = false;
        this.mdnsSrvCache = [];
        this.claimedFallbackConfig = false;
        this.setPhase('claiming', 'Opening USB device');
        const dev = this.opts.device != null ? this.opts.device : await getAuthorizedAppleDevice();
        if (!dev)
            this.fail('No authorized Apple USB device — call requestAppleUsbDevice() first');
        this.device = dev;
        try {
            if (!dev.opened)
                await dev.open();
            this.emitLog(`Device: ${dev.productName} (${dev.serialNumber})`);
            const claimed = await claimCdcNcmInterface(dev, m => this.emitLog(m), this.opts.signal, () => this.setPhase('reconnecting', 'Waiting for iPhone to reconnect after USB mode switch'));
            this.device = claimed.device;
            this.epIn = claimed.epIn;
            this.epOut = claimed.epOut;
            this.claimedIface = claimed.claimedIface;
            this.claimedFallbackConfig = claimed.fallbackConfig === true;
            this.setPhase('discovering', 'Waiting for _remoted._tcp');
            const discoverTimeoutMs = this.claimedFallbackConfig ? 15000 : 45000;
            this.discoverTimer = setTimeout(() => {
                if (this.phase !== 'discovering')
                    return;
                const msg = this.claimedFallbackConfig
                    ? 'No _remoted._tcp from the iPhone (fallback USB config). Quit Apple Devices/Xcode, ' +
                        'unplug USB for 5s, replug, then ADD DEVICE again.'
                    : 'No mDNS from the iPhone after claiming CDC-NCM. Unlock the phone, use a data cable, and retry.';
                this.rejectPair(msg);
            }, discoverTimeoutMs);
            this.reading = true;
            void this.readLoop(claimed.device);
        }
        catch (e) {
            if (isUsbReselectRequiredError(e)) {
                this.triggerNeedsReselect();
                return;
            }
            const msg = e && e.message ? e.message : String(e);
            this.rejectPair(msg);
        }
    }
    sendEthernetFrame(frame) {
        if (!this.device)
            return;
        const ncm = buildNcmTransfer(frame);
        void this.device.transferOut(this.epOut, ncm).catch((e) => this.emitLog(`USB out error: ${e.message}`));
    }
    sendIPv6Packet(dstMac, ipv6Packet) {
        const ethFrame = buildEthernet(dstMac, this.ourMac, ETHERTYPE_IPV6, ipv6Packet);
        this.sendEthernetFrame(ethFrame);
    }
    async readLoop(dev) {
        while (this.reading && !this.aborted) {
            try {
                const result = await dev.transferIn(this.epIn, 16384);
                if (result.data && result.data.byteLength > 0) {
                    this.processNcmTransfer(result.data);
                }
            }
            catch (e) {
                if (this.aborted || !this.reading)
                    break;
                const msg = e && e.message ? e.message : String(e);
                if (/disconnected|cancelled|device not found|The device was disconnected/i.test(msg)) {
                    this.rejectPair(`USB disconnected during pairing: ${msg}`);
                    break;
                }
                this.emitLog(`USB in error: ${msg}`);
                await new Promise(r => setTimeout(r, 200));
            }
        }
    }
    processNcmTransfer(raw) {
        this.usbTrafficSeen = true;
        const block = parseNcmTransfer(raw);
        if (!block)
            return;
        for (const dg of block.datagrams)
            this.processEthernetFrame(dg.data);
    }
    processEthernetFrame(data) {
        const eth = parseEthernet(data);
        if (!eth)
            return;
        if (!this.deviceMac) {
            this.deviceMac = new Uint8Array(eth.srcMac);
            this.emitLog(`Device MAC: ${macToString(this.deviceMac)}`);
        }
        if (eth.ethertype === ETHERTYPE_IPV6)
            this.processIPv6(eth.payload, eth.srcMac);
    }
    processIPv6(data, srcMac) {
        const ipv6 = parseIPv6(data);
        if (!ipv6)
            return;
        if (!this.deviceIpv6Addr && ipv6.srcAddr[0] === 0xfe && (ipv6.srcAddr[1] & 0xc0) === 0x80) {
            this.deviceIpv6Addr = new Uint8Array(ipv6.srcAddr);
            this.emitLog(`Device IPv6: ${ipv6ToString(this.deviceIpv6Addr)}`);
        }
        const result = skipExtensionHeaders(ipv6.nextHeader, ipv6.payload);
        switch (result.nextHeader) {
            case IPPROTO_UDP:
                this.processUDP(result.payload);
                break;
            case IPPROTO_ICMPV6:
                this.processICMPv6(result.payload, ipv6, srcMac);
                break;
            case IPPROTO_TCP:
                this.processTCP(result.payload);
                break;
        }
    }
    processUDP(data) {
        if (data.length < 8)
            return;
        const srcPort = (data[0] << 8) | data[1];
        const dstPort = (data[2] << 8) | data[3];
        if (srcPort === 5353 || dstPort === 5353)
            this.processMdns(data.slice(8));
    }
    processMdns(data) {
        const msg = parseMdns(data);
        if (!msg || this.mdnsCollected)
            return;
        const services = listAllServices(msg);
        if (services.length > 0)
            this.emitLog(`mDNS: ${services.join('; ')}`);
        const svc = findRemotePairingServiceCached(msg, this.mdnsSrvCache);
        if (!svc)
            return;
        this.mdnsCollected = true;
        this.remotePairingSvc = svc;
        this.clearDiscoverTimer();
        this.emitLog(`Found ${svc.serviceName} at ${ipv6ToString(svc.address)}:${svc.port}`);
        this.sendNeighborSolicitation();
    }
    processICMPv6(data, ipv6, srcMac) {
        if (!ipv6 || data.length < 4)
            return;
        if (data[0] === ICMPV6_NEIGHBOR_ADVERTISEMENT) {
            const na = parseNeighborAdvertisement(data);
            if (na && this.phase === 'ndp' && this.remotePairingSvc && arraysEqual(na.targetAddr, this.remotePairingSvc.address)) {
                this.resolvedDeviceMac = new Uint8Array(na.targetMac || srcMac);
                this.emitLog(`NDP resolved: ${macToString(this.resolvedDeviceMac)}`);
                this.startTcpConnection();
            }
        }
        if (data[0] === ICMPV6_NEIGHBOR_SOLICITATION && data.length >= 24) {
            const targetAddr = data.slice(8, 24);
            if (arraysEqual(targetAddr, this.ourIpv6))
                this.sendNeighborAdvertisement(ipv6.srcAddr);
        }
    }
    processTCP(data) {
        const seg = parseTcp(data);
        if (!seg)
            return;
        for (let i = 0; i < this.tcpConnections.length; i++) {
            const conn = this.tcpConnections[i];
            if (seg.srcPort === conn.dstPort && seg.dstPort === conn.srcPort) {
                conn.handleSegment(seg);
                break;
            }
        }
    }
    sendNeighborSolicitation() {
        if (!this.remotePairingSvc || !this.deviceMac)
            return;
        this.setPhase('ndp', 'Resolving link-layer address');
        const targetAddr = this.remotePairingSvc.address;
        const icmpPayload = buildNeighborSolicitation(targetAddr, this.ourMac, this.ourIpv6);
        const dstAddr = solicitedNodeAddress(targetAddr);
        const ipv6Packet = buildIPv6(58, 255, this.ourIpv6, dstAddr, icmpPayload);
        const dstMac = solicitedNodeMac(targetAddr);
        this.sendIPv6Packet(dstMac, ipv6Packet);
        setTimeout(() => {
            if (this.phase === 'ndp' && this.deviceMac)
                this.sendIPv6Packet(this.deviceMac, ipv6Packet);
        }, 400);
        setTimeout(() => {
            if (this.phase === 'ndp' && this.deviceMac && !this.resolvedDeviceMac) {
                this.resolvedDeviceMac = new Uint8Array(this.deviceMac);
                this.startTcpConnection();
            }
        }, 1200);
    }
    sendNeighborAdvertisement(dstAddr) {
        const icmp = new Uint8Array(32);
        icmp[0] = ICMPV6_NEIGHBOR_ADVERTISEMENT;
        icmp[4] = 0x60;
        icmp.set(this.ourIpv6, 8);
        icmp[24] = 2;
        icmp[25] = 1;
        icmp.set(this.ourMac, 26);
        const cksum = icmpv6Checksum(this.ourIpv6, dstAddr, icmp);
        icmp[2] = (cksum >> 8) & 0xff;
        icmp[3] = cksum & 0xff;
        const ipv6Packet = buildIPv6(58, 255, this.ourIpv6, dstAddr, icmp);
        const dstMac = this.deviceMac || new Uint8Array([0x33, 0x33, 0x00, 0x00, 0x00, 0x01]);
        this.sendIPv6Packet(dstMac, ipv6Packet);
    }
    startTcpConnection() {
        if (!this.remotePairingSvc || !this.resolvedDeviceMac)
            return;
        this.setPhase('rsd-tcp', 'Connecting to RSD');
        const dstAddr = this.remotePairingSvc.address;
        const dstPort = this.remotePairingSvc.port;
        const srcPort = 49200 + Math.floor(Math.random() * 1000);
        const dstMac = this.resolvedDeviceMac;
        this.tcpConn = new TcpConnection(this.ourIpv6, dstAddr, srcPort, dstPort, tcpSegment => {
            this.sendIPv6Packet(dstMac, buildIPv6(IPPROTO_TCP, 64, this.ourIpv6, dstAddr, tcpSegment));
        });
        this.tcpConn.log = m => this.emitLog(m);
        this.tcpConn.onConnected = () => this.startHttp2();
        this.tcpConn.onData = data => { if (this.http2Conn)
            this.http2Conn.feed(data); };
        this.tcpConn.onError = msg => {
            if (this.trustEstablished) {
                this.emitLog(`RSD connection closed after trust: ${msg}`);
                return;
            }
            this.rejectPair(msg);
        };
        this.tcpConn.connect();
        this.tcpConnections.push(this.tcpConn);
    }
    startHttp2() {
        if (!this.tcpConn)
            return;
        this.http2Conn = new Http2Connection(data => {
            if (this.tcpConn && this.tcpConn.state === TcpState.ESTABLISHED)
                this.tcpConn.send(data);
        });
        this.http2Conn.log = m => this.emitLog(m);
        this.http2Conn.onReady = () => this.startRemoteXpc();
        this.http2Conn.onStreamData[1] = data => { if (this.xpcConn)
            this.xpcConn.feed(data); };
        this.http2Conn.onStreamData[3] = data => { if (this.xpcConn)
            this.xpcConn.feed(data); };
        this.http2Conn.start();
    }
    startRemoteXpc() {
        if (!this.http2Conn)
            return;
        this.setPhase('rsd-handshake', 'RemoteXPC init');
        this.xpcConn = new RemoteXpcConnection((streamId, data) => {
            this.http2Conn.sendData(streamId, data);
        });
        this.xpcConn.log = m => this.emitLog(m);
        this.xpcConn.onMessage = (parsed) => {
            if (!parsed)
                return;
            const rsd = parseRsdHandshake(parsed);
            if (rsd) {
                this.rsdUdid = rsd.udid;
                this.tunnelPort = rsd.tunnelPort;
                this.lockdownPort = rsd.lockdownPort;
                this.emitLog(`RSD: UDID=${rsd.udid} tunnelPort=${rsd.tunnelPort} lockdownPort=${rsd.lockdownPort || 'none'}`);
                this.beginPairing();
            }
        };
        void this.xpcConn.initialize().catch((e) => this.rejectPair(e.message));
    }
    beginPairing() {
        if (this.pairingStarted || !this.tunnelPort)
            return;
        this.pairingStarted = true;
        this.pairAfterInit = true;
        this.startPairingConnection();
    }
    startPairingConnection() {
        if (!this.tunnelPort || !this.deviceIpv6Addr)
            return;
        this.setPhase('pair-tcp', 'Connecting to untrusted.tunnelservice');
        const dstAddr = this.deviceIpv6Addr;
        const dstPort = this.tunnelPort;
        const srcPort = 49300 + Math.floor(Math.random() * 1000);
        const dstMac = this.resolvedDeviceMac || this.deviceMac;
        if (!dstMac)
            return;
        this.pairTcpConn = new TcpConnection(this.ourIpv6, dstAddr, srcPort, dstPort, tcpSegment => {
            this.sendIPv6Packet(dstMac, buildIPv6(IPPROTO_TCP, 64, this.ourIpv6, dstAddr, tcpSegment));
        });
        this.pairTcpConn.log = m => this.emitLog(m);
        this.pairTcpConn.onConnected = () => this.startPairingHttp2();
        this.pairTcpConn.onData = data => { if (this.pairHttp2Conn)
            this.pairHttp2Conn.feed(data); };
        this.pairTcpConn.onError = msg => {
            if (this.trustEstablished) {
                this.emitLog(`Pairing connection closed after trust: ${msg}`);
                return;
            }
            this.rejectPair(msg);
        };
        this.pairTcpConn.connect();
        this.tcpConnections.push(this.pairTcpConn);
    }
    startPairingHttp2() {
        if (!this.pairTcpConn)
            return;
        this.pairHttp2Conn = new Http2Connection(data => {
            if (this.pairTcpConn && this.pairTcpConn.state === TcpState.ESTABLISHED)
                this.pairTcpConn.send(data);
        });
        this.pairHttp2Conn.log = m => this.emitLog(m);
        this.pairHttp2Conn.onReady = () => this.startPairingXpc();
        this.pairHttp2Conn.onStreamData[1] = data => { if (this.pairXpcConn)
            this.pairXpcConn.feed(data); };
        this.pairHttp2Conn.onStreamData[3] = data => { if (this.pairXpcConn)
            this.pairXpcConn.feed(data); };
        this.pairHttp2Conn.start();
    }
    startPairingXpc() {
        if (!this.pairHttp2Conn)
            return;
        const afterInit = this.pairAfterInit;
        this.pairXpcConn = new RemoteXpcConnection((streamId, data) => {
            this.pairHttp2Conn.sendData(streamId, data);
        });
        this.pairXpcConn.log = m => this.emitLog(m);
        void this.pairXpcConn.initialize().then(() => {
            if (afterInit) {
                this.pairAfterInit = false;
                void this.runPairingCrypto();
            }
        }).catch((e) => this.rejectPair(e.message));
    }
    connectServiceTcp(dstAddr, dstPort, srcPortBase, onData) {
        const dstMac = this.resolvedDeviceMac || this.deviceMac;
        if (!dstMac)
            return Promise.reject(new Error('Device MAC is unavailable'));
        return new Promise((resolve, reject) => {
            const srcPort = srcPortBase + Math.floor(Math.random() * 500);
            const connection = new TcpConnection(this.ourIpv6, dstAddr, srcPort, dstPort, tcpSegment => {
                this.sendIPv6Packet(dstMac, buildIPv6(IPPROTO_TCP, 64, this.ourIpv6, dstAddr, tcpSegment));
            });
            const timer = setTimeout(() => {
                connection.close();
                reject(new Error(`TCP connection to port ${dstPort} timed out`));
            }, 10000);
            connection.log = message => this.emitLog(message);
            connection.onData = onData;
            connection.onConnected = () => {
                clearTimeout(timer);
                connection.onError = message => this.emitLog(`Service TCP error: ${message}`);
                resolve(connection);
            };
            connection.onError = message => {
                clearTimeout(timer);
                reject(new Error(message));
            };
            connection.connect();
            this.tcpConnections.push(connection);
        });
    }
    async refreshRsdHandshake() {
        if (!this.remotePairingSvc)
            return null;
        let http2 = null;
        let xpc = null;
        const connection = await this.connectServiceTcp(this.remotePairingSvc.address, this.remotePairingSvc.port, 51000, data => { if (http2)
            http2.feed(data); });
        try {
            const http2Ready = new Promise(resolve => {
                http2 = new Http2Connection(data => {
                    if (connection.state === TcpState.ESTABLISHED)
                        connection.send(data);
                });
                http2.log = message => this.emitLog(message);
                http2.onReady = resolve;
                http2.start();
            });
            await withTimeout(http2Ready, 10000, 'Refreshed RSD HTTP/2 handshake timed out');
            let resolveHandshake;
            const handshakePromise = new Promise(resolve => {
                resolveHandshake = resolve;
            });
            xpc = new RemoteXpcConnection((streamId, data) => http2.sendData(streamId, data));
            xpc.log = message => this.emitLog(message);
            xpc.onMessage = parsed => {
                if (!parsed)
                    return;
                const handshake = parseRsdHandshake(parsed);
                if (handshake)
                    resolveHandshake(handshake);
            };
            http2.onStreamData[1] = data => { if (xpc)
                xpc.feed(data); };
            http2.onStreamData[3] = data => { if (xpc)
                xpc.feed(data); };
            const initialized = xpc.initialize();
            const handshake = await withTimeout(handshakePromise, 10000, 'Refreshed RSD service catalog timed out');
            await withTimeout(initialized, 10000, 'Refreshed RSD RemoteXPC initialization timed out');
            return handshake;
        }
        finally {
            connection.close();
        }
    }
    async refreshTrustedRsdHandshake() {
        let lastError = new Error('Trusted lockdown service is unavailable');
        for (let attempt = 1; attempt <= 4; attempt++) {
            if (attempt > 1)
                await new Promise(resolve => setTimeout(resolve, attempt * 750));
            try {
                const handshake = await this.refreshRsdHandshake();
                if (!handshake?.lockdownPort) {
                    throw new Error('Trusted lockdown service is not advertised');
                }
                return handshake;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.emitLog(`Post-trust RSD reconnect ${attempt}/4 failed: ${lastError.message}`);
            }
        }
        throw lastError;
    }
    async readDeviceInfoBestEffort() {
        this.setPhase('device-info', 'Reading device information');
        try {
            const refreshed = await this.refreshTrustedRsdHandshake();
            if (refreshed.udid !== this.rsdUdid) {
                throw new Error('Refreshed RSD catalog belongs to another device');
            }
            if (!this.deviceIpv6Addr) {
                throw new Error('Lockdown service is unavailable');
            }
            let lockdown = null;
            const connection = await this.connectServiceTcp(this.deviceIpv6Addr, refreshed.lockdownPort, 52000, data => { if (lockdown)
                lockdown.feed(data); });
            try {
                lockdown = new LockdownConnection(data => connection.send(data));
                const info = await lockdown.readDeviceInfo();
                this.emitLog('Lockdown device information received');
                return info;
            }
            finally {
                connection.close();
            }
        }
        catch (error) {
            const message = error && error.message ? error.message : String(error);
            this.emitLog(`Lockdown device info unavailable: ${message}`);
            return undefined;
        }
    }
    async runPairingCrypto() {
        if (this.pairingInProgress || !this.pairXpcConn || !this.rsdUdid)
            return;
        this.pairingInProgress = true;
        this.setPhase('pairing', 'Waiting for Trust on device');
        try {
            const channel = new ControlChannel(this.pairXpcConn);
            const selfId = this.opts.identity != null ? this.opts.identity : await getOrCreateSelfIdentity();
            const hostKey = await setupNewPairingGetHostKey(channel, selfId, m => this.emitLog(m));
            this.trustEstablished = true;
            if (this.opts.persist !== false) {
                await saveTrustRecord(this.rsdUdid, selfId, hostKey);
            }
            const deviceInfo = await this.readDeviceInfoBestEffort();
            this.finishSuccess(hostKey, selfId, deviceInfo);
        }
        catch (e) {
            if (isPairingTrustDeniedError(e)) {
                this.rejectPair(e.message || PAIRING_TRUST_DENIED_MSG, 'trust-denied');
                return;
            }
            const msg = e && e.message ? e.message : String(e);
            if (msg.includes('pairingData._0')) {
                this.rejectPair(PAIRING_TRUST_DENIED_MSG, 'trust-denied');
                return;
            }
            this.rejectPair(msg);
        }
        finally {
            this.pairingInProgress = false;
        }
    }
}
export async function pairUsbDevice(options = {}) {
    const session = new RemotePairingSession(options);
    return session.pair();
}
//# sourceMappingURL=session.js.map