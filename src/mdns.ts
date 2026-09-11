// Minimal mDNS response parser
// Enough to extract _remotepairing._tcp SRV + AAAA records

export interface MdnsRecord {
    name: string
    type: number
    class_: number
    ttl: number
    data: Uint8Array
    // Parsed fields depending on type
    parsed?: MdnsParsedData
}

export type MdnsParsedData =
    | { type: 'A', address: string }
    | { type: 'AAAA', address: Uint8Array, addressStr: string }
    | { type: 'PTR', name: string }
    | { type: 'SRV', priority: number, weight: number, port: number, target: string }
    | { type: 'TXT', entries: string[] }

export interface MdnsMessage {
    id: number
    flags: number
    questions: MdnsQuestion[]
    answers: MdnsRecord[]
    authority: MdnsRecord[]
    additional: MdnsRecord[]
}

export interface MdnsQuestion {
    name: string
    type: number
    class_: number
}

// DNS record types
const TYPE_A = 1
const TYPE_PTR = 12
const TYPE_TXT = 16
const TYPE_AAAA = 28
const TYPE_SRV = 33

export var mdnsDebugLog: ((msg: string) => void) | null = null
export function setMdnsDebugLog(fn: ((msg: string) => void) | null) { mdnsDebugLog = fn }

function mdnsDebug(msg: string) {
    if (mdnsDebugLog) mdnsDebugLog(msg)
}

function mdnsHexDump(data: Uint8Array, maxBytes: number = 32): string {
    const len = Math.min(data.length, maxBytes)
    const parts: string[] = []
    for (let i = 0; i < len; i++) parts.push(data[i].toString(16).padStart(2, '0'))
    if (data.length > maxBytes) parts.push('...')
    return parts.join(' ')
}

class DnsReader {
    data: Uint8Array
    view: DataView
    offset: number

    constructor(data: Uint8Array) {
        this.data = data
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        this.offset = 0
    }

    readUint16(): number {
        const v = this.view.getUint16(this.offset, false)
        this.offset += 2
        return v
    }

    readUint32(): number {
        const v = this.view.getUint32(this.offset, false)
        this.offset += 4
        return v
    }

    readBytes(n: number): Uint8Array {
        const result = this.data.slice(this.offset, this.offset + n)
        this.offset += n
        return result
    }

    readName(): string {
        const parts: string[] = []
        let jumped = false
        let savedOffset = 0
        let maxJumps = 20

        while (maxJumps-- > 0) {
            if (this.offset >= this.data.length) break
            const len = this.data[this.offset]

            if (len === 0) {
                this.offset++
                break
            }

            if ((len & 0xC0) === 0xC0) {
                // Pointer
                if (!jumped) savedOffset = this.offset + 2
                const ptr = ((len & 0x3F) << 8) | this.data[this.offset + 1]
                this.offset = ptr
                jumped = true
                continue
            }

            this.offset++
            const label = new TextDecoder().decode(this.data.slice(this.offset, this.offset + len))
            parts.push(label)
            this.offset += len
        }

        if (jumped) this.offset = savedOffset
        return parts.join('.')
    }
}

function parseRecord(reader: DnsReader): MdnsRecord {
    const name = reader.readName()
    const type = reader.readUint16()
    const class_ = reader.readUint16() & 0x7FFF // mask off cache-flush bit
    const ttl = reader.readUint32()
    const rdLength = reader.readUint16()
    const data = reader.readBytes(rdLength)

    const record: MdnsRecord = { name, type, class_, ttl, data }

    // Parse known types
    if (type === TYPE_AAAA && data.length === 16) {
        const groups: string[] = []
        for (let i = 0; i < 16; i += 2) {
            groups.push(((data[i] << 8) | data[i + 1]).toString(16))
        }
        record.parsed = { type: 'AAAA', address: data, addressStr: groups.join(':') }
    } else if (type === TYPE_A && data.length === 4) {
        record.parsed = { type: 'A', address: `${data[0]}.${data[1]}.${data[2]}.${data[3]}` }
    } else if (type === TYPE_PTR) {
        const subReader = new DnsReader(reader.data)
        subReader.offset = reader.offset - data.length
        // Re-read the name from the original data context for pointer resolution
        const ptrReader = new DnsReader(reader.data)
        ptrReader.offset = reader.offset - rdLength
        record.parsed = { type: 'PTR', name: ptrReader.readName() }
    } else if (type === TYPE_SRV && data.length >= 6) {
        const srvView = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const priority = srvView.getUint16(0, false)
        const weight = srvView.getUint16(2, false)
        const port = srvView.getUint16(4, false)
        // Target is a DNS name starting at offset 6
        const targetReader = new DnsReader(reader.data)
        // The target name in SRV uses the original packet for pointer resolution
        // but the name itself starts at the current rdata position
        targetReader.offset = reader.offset - rdLength + 6
        const target = targetReader.readName()
        record.parsed = { type: 'SRV', priority, weight, port, target }
    } else if (type === TYPE_TXT) {
        const entries: string[] = []
        let off = 0
        while (off < data.length) {
            const len = data[off]
            off++
            if (off + len <= data.length) {
                entries.push(new TextDecoder().decode(data.slice(off, off + len)))
            }
            off += len
        }
        record.parsed = { type: 'TXT', entries }
    }

    return record
}

export function parseMdns(data: Uint8Array): MdnsMessage | null {
    if (data.length < 12) {
        mdnsDebug(`[mDNS] PARSE FAIL: ${data.length}B < 12B minimum header`)
        return null
    }

    mdnsDebug(`[mDNS] PARSE: ${data.length}B total`)
    mdnsDebug(`[mDNS]   raw: ${mdnsHexDump(data, 24)}`)

    const reader = new DnsReader(data)
    const id = reader.readUint16()
    const flags = reader.readUint16()
    const qdCount = reader.readUint16()
    const anCount = reader.readUint16()
    const nsCount = reader.readUint16()
    const arCount = reader.readUint16()

    mdnsDebug(`[mDNS]   id=${id} flags=0x${flags.toString(16)} questions=${qdCount} answers=${anCount} authority=${nsCount} additional=${arCount}`)

    const questions: MdnsQuestion[] = []
    for (let i = 0; i < qdCount && reader.offset < data.length; i++) {
        const name = reader.readName()
        const type = reader.readUint16()
        const class_ = reader.readUint16()
        questions.push({ name, type, class_ })
        mdnsDebug(`[mDNS]   Q[${i}]: ${name} type=${type} class=${class_}`)
    }

    const answers: MdnsRecord[] = []
    for (let i = 0; i < anCount && reader.offset < data.length; i++) {
        try { 
            const rec = parseRecord(reader)
            answers.push(rec)
            mdnsDebug(`[mDNS]   A[${i}]: ${rec.name} type=${rec.type} ttl=${rec.ttl} dataLen=${rec.data.length}`)
            if (rec.parsed) {
                if (rec.parsed.type === 'AAAA') {
                    mdnsDebug(`[mDNS]     AAAA: ${rec.parsed.addressStr}`)
                } else if (rec.parsed.type === 'SRV') {
                    mdnsDebug(`[mDNS]     SRV: ${rec.parsed.target}:${rec.parsed.port} pri=${rec.parsed.priority} weight=${rec.parsed.weight}`)
                }
            }
        } catch (e: any) { 
            mdnsDebug(`[mDNS]   A[${i}]: PARSE ERROR: ${e.message}`)
            break 
        }
    }

    const authority: MdnsRecord[] = []
    for (let i = 0; i < nsCount && reader.offset < data.length; i++) {
        try { 
            const rec = parseRecord(reader)
            authority.push(rec)
            mdnsDebug(`[mDNS]   NS[${i}]: ${rec.name} type=${rec.type}`)
        } catch (e: any) { break }
    }

    const additional: MdnsRecord[] = []
    for (let i = 0; i < arCount && reader.offset < data.length; i++) {
        try { 
            const rec = parseRecord(reader)
            additional.push(rec)
            mdnsDebug(`[mDNS]   AR[${i}]: ${rec.name} type=${rec.type}`)
            if (rec.parsed) {
                if (rec.parsed.type === 'AAAA') {
                    mdnsDebug(`[mDNS]     AAAA: ${rec.parsed.addressStr}`)
                } else if (rec.parsed.type === 'SRV') {
                    mdnsDebug(`[mDNS]     SRV: ${rec.parsed.target}:${rec.parsed.port}`)
                }
            }
        } catch (e: any) { break }
    }

    return { id, flags, questions, answers, authority, additional }
}

/**
 * Discovered service info.
 */
export interface RemotePairingService {
    address: Uint8Array
    port: number
    hostname: string
    serviceName: string
}

/**
 * Search all records in an mDNS message for Apple remote services.
 * Looks for (in priority order):
 *   1. _remoted._tcp (Remote Service Discovery - RSD)
 *   2. _remotepairing._tcp (RemoteXPC pairing)
 * Returns { address, port, hostname, serviceName } if found.
 */
export function findRemotePairingService(msg: MdnsMessage): RemotePairingService | null {
    const allRecords = [...msg.answers, ...msg.authority, ...msg.additional]

    // Try services in priority order
    // USB RemoteXPC uses RSD on _remoted._tcp only. Do not HTTP/2 to _remotepairing._tcp
    // (that port is the Wi-Fi JSON RPPairing protocol).
    var serviceNames = ['_remoted._tcp']

    for (var si = 0; si < serviceNames.length; si++) {
        var svcName = serviceNames[si]

        // Find SRV record for this service
        var srvRecord: MdnsRecord | null = null
        for (var ri = 0; ri < allRecords.length; ri++) {
            var rec = allRecords[ri]
            if (rec.name.indexOf(svcName) >= 0 && rec.parsed && rec.parsed.type === 'SRV') {
                srvRecord = rec
                break
            }
        }
        if (!srvRecord || !srvRecord.parsed || srvRecord.parsed.type !== 'SRV') continue

        var port = srvRecord.parsed.port
        var target = srvRecord.parsed.target

        // Find AAAA record for the target hostname
        var address: Uint8Array | null = null
        for (var ai = 0; ai < allRecords.length; ai++) {
            var arec = allRecords[ai]
            if (arec.parsed && arec.parsed.type === 'AAAA') {
                if (arec.name === target || arec.name + '.' === target || target.indexOf(arec.name) >= 0) {
                    address = arec.parsed.address
                    break
                }
            }
        }

        // Fallback: any link-local AAAA
        if (!address) {
            for (var bi = 0; bi < allRecords.length; bi++) {
                var brec = allRecords[bi]
                if (brec.parsed && brec.parsed.type === 'AAAA' && brec.parsed.address[0] === 0xFE && (brec.parsed.address[1] & 0xC0) === 0x80) {
                    address = brec.parsed.address
                    break
                }
            }
        }

        if (address) {
            return { address: new Uint8Array(address), port: port, hostname: target, serviceName: svcName }
        }
    }

    return null
}

export interface MdnsSrvHint {
    serviceName: string
    target: string
    port: number
}

function collectRemotedSrvHints(msg: MdnsMessage): MdnsSrvHint[] {
    const hints: MdnsSrvHint[] = []
    const allRecords = [...msg.answers, ...msg.authority, ...msg.additional]
    for (let i = 0; i < allRecords.length; i++) {
        const rec = allRecords[i]
        if (!rec.parsed || rec.parsed.type !== 'SRV') continue
        if (rec.name.indexOf('_remoted._tcp') < 0) continue
        hints.push({
            serviceName: rec.name,
            target: rec.parsed.target,
            port: rec.parsed.port,
        })
    }
    return hints
}

function resolveSrvHint(msg: MdnsMessage, hint: MdnsSrvHint): RemotePairingService | null {
    const allRecords = [...msg.answers, ...msg.authority, ...msg.additional]
    let address: Uint8Array | null = null
    for (let ai = 0; ai < allRecords.length; ai++) {
        const arec = allRecords[ai]
        if (!arec.parsed || arec.parsed.type !== 'AAAA') continue
        if (
            arec.name === hint.target
            || arec.name + '.' === hint.target
            || hint.target.indexOf(arec.name) >= 0
        ) {
            address = arec.parsed.address
            break
        }
    }
    if (!address) {
        for (let bi = 0; bi < allRecords.length; bi++) {
            const brec = allRecords[bi]
            if (
                brec.parsed
                && brec.parsed.type === 'AAAA'
                && brec.parsed.address[0] === 0xFE
                && (brec.parsed.address[1] & 0xC0) === 0x80
            ) {
                address = brec.parsed.address
                break
            }
        }
    }
    if (!address) return null
    return {
        address: new Uint8Array(address),
        port: hint.port,
        hostname: hint.target,
        serviceName: hint.serviceName,
    }
}

/** Resolve _remoted._tcp when SRV and AAAA arrive in different mDNS packets. */
export function findRemotePairingServiceCached(
    msg: MdnsMessage,
    cache: MdnsSrvHint[],
): RemotePairingService | null {
    const direct = findRemotePairingService(msg)
    if (direct) return direct

    const hints = collectRemotedSrvHints(msg)
    for (let i = 0; i < hints.length; i++) cache.push(hints[i])

    for (let i = 0; i < cache.length; i++) {
        const resolved = resolveSrvHint(msg, cache[i])
        if (resolved) return resolved
    }
    return null
}

/**
 * Collect ALL discovered services from an mDNS message for logging.
 */
export function listAllServices(msg: MdnsMessage): string[] {
    var allRecords = [...msg.answers, ...msg.authority, ...msg.additional]
    var services: string[] = []
    for (var i = 0; i < allRecords.length; i++) {
        var rec = allRecords[i]
        if (rec.parsed && rec.parsed.type === 'SRV') {
            services.push(rec.name + ' -> ' + rec.parsed.target + ':' + rec.parsed.port)
        } else if (rec.parsed && rec.parsed.type === 'PTR') {
            services.push(rec.name + ' PTR ' + rec.parsed.name)
        }
    }
    return services
}
