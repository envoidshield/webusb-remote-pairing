// RemotePairing.ControlChannelMessageEnvelope (go-ios ios/tunnel/codec.go)
function getChild(m, keys) {
    let cur = m;
    for (let i = 0; i < keys.length; i++) {
        if (!cur || typeof cur !== 'object')
            return null;
        cur = cur[keys[i]];
    }
    if (!cur || typeof cur !== 'object')
        return null;
    return cur;
}
export function getChildMap(m, ...keys) {
    const found = getChild(m, keys);
    if (!found)
        throw new Error("getChildMap: could not find entry for '" + keys.join('.') + "'");
    return found;
}
export function encodePairingData(p) {
    return {
        pairingData: {
            _0: {
                data: p.data,
                kind: p.kind,
                sendingHost: p.sendingHost || '',
                startNewSession: !!p.startNewSession,
            },
        },
    };
}
export function decodePairingData(e) {
    const pd = getChildMap(e, 'pairingData', '_0');
    let data = new Uint8Array(0);
    const raw = pd['data'];
    if (raw instanceof Uint8Array)
        data = raw;
    else if (typeof raw === 'string') {
        try {
            const bin = atob(raw);
            data = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++)
                data[i] = bin.charCodeAt(i);
        }
        catch {
            data = new TextEncoder().encode(raw);
        }
    }
    return {
        data,
        kind: typeof pd['kind'] === 'string' ? pd['kind'] : '',
        sendingHost: typeof pd['sendingHost'] === 'string' ? pd['sendingHost'] : '',
        startNewSession: !!pd['startNewSession'],
    };
}
export function wrapEnvelope(message, sequenceNumber) {
    return {
        mangledTypeName: 'RemotePairing.ControlChannelMessageEnvelope',
        value: {
            message,
            originatedBy: 'host',
            sequenceNumber: BigInt(sequenceNumber),
        },
    };
}
export function unwrapEnvelope(p) {
    return getChildMap(p, 'value', 'message');
}
export class ControlChannel {
    constructor(conn, timeoutMs = 120000) {
        this.seqNr = 1;
        this.conn = conn;
        this.timeoutMs = timeoutMs;
    }
    write(message) {
        const e = wrapEnvelope(message, this.seqNr);
        this.seqNr += 1;
        this.conn.sendDict(e);
    }
    async read() {
        while (true) {
            const p = await this.conn.waitForDict(this.timeoutMs);
            if (p && p.value)
                return unwrapEnvelope(p);
        }
    }
    writeRequest(req) {
        this.write({
            plain: {
                _0: {
                    request: {
                        _0: req,
                    },
                },
            },
        });
    }
    writeEvent(encoded) {
        this.write({
            plain: {
                _0: {
                    event: {
                        _0: encoded,
                    },
                },
            },
        });
    }
    async readEvent() {
        const m = await this.read();
        return getChildMap(m, 'plain', '_0', 'event', '_0');
    }
    writePairingEvent(p) {
        this.writeEvent(encodePairingData(p));
    }
    async readPairingEvent() {
        return decodePairingData(await this.readEvent());
    }
    writeEncrypted(ciphertext) {
        this.write({
            streamEncrypted: {
                _0: ciphertext,
            },
        });
    }
}
export function pairingDataEvent(data, kind, opts) {
    return encodePairingData({
        data,
        kind,
        sendingHost: (opts && opts.sendingHost) || '',
        startNewSession: !!(opts && opts.startNewSession),
    });
}
export class CipherStream {
    constructor(controlChannel, clientCipher, serverCipher) {
        this.controlChannel = controlChannel;
        this.clientCipher = clientCipher;
        this.serverCipher = serverCipher;
        this.nonce = new Uint8Array(12);
        this.sequence = 0;
    }
    updateNonce() {
        const seq = new Uint8Array(8);
        new DataView(seq.buffer).setBigUint64(0, BigInt(this.sequence), true);
        this.nonce.set(seq, 0);
    }
    async write(message) {
        this.updateNonce();
        const marshalled = new TextEncoder().encode(JSON.stringify(message));
        const encrypted = this.clientCipher.encrypt(marshalled, this.nonce);
        this.sequence += 1;
        this.controlChannel.writeEncrypted(encrypted);
    }
    async read() {
        const m = await this.controlChannel.read();
        const streamEncr = getChildMap(m, 'streamEncrypted');
        const raw = streamEncr['_0'];
        let cip = null;
        if (raw instanceof Uint8Array)
            cip = raw;
        else if (typeof raw === 'string') {
            try {
                const bin = atob(raw);
                cip = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++)
                    cip[i] = bin.charCodeAt(i);
            }
            catch {
                cip = new TextEncoder().encode(raw);
            }
        }
        if (!cip)
            throw new Error('CipherStream.read: missing ciphertext');
        const plain = this.serverCipher.decrypt(cip, this.nonce);
        return JSON.parse(new TextDecoder().decode(plain));
    }
}
//# sourceMappingURL=channel.js.map