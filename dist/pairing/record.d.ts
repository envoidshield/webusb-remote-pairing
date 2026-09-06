export declare const HOST_NAME = "EnVoid";
export declare function uuidV3(namespace: Uint8Array, name: string): string;
export declare function envoidHostIdentifier(): string;
export interface SelfIdentity {
    identifier: string;
    irk: Uint8Array;
    privateKey: Uint8Array;
    publicKey: Uint8Array;
}
export interface DevicePairRecord {
    private_key: Uint8Array;
    public_key: Uint8Array;
    remote_unlock_host_key: string;
}
export interface PairingStore {
    selfIdentity: SelfIdentity;
    devices: Record<string, DevicePairRecord>;
}
export declare function loadStore(): Promise<PairingStore | null>;
export declare function saveStore(store: PairingStore): Promise<void>;
export declare function createSelfIdentity(ed25519: {
    utils: {
        randomPrivateKey: () => Uint8Array;
    };
    getPublicKey: (s: Uint8Array) => Uint8Array;
}): SelfIdentity;
export declare function getOrCreateSelfIdentity(): Promise<SelfIdentity>;
export declare function saveTrustRecord(udid: string, selfId: SelfIdentity, hostKey: string): Promise<void>;
export declare function trustRecordToPlistXml(_udid: string, rec: DevicePairRecord): string;
export declare function downloadPlist(filename: string, xml: string): void;
export declare function saveDeviceRecord(udid: string, rec: DevicePairRecord, selfIdentity: SelfIdentity): Promise<void>;
/** XML plist compatible with pymobiledevice3 / go-ios autotrust TrustRecord. */
export declare function buildTrustRecordPlist(rec: DevicePairRecord): string;
export declare function downloadTrustRecord(udid: string, rec: DevicePairRecord): void;
//# sourceMappingURL=record.d.ts.map