// RFC 5054 SRP-3072 client matching go-ios (tadglines/go-pkgs + Apple x-hash).
// SHA-512, user Pair-Setup, password 000000
// x = SHA512(salt || SHA512("Pair-Setup:" || password))

import { sha512 } from '@noble/hashes/sha512'

const N_HEX =
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' +
    '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' +
    '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05' +
    '98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB' +
    '9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718' +
    '3995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33' +
    'A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
    'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864' +
    'D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E2' +
    '08E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF'

export const SRP_N = BigInt('0x' + N_HEX)
export const SRP_G = BigInt(5)
export const SRP_N_BYTES = 3072 / 8
export const SRP_USERNAME = 'Pair-Setup'
export const SRP_PASSWORD = '000000'

function bytesToBig(b: Uint8Array): bigint {
    let hex = ''
    for (let i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, '0')
    if (!hex) return BigInt(0)
    return BigInt('0x' + hex)
}

function bigToBytes(n: bigint): Uint8Array {
    if (n === BigInt(0)) return new Uint8Array([0])
    let hex = n.toString(16)
    if (hex.length % 2) hex = '0' + hex
    const out = new Uint8Array(hex.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    return out
}

export function padToN(n: bigint): Uint8Array {
    const b = bigToBytes(n)
    if (b.length >= SRP_N_BYTES) return b
    const out = new Uint8Array(SRP_N_BYTES)
    out.set(b, SRP_N_BYTES - b.length)
    return out
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    let len = 0
    for (let i = 0; i < parts.length; i++) len += parts[i].length
    const out = new Uint8Array(len)
    let o = 0
    for (let i = 0; i < parts.length; i++) {
        out.set(parts[i], o)
        o += parts[i].length
    }
    return out
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = BigInt(1)
    let b = base % mod
    let e = exp
    while (e > BigInt(0)) {
        if (e & BigInt(1)) result = (result * b) % mod
        b = (b * b) % mod
        e >>= BigInt(1)
    }
    return result
}

function randomBits(bits: number): bigint {
    const bytes = Math.ceil(bits / 8)
    const buf = new Uint8Array(bytes)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(buf)
    } else {
        for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256)
    }
    buf[0] &= (1 << (bits % 8 || 8)) - 1
    return bytesToBig(buf)
}

/** Apple / go-ios x: SHA512(salt || SHA512("Pair-Setup:" || password)) */
export function srpXHash(salt: Uint8Array, password: string = SRP_PASSWORD): Uint8Array {
    const inner = sha512(new TextEncoder().encode(SRP_USERNAME + ':' + password))
    return sha512(concatBytes([salt, inner]))
}

function computeK(): bigint {
    return bytesToBig(sha512(concatBytes([bigToBytes(SRP_N), padToN(SRP_G)])))
}

const SRP_K = computeK()

export interface SrpClientSession {
    clientPublic: Uint8Array
    clientProof: Uint8Array
    sessionKey: Uint8Array
    verifyServerProof: (proof: Uint8Array) => boolean
}

export function newSrpClient(salt: Uint8Array, serverPublicB: Uint8Array, password: string = SRP_PASSWORD): SrpClientSession {
    const a = randomBits(256)
    const A = modPow(SRP_G, a, SRP_N)
    const B = bytesToBig(serverPublicB)
    if (B === BigInt(0) || B >= SRP_N || B % SRP_N === BigInt(0)) {
        throw new Error('SRP: invalid server public B')
    }
    const u = bytesToBig(sha512(concatBytes([padToN(A), padToN(B)])))
    if (u === BigInt(0)) throw new Error('SRP: H(A,B) == 0')

    const x = bytesToBig(srpXHash(salt, password))
    // tadglines: S = (B - k*g^x)^(a+ux) via unblind (N-g^x)*k + B
    let t1 = SRP_N - modPow(SRP_G, x, SRP_N)
    t1 = SRP_K * t1
    t1 = (t1 + B) % SRP_N

    const t2 = a + u * x
    const S = modPow(t1, t2, SRP_N)
    const sessionKey = sha512(bigToBytes(S))

    const Abytes = bigToBytes(A)
    const Bbytes = bigToBytes(B)

    const hn = bytesToBig(sha512(bigToBytes(SRP_N)))
    const hg = bytesToBig(sha512(bigToBytes(SRP_G)))
    const hng = hn ^ hg
    const hi = sha512(new TextEncoder().encode(SRP_USERNAME))

    const clientProof = sha512(concatBytes([
        bigToBytes(hng),
        hi,
        salt,
        Abytes,
        Bbytes,
        sessionKey,
    ]))

    const serverExpected = sha512(concatBytes([Abytes, clientProof, sessionKey]))

    return {
        clientPublic: Abytes,
        clientProof,
        sessionKey,
        verifyServerProof: (p: Uint8Array) => {
            if (p.length !== serverExpected.length) return false
            let diff = 0
            for (let i = 0; i < p.length; i++) diff |= p[i] ^ serverExpected[i]
            return diff === 0
        },
    }
}

export const newSrpSession = newSrpClient
