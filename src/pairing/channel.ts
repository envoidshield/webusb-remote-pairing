// RemotePairing.ControlChannelMessageEnvelope (go-ios ios/tunnel/codec.go)

import { RemoteXpcConnection } from '../remotexpc'

export interface PairingData {
    data: Uint8Array
    kind: string
    sendingHost?: string
    startNewSession?: boolean
}

function getChild(m: Record<string, any>, keys: string[]): Record<string, any> | null {
    let cur: any = m
    for (let i = 0; i < keys.length; i++) {
        if (!cur || typeof cur !== 'object') return null
        cur = cur[keys[i]]
    }
    if (!cur || typeof cur !== 'object') return null
    return cur as Record<string, any>
}

export function getChildMap(m: Record<string, any>, ...keys: string[]): Record<string, any> {
    const found = getChild(m, keys)
    if (!found) throw new Error("getChildMap: could not find entry for '" + keys.join('.') + "'")
    return found
}

export function encodePairingData(p: PairingData): Record<string, any> {
    return {
        pairingData: {
            _0: {
                data: p.data,
                kind: p.kind,
                sendingHost: p.sendingHost || '',
                startNewSession: !!p.startNewSession,
            },
        },
    }
}

export function decodePairingData(e: Record<string, any>): PairingData {
    const pd = getChildMap(e, 'pairingData', '_0')
    let data = new Uint8Array(0)
    const raw = pd['data']
    if (raw instanceof Uint8Array) data = raw
    else if (typeof raw === 'string') {
        try {
            const bin = atob(raw)
            data = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
        } catch {
            data = new TextEncoder().encode(raw)
        }
    }
    return {
        data,
        kind: typeof pd['kind'] === 'string' ? pd['kind'] : '',
        sendingHost: typeof pd['sendingHost'] === 'string' ? pd['sendingHost'] : '',
        startNewSession: !!pd['startNewSession'],
    }
}

export function wrapEnvelope(message: Record<string, any>, sequenceNumber: number): Record<string, any> {
    return {
        mangledTypeName: 'RemotePairing.ControlChannelMessageEnvelope',
        value: {
            message,
            originatedBy: 'host',
            sequenceNumber: BigInt(sequenceNumber),
        },
    }
}

export function unwrapEnvelope(p: Record<string, any>): Record<string, any> {
    return getChildMap(p, 'value', 'message')
}

export class ControlChannel {
    seqNr: number
    conn: RemoteXpcConnection
    timeoutMs: number

    constructor(conn: RemoteXpcConnection, timeoutMs: number = 120000) {
        this.seqNr = 1
        this.conn = conn
        this.timeoutMs = timeoutMs
    }

    write(message: Record<string, any>) {
        const e = wrapEnvelope(message, this.seqNr)
        this.seqNr += 1
        this.conn.sendDict(e)
    }

    async read(): Promise<Record<string, any>> {
        while (true) {
            const p = await this.conn.waitForDict(this.timeoutMs)
            if (p && p.value) return unwrapEnvelope(p)
        }
    }

    writeRequest(req: Record<string, any>) {
        this.write({
            plain: {
                _0: {
                    request: {
                        _0: req,
                    },
                },
            },
        })
    }

    writeEvent(encoded: Record<string, any>) {
        this.write({
            plain: {
                _0: {
                    event: {
                        _0: encoded,
                    },
                },
            },
        })
    }

    async readEvent(): Promise<Record<string, any>> {
        const m = await this.read()
        return getChildMap(m, 'plain', '_0', 'event', '_0')
    }

    writePairingEvent(p: PairingData) {
        this.writeEvent(encodePairingData(p))
    }

    async readPairingEvent(): Promise<PairingData> {
        return decodePairingData(await this.readEvent())
    }

    writeEncrypted(ciphertext: Uint8Array) {
        this.write({
            streamEncrypted: {
                _0: ciphertext,
            },
        })
    }
}

export function pairingDataEvent(
    data: Uint8Array,
    kind: string,
    opts?: { sendingHost?: string; startNewSession?: boolean },
): Record<string, unknown> {
    return encodePairingData({
        data,
        kind,
        sendingHost: (opts && opts.sendingHost) || '',
        startNewSession: !!(opts && opts.startNewSession),
    })
}

type AeadCipher = {
    encrypt(plain: Uint8Array, nonce: Uint8Array): Uint8Array
    decrypt(cipher: Uint8Array, nonce: Uint8Array): Uint8Array
}

export class CipherStream {
    controlChannel: ControlChannel
    clientCipher: AeadCipher
    serverCipher: AeadCipher
    nonce: Uint8Array
    sequence: number

    constructor(controlChannel: ControlChannel, clientCipher: AeadCipher, serverCipher: AeadCipher) {
        this.controlChannel = controlChannel
        this.clientCipher = clientCipher
        this.serverCipher = serverCipher
        this.nonce = new Uint8Array(12)
        this.sequence = 0
    }

    private updateNonce() {
        const seq = new Uint8Array(8)
        new DataView(seq.buffer).setBigUint64(0, BigInt(this.sequence), true)
        this.nonce.set(seq, 0)
    }

    async write(message: Record<string, unknown>): Promise<void> {
        this.updateNonce()
        const marshalled = new TextEncoder().encode(JSON.stringify(message))
        const encrypted = this.clientCipher.encrypt(marshalled, this.nonce)
        this.sequence += 1
        this.controlChannel.writeEncrypted(encrypted)
    }

    async read(): Promise<Record<string, unknown>> {
        const m = await this.controlChannel.read()
        const streamEncr = getChildMap(m, 'streamEncrypted')
        const raw = streamEncr['_0']
        let cip: Uint8Array | null = null
        if (raw instanceof Uint8Array) cip = raw
        else if (typeof raw === 'string') {
            try {
                const bin = atob(raw)
                cip = new Uint8Array(bin.length)
                for (let i = 0; i < bin.length; i++) cip[i] = bin.charCodeAt(i)
            } catch {
                cip = new TextEncoder().encode(raw)
            }
        }
        if (!cip) throw new Error('CipherStream.read: missing ciphertext')
        const plain = this.serverCipher.decrypt(cip, this.nonce)
        return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>
    }
}
