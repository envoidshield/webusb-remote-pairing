export declare const TLV_METHOD = 0;
export declare const TLV_IDENTIFIER = 1;
export declare const TLV_SALT = 2;
export declare const TLV_PUBLIC_KEY = 3;
export declare const TLV_PROOF = 4;
export declare const TLV_ENCRYPTED_DATA = 5;
export declare const TLV_STATE = 6;
export declare const TLV_ERROR = 7;
export declare const TLV_SIGNATURE = 10;
export declare const TLV_INFO = 17;
export declare const PAIR_STATE_START_REQUEST = 1;
export declare const PAIR_STATE_START_RESPONSE = 2;
export declare const PAIR_STATE_VERIFY_REQUEST = 3;
export declare const PAIR_STATE_VERIFY_RESPONSE = 4;
export declare const PAIR_STATE_EXCHANGE_REQUEST = 5;
export declare const PAIR_STATE_EXCHANGE_RESPONSE = 6;
export declare const typeMethod = 0;
export declare const typeIdentifier = 1;
export declare const typeSalt = 2;
export declare const typePublicKey = 3;
export declare const typeProof = 4;
export declare const typeEncryptedData = 5;
export declare const typeState = 6;
export declare const typeSignature = 10;
export declare const typeInfo = 17;
export declare const pairStateVerifyRequest = 3;
export declare const pairStateExchangeRequest = 5;
export declare class TlvBuffer {
    chunks: number[];
    writeData(type: number, data: Uint8Array): void;
    writeByte(type: number, v: number): void;
    bytes(): Uint8Array;
}
export declare function tlvReadCoalesced(data: Uint8Array, type: number): Uint8Array;
//# sourceMappingURL=tlv.d.ts.map