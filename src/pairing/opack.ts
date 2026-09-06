// OPack encoder ported from go-ios ios/opack/opack.go
// Used for the host-info blob inside pair-setup TLV.

export function encodeOpack(m: Record<string, string | Uint8Array>): Uint8Array {
    const keys = Object.keys(m)
    if (keys.length > 0xF) throw new Error('opack dict exceeds max size 0xF')
    const parts: number[] = [0xE0 | keys.length]
    for (let i = 0; i < keys.length; i++) {
        writeString(parts, keys[i])
        const v = m[keys[i]]
        if (typeof v === 'string') writeString(parts, v)
        else writeData(parts, v)
    }
    return new Uint8Array(parts)
}

export const opackEncode = encodeOpack

function writeString(parts: number[], s: string) {
    const b = new TextEncoder().encode(s)
    writeLengthId(parts, 0x40, b.length)
    for (let i = 0; i < b.length; i++) parts.push(b[i])
}

function writeData(parts: number[], b: Uint8Array) {
    writeLengthId(parts, 0x70, b.length)
    for (let i = 0; i < b.length; i++) parts.push(b[i])
}

function writeLengthId(parts: number[], t: number, l: number) {
    const id = createIdentifierWithLength(t, l)
    for (let i = 0; i < id.length; i++) parts.push(id[i])
}

function createIdentifierWithLength(t: number, l: number): number[] {
    if (l <= 0xF) return [t | l]
    if (l < 0x20) {
        const inc = t + (1 << 4)
        return [inc | (l & 0xF)]
    }
    if (l <= 0xFF) {
        const inc = (t + (2 << 4)) | 0x1
        return [inc, l]
    }
    throw new Error('opack string too long: ' + l)
}

const HOST_ALT_IRK = new Uint8Array([
    0xe9, 0xe8, 0x2d, 0xc0, 0x6a, 0x49, 0x79, 0x4b, 0x56, 0x4f, 0x00, 0x19, 0xb1, 0xc7, 0x7b,
])
const HOST_MAC = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66])

export function buildHostDeviceInfo(accountId: string): Uint8Array {
    return encodeOpack({
        accountID: accountId,
        altIRK: HOST_ALT_IRK,
        btAddr: '11:22:33:44:55:66',
        mac: HOST_MAC,
        model: 'computer-model',
        name: 'EnVoid',
        remotepairing_serial_number: 'AAAAAAAAAAAA',
    })
}
