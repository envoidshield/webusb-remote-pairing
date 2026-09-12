export type PlistValue = string | boolean | number | Uint8Array | PlistValue[] | {
    [key: string]: PlistValue;
};
export declare function encodePlist(value: {
    [key: string]: PlistValue;
}): Uint8Array;
export declare function decodePlist(data: Uint8Array): {
    [key: string]: PlistValue;
};
export declare function buildPlistFrame(value: {
    [key: string]: PlistValue;
}): Uint8Array;
//# sourceMappingURL=plist.d.ts.map