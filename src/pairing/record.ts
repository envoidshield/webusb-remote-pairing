// Compact MD5 (RFC 1321) for UUID v3 host identifier.
import { ed25519 } from '@noble/curves/ed25519'

function md5(bytes: Uint8Array): Uint8Array {
    const n = bytes.length
    const bitLen = n * 8
    const padLen = (n % 64 < 56) ? (56 - (n % 64)) : (120 - (n % 64))
    const buf = new Uint8Array(n + padLen + 8)
    buf.set(bytes)
    buf[n] = 0x80
    const view = new DataView(buf.buffer)
    view.setUint32(buf.length - 8, bitLen >>> 0, true)
    view.setUint32(buf.length - 4, Math.floor(bitLen / 0x100000000), true)

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
    const K: number[] = []
    const s = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ]
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)

    const M = new Uint32Array(16)
    for (let off = 0; off < buf.length; off += 64) {
        for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true)
        let A = a0, B = b0, C = c0, D = d0
        for (let i = 0; i < 64; i++) {
            let F: number, g: number
            if (i < 16) { F = (B & C) | (~B & D); g = i }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
            else { F = C ^ (B | ~D); g = (7 * i) % 16 }
            const tmp = D
            D = C
            C = B
            const sum = (A + F + K[i] + M[g]) >>> 0
            B = (B + rotl(sum, s[i])) >>> 0
            A = tmp
        }
        a0 = (a0 + A) >>> 0
        b0 = (b0 + B) >>> 0
        c0 = (c0 + C) >>> 0
        d0 = (d0 + D) >>> 0
    }
    const out = new Uint8Array(16)
    const ov = new DataView(out.buffer)
    ov.setUint32(0, a0, true)
    ov.setUint32(4, b0, true)
    ov.setUint32(8, c0, true)
    ov.setUint32(12, d0, true)
    return out
}

function rotl(x: number, n: number): number {
    return ((x << n) | (x >>> (32 - n))) >>> 0
}

const DNS_NAMESPACE = new Uint8Array([
    0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1,
    0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8,
])

export const HOST_NAME = 'EnVoid'

export function uuidV3(namespace: Uint8Array, name: string): string {
    const nameBytes = new TextEncoder().encode(name)
    const input = new Uint8Array(namespace.length + nameBytes.length)
    input.set(namespace)
    input.set(nameBytes, namespace.length)
    const h = md5(input)
    h[6] = (h[6] & 0x0f) | 0x30
    h[8] = (h[8] & 0x3f) | 0x80
    const hex: string[] = []
    for (let i = 0; i < 16; i++) hex.push(h[i].toString(16).padStart(2, '0'))
    const s = hex.join('')
    return (s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20)).toUpperCase()
}

export function envoidHostIdentifier(): string {
    return uuidV3(DNS_NAMESPACE, HOST_NAME)
}

export interface SelfIdentity {
    identifier: string
    irk: Uint8Array
    privateKey: Uint8Array
    publicKey: Uint8Array
}

export interface DevicePairRecord {
    private_key: Uint8Array
    public_key: Uint8Array
    remote_unlock_host_key: string
}

export interface PairingStore {
    selfIdentity: SelfIdentity
    devices: Record<string, DevicePairRecord>
}

const DB_NAME = 'envoid-remote-pairing'
const STORE = 'state'
const KEY = 'envoid-remote-pairing'

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

function idbGet(): Promise<any> {
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(KEY)
        req.onsuccess = () => resolve(req.result || null)
        req.onerror = () => reject(req.error)
    }))
}

function idbPut(value: any): Promise<void> {
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(value, KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    }))
}

function reviveBytes(v: any): Uint8Array {
    if (v instanceof Uint8Array) return v
    if (Array.isArray(v)) return new Uint8Array(v)
    if (v && v.data && Array.isArray(v.data)) return new Uint8Array(v.data)
    return new Uint8Array(0)
}

export async function loadStore(): Promise<PairingStore | null> {
    const raw = await idbGet()
    if (!raw) return null
    const si = raw.selfIdentity
    if (!si) return null
    const devices: Record<string, DevicePairRecord> = {}
    const src = raw.devices || {}
    const udids = Object.keys(src)
    for (let i = 0; i < udids.length; i++) {
        const d = src[udids[i]]
        devices[udids[i]] = {
            private_key: reviveBytes(d.private_key),
            public_key: reviveBytes(d.public_key),
            remote_unlock_host_key: d.remote_unlock_host_key || '',
        }
    }
    return {
        selfIdentity: {
            identifier: si.identifier,
            irk: reviveBytes(si.irk),
            privateKey: reviveBytes(si.privateKey),
            publicKey: reviveBytes(si.publicKey),
        },
        devices,
    }
}

export async function saveStore(store: PairingStore): Promise<void> {
    await idbPut({
        selfIdentity: {
            identifier: store.selfIdentity.identifier,
            irk: Array.from(store.selfIdentity.irk),
            privateKey: Array.from(store.selfIdentity.privateKey),
            publicKey: Array.from(store.selfIdentity.publicKey),
        },
        devices: Object.keys(store.devices).reduce((acc: any, udid) => {
            const d = store.devices[udid]
            acc[udid] = {
                private_key: Array.from(d.private_key),
                public_key: Array.from(d.public_key),
                remote_unlock_host_key: d.remote_unlock_host_key,
            }
            return acc
        }, {}),
    })
}

export function createSelfIdentity(ed25519: { utils: { randomPrivateKey: () => Uint8Array }, getPublicKey: (s: Uint8Array) => Uint8Array }): SelfIdentity {
    const irk = new Uint8Array(16)
    crypto.getRandomValues(irk)
    const privateKey = ed25519.utils.randomPrivateKey()
    const publicKey = ed25519.getPublicKey(privateKey)
    return {
        identifier: envoidHostIdentifier(),
        irk,
        privateKey,
        publicKey,
    }
}

export async function getOrCreateSelfIdentity(): Promise<SelfIdentity> {
    const store = await loadStore()
    if (store && store.selfIdentity && store.selfIdentity.privateKey.length === 32) {
        return store.selfIdentity
    }
    const si = createSelfIdentity(ed25519)
    await saveStore({ selfIdentity: si, devices: store ? store.devices : {} })
    return si
}

export async function saveTrustRecord(udid: string, selfId: SelfIdentity, hostKey: string): Promise<void> {
    await saveDeviceRecord(udid, {
        private_key: selfId.privateKey,
        public_key: selfId.publicKey,
        remote_unlock_host_key: hostKey,
    }, selfId)
}

export function trustRecordToPlistXml(_udid: string, rec: DevicePairRecord): string {
    return buildTrustRecordPlist(rec)
}

export function downloadPlist(filename: string, xml: string) {
    const blob = new Blob([xml], { type: 'application/x-plist' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

export async function saveDeviceRecord(udid: string, rec: DevicePairRecord, selfIdentity: SelfIdentity): Promise<void> {
    const store = (await loadStore()) || { selfIdentity, devices: {} }
    store.selfIdentity = selfIdentity
    store.devices[udid] = rec
    await saveStore(store)
}

function xmlEscape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function b64(data: Uint8Array): string {
    let s = ''
    for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i])
    return btoa(s)
}

/** XML plist compatible with pymobiledevice3 / go-ios autotrust TrustRecord. */
export function buildTrustRecordPlist(rec: DevicePairRecord): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '\t<key>private_key</key>',
        '\t<data>' + b64(rec.private_key) + '</data>',
        '\t<key>public_key</key>',
        '\t<data>' + b64(rec.public_key) + '</data>',
        '\t<key>remote_unlock_host_key</key>',
        '\t<string>' + xmlEscape(rec.remote_unlock_host_key) + '</string>',
        '</dict>',
        '</plist>',
        '',
    ].join('\n')
}

export function downloadTrustRecord(udid: string, rec: DevicePairRecord) {
    const xml = buildTrustRecordPlist(rec)
    const blob = new Blob([xml], { type: 'application/x-plist' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'remote_' + udid + '.plist'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
