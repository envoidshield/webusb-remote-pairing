export interface NcmDatagram {
    data: Uint8Array;
}
export interface NcmTransferBlock {
    sequence: number;
    datagrams: NcmDatagram[];
}
export declare var ncmDebugLog: ((msg: string) => void) | null;
export declare function setNcmDebugLog(fn: ((msg: string) => void) | null): void;
export declare function hexDump(data: Uint8Array | DataView, maxBytes?: number): string;
/**
 * Parse a raw USB bulk transfer into NCM datagrams (Ethernet frames).
 */
export declare function parseNcmTransfer(raw: DataView): NcmTransferBlock | null;
export declare function buildNcmTransfer(ethernetFrame: Uint8Array): Uint8Array;
export declare function resetNcmSequence(): void;
//# sourceMappingURL=ncm.d.ts.map