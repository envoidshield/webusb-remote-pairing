// HomeKit-style TLV (go-ios ios/tunnel/tlv.go)
export const TLV_METHOD = 0x00;
export const TLV_IDENTIFIER = 0x01;
export const TLV_SALT = 0x02;
export const TLV_PUBLIC_KEY = 0x03;
export const TLV_PROOF = 0x04;
export const TLV_ENCRYPTED_DATA = 0x05;
export const TLV_STATE = 0x06;
export const TLV_ERROR = 0x07;
export const TLV_SIGNATURE = 0x0A;
export const TLV_INFO = 0x11;
export const PAIR_STATE_START_REQUEST = 0x01;
export const PAIR_STATE_START_RESPONSE = 0x02;
export const PAIR_STATE_VERIFY_REQUEST = 0x03;
export const PAIR_STATE_VERIFY_RESPONSE = 0x04;
export const PAIR_STATE_EXCHANGE_REQUEST = 0x05;
export const PAIR_STATE_EXCHANGE_RESPONSE = 0x06;
// Aliases matching go-ios naming (used by remotePair.ts)
export const typeMethod = TLV_METHOD;
export const typeIdentifier = TLV_IDENTIFIER;
export const typeSalt = TLV_SALT;
export const typePublicKey = TLV_PUBLIC_KEY;
export const typeProof = TLV_PROOF;
export const typeEncryptedData = TLV_ENCRYPTED_DATA;
export const typeState = TLV_STATE;
export const typeSignature = TLV_SIGNATURE;
export const typeInfo = TLV_INFO;
export const pairStateVerifyRequest = PAIR_STATE_VERIFY_REQUEST;
export const pairStateExchangeRequest = PAIR_STATE_EXCHANGE_REQUEST;
export class TlvBuffer {
    constructor() {
        this.chunks = [];
    }
    writeData(type, data) {
        let offset = 0;
        while (offset < data.length) {
            const remaining = data.length - offset;
            const chunk = remaining > 255 ? 255 : remaining;
            this.chunks.push(type & 0xff);
            this.chunks.push(chunk);
            for (let i = 0; i < chunk; i++)
                this.chunks.push(data[offset + i]);
            offset += chunk;
        }
        if (data.length === 0) {
            this.chunks.push(type & 0xff);
            this.chunks.push(0);
        }
    }
    writeByte(type, v) {
        this.writeData(type, new Uint8Array([v & 0xff]));
    }
    bytes() {
        return new Uint8Array(this.chunks);
    }
}
export function tlvReadCoalesced(data, type) {
    const out = [];
    let i = 0;
    while (i + 2 <= data.length) {
        const t = data[i];
        const l = data[i + 1];
        i += 2;
        if (i + l > data.length)
            break;
        if (t === type) {
            for (let j = 0; j < l; j++)
                out.push(data[i + j]);
        }
        i += l;
    }
    return new Uint8Array(out);
}
//# sourceMappingURL=tlv.js.map