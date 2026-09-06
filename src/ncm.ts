// CDC-NCM (Network Control Model) frame parser and builder
// Reference: USB CDC NCM specification, NTH16 and NDP16 structures

const NTH16_SIGNATURE = 0x484D434E // "NCMH" in little-endian
const NDP16_SIGNATURE = 0x304D434E // "NCM0" in little-endian
const NTH16_LENGTH = 12
const NDP16_HEADER_LENGTH = 8 // signature(4) + length(2) + nextNdpIndex(2)

export interface NcmDatagram {
    data: Uint8Array
}

export interface NcmTransferBlock {
    sequence: number
    datagrams: NcmDatagram[]
}

export var ncmDebugLog: ((msg: string) => void) | null = null
export function setNcmDebugLog(fn: ((msg: string) => void) | null) { ncmDebugLog = fn }

function debug(msg: string) {
    if (ncmDebugLog) ncmDebugLog(msg)
}

export function hexDump(data: Uint8Array | DataView, maxBytes: number = 64): string {
    const buf = data instanceof DataView ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data
    const len = Math.min(buf.length, maxBytes)
    const parts: string[] = []
    for (let i = 0; i < len; i++) {
        parts.push(buf[i].toString(16).padStart(2, '0'))
    }
    if (buf.length > maxBytes) parts.push('...')
    return parts.join(' ')
}

/**
 * Parse a raw USB bulk transfer into NCM datagrams (Ethernet frames).
 */
export function parseNcmTransfer(raw: DataView): NcmTransferBlock | null {
    if (raw.byteLength < NTH16_LENGTH) {
        debug(`[NCM] PARSE FAIL: too small (${raw.byteLength} bytes, need >= ${NTH16_LENGTH})`)
        return null
    }

    const sig = raw.getUint32(0, true)
    debug(`[NCM] RAW ${raw.byteLength}B: ${hexDump(raw, 32)}`)
    debug(`[NCM] NTH16 signature: 0x${sig.toString(16)} (expected 0x${NTH16_SIGNATURE.toString(16)})`)
    
    if (sig !== NTH16_SIGNATURE) {
        debug(`[NCM] PARSE FAIL: bad signature`)
        return null
    }

    const headerLength = raw.getUint16(4, true)
    const sequence = raw.getUint16(6, true)
    const blockLength = raw.getUint16(8, true)
    const ndpIndex = raw.getUint16(10, true)

    debug(`[NCM] NTH16: hdrLen=${headerLength} seq=${sequence} blockLen=${blockLength} ndpIdx=${ndpIndex}`)

    if (raw.byteLength < headerLength) {
        debug(`[NCM] PARSE FAIL: byteLength ${raw.byteLength} < headerLength ${headerLength}`)
        return null
    }
    if (raw.byteLength < blockLength) {
        debug(`[NCM] WARN: byteLength ${raw.byteLength} < blockLength ${blockLength} (partial transfer?)`)
    }

    const datagrams: NcmDatagram[] = []
    let ndpCount = 0

    let currentNdpIndex = ndpIndex
    while (currentNdpIndex !== 0 && currentNdpIndex + NDP16_HEADER_LENGTH <= raw.byteLength) {
        ndpCount++
        const ndpSig = raw.getUint32(currentNdpIndex, true)
        debug(`[NCM] NDP[${ndpCount}] at ${currentNdpIndex}: sig=0x${ndpSig.toString(16)}`)
        
        if (ndpSig !== NDP16_SIGNATURE) {
            debug(`[NCM] NDP bad signature, stopping chain`)
            break
        }

        const ndpLength = raw.getUint16(currentNdpIndex + 4, true)
        const nextNdp = raw.getUint16(currentNdpIndex + 6, true)
        debug(`[NCM] NDP[${ndpCount}]: len=${ndpLength} nextNdp=${nextNdp}`)

        let entryOffset = currentNdpIndex + 8
        let entryCount = 0
        while (entryOffset + 4 <= currentNdpIndex + ndpLength) {
            const dgIndex = raw.getUint16(entryOffset, true)
            const dgLength = raw.getUint16(entryOffset + 2, true)
            debug(`[NCM]   entry[${entryCount}]: idx=${dgIndex} len=${dgLength}`)

            if (dgIndex === 0 && dgLength === 0) {
                debug(`[NCM]   terminator reached`)
                break
            }
            
            entryOffset += 4
            entryCount++

            if (dgIndex + dgLength > raw.byteLength) {
                debug(`[NCM]   ERROR: dgIndex(${dgIndex}) + dgLength(${dgLength}) > raw.byteLength(${raw.byteLength})`)
                break
            }
            
            if (dgLength === 0) {
                debug(`[NCM]   WARN: zero-length datagram, skipping`)
                continue
            }

            const dgData = new Uint8Array(raw.buffer, raw.byteOffset + dgIndex, dgLength)
            datagrams.push({ data: dgData })
            debug(`[NCM]   datagram[${datagrams.length - 1}]: ${dgLength}B ethertype=0x${((dgData[12] << 8) | dgData[13]).toString(16)}`)
        }

        currentNdpIndex = nextNdp
    }

    debug(`[NCM] PARSED: seq=${sequence} ndps=${ndpCount} datagrams=${datagrams.length}`)
    return { sequence, datagrams }
}

let ncmSequence = 0

export function buildNcmTransfer(ethernetFrame: Uint8Array): Uint8Array {
    const dgLength = ethernetFrame.length
    const ndpEntries = 1
    const ndpLength = 8 + (ndpEntries * 4) + 4
    const dgOffset = NTH16_LENGTH + ndpLength
    const totalLength = dgOffset + dgLength

    const buf = new ArrayBuffer(totalLength)
    const view = new DataView(buf)
    const bytes = new Uint8Array(buf)

    view.setUint32(0, NTH16_SIGNATURE, true)
    view.setUint16(4, NTH16_LENGTH, true)
    view.setUint16(6, ncmSequence, true)
    view.setUint16(8, totalLength, true)
    view.setUint16(10, NTH16_LENGTH, true)

    const ndpOff = NTH16_LENGTH
    view.setUint32(ndpOff, NDP16_SIGNATURE, true)
    view.setUint16(ndpOff + 4, ndpLength, true)
    view.setUint16(ndpOff + 6, 0, true)

    view.setUint16(ndpOff + 8, dgOffset, true)
    view.setUint16(ndpOff + 10, dgLength, true)

    view.setUint16(ndpOff + 12, 0, true)
    view.setUint16(ndpOff + 14, 0, true)

    bytes.set(ethernetFrame, dgOffset)

    debug(`[NCM] BUILD: seq=${ncmSequence} ethFrame=${dgLength}B total=${totalLength}B`)
    ncmSequence++

    return bytes
}

export function resetNcmSequence() {
    ncmSequence = 0
    debug(`[NCM] Sequence reset to 0`)
}