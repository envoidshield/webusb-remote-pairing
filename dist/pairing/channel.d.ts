import { RemoteXpcConnection } from '../remotexpc';
export interface PairingData {
    data: Uint8Array;
    kind: string;
    sendingHost?: string;
    startNewSession?: boolean;
}
export declare function getChildMap(m: Record<string, any>, ...keys: string[]): Record<string, any>;
export declare function encodePairingData(p: PairingData): Record<string, any>;
/** Wait for SRP setup data after setupManualPairing, handling consent and rejection. */
export declare function readSetupPairingData(ch: ControlChannel, onStatus?: (msg: string) => void): Promise<PairingData>;
export declare function decodePairingData(e: Record<string, any>): PairingData;
export declare function wrapEnvelope(message: Record<string, any>, sequenceNumber: number): Record<string, any>;
export declare function unwrapEnvelope(p: Record<string, any>): Record<string, any>;
export declare class ControlChannel {
    seqNr: number;
    conn: RemoteXpcConnection;
    timeoutMs: number;
    constructor(conn: RemoteXpcConnection, timeoutMs?: number);
    write(message: Record<string, any>): void;
    read(): Promise<Record<string, any>>;
    writeRequest(req: Record<string, any>): void;
    writeEvent(encoded: Record<string, any>): void;
    readEvent(): Promise<Record<string, any>>;
    writePairingEvent(p: PairingData): void;
    readPairingEvent(): Promise<PairingData>;
    writeEncrypted(ciphertext: Uint8Array): void;
}
export declare function pairingDataEvent(data: Uint8Array, kind: string, opts?: {
    sendingHost?: string;
    startNewSession?: boolean;
}): Record<string, unknown>;
type AeadCipher = {
    encrypt(plain: Uint8Array, nonce: Uint8Array): Uint8Array;
    decrypt(cipher: Uint8Array, nonce: Uint8Array): Uint8Array;
};
export declare class CipherStream {
    controlChannel: ControlChannel;
    clientCipher: AeadCipher;
    serverCipher: AeadCipher;
    nonce: Uint8Array;
    sequence: number;
    constructor(controlChannel: ControlChannel, clientCipher: AeadCipher, serverCipher: AeadCipher);
    private updateNonce;
    write(message: Record<string, unknown>): Promise<void>;
    read(): Promise<Record<string, unknown>>;
}
export {};
//# sourceMappingURL=channel.d.ts.map