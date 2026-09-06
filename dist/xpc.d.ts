export declare const REMOTEXPC_MAGIC = 699403154;
export declare const XPC_OBJECT_MAGIC = 1108555586;
export declare const BODY_VERSION = 5;
export declare const XPC_TYPE_NULL = 4096;
export declare const XPC_TYPE_BOOL = 8192;
export declare const XPC_TYPE_INT64 = 12288;
export declare const XPC_TYPE_UINT64 = 16384;
export declare const XPC_TYPE_DOUBLE = 20480;
export declare const XPC_TYPE_DATE = 28672;
export declare const XPC_TYPE_DATA = 32768;
export declare const XPC_TYPE_STRING = 36864;
export declare const XPC_TYPE_UUID = 40960;
export declare const XPC_TYPE_ARRAY = 57344;
export declare const XPC_TYPE_DICT = 61440;
type XpcScalar = null | boolean | number | bigint | string | Uint8Array;
interface XpcDict {
    [key: string]: XpcScalar | XpcDict | XpcArray;
}
type XpcArray = Array<XpcScalar | XpcDict | XpcArray>;
export type XpcValue = XpcScalar | XpcDict | XpcArray;
export declare function decodeXpcObject(data: Uint8Array, offset?: number): {
    value: XpcValue;
    next: number;
};
export declare function decodeXpcBody(data: Uint8Array): Record<string, XpcValue> | null;
export declare function encodeXpcBody(dict: Record<string, XpcValue>): Uint8Array;
export declare function buildXpcEmptyDict(): Uint8Array;
export declare function getChildMap(m: Record<string, XpcValue>, ...keys: string[]): Record<string, XpcValue>;
export declare function getChildString(m: Record<string, XpcValue>, ...keys: string[]): string;
export declare const ALWAYS_SET_FLAG = 1;
export declare const DATA_FLAG = 256;
export declare const INIT_HANDSHAKE_FLAG = 4194304;
export declare function buildRemoteXpcMessage(flags: number, messageId: number, body: Uint8Array | null): Uint8Array;
export declare function encodeRemoteXpcDict(messageId: number, dict: Record<string, XpcValue>, extraFlags?: number): Uint8Array;
export interface RemoteXpcMessage {
    flags: number;
    bodyLength: number;
    messageId: number;
    body: Uint8Array | null;
}
export declare function parseRemoteXpcMessage(data: Uint8Array): [RemoteXpcMessage, Uint8Array] | null;
export declare const UNTRUSTED_TUNNEL_SERVICE = "com.apple.internal.dt.coredevice.untrusted.tunnelservice";
export declare function parseRsdHandshake(body: Record<string, XpcValue>): {
    udid: string;
    tunnelPort: number;
} | null;
export {};
//# sourceMappingURL=xpc.d.ts.map