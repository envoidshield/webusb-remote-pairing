export declare const SRP_N: bigint;
export declare const SRP_G: bigint;
export declare const SRP_N_BYTES: number;
export declare const SRP_USERNAME = "Pair-Setup";
export declare const SRP_PASSWORD = "000000";
export declare function padToN(n: bigint): Uint8Array;
/** Apple / go-ios x: SHA512(salt || SHA512("Pair-Setup:" || password)) */
export declare function srpXHash(salt: Uint8Array, password?: string): Uint8Array;
export interface SrpClientSession {
    clientPublic: Uint8Array;
    clientProof: Uint8Array;
    sessionKey: Uint8Array;
    verifyServerProof: (proof: Uint8Array) => boolean;
}
export declare function newSrpClient(salt: Uint8Array, serverPublicB: Uint8Array, password?: string): SrpClientSession;
export declare const newSrpSession: typeof newSrpClient;
//# sourceMappingURL=srp.d.ts.map