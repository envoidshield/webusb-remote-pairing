import { XpcValue } from './xpc';
export { ALWAYS_SET_FLAG, DATA_FLAG, INIT_HANDSHAKE_FLAG, TRUSTED_LOCKDOWN_SERVICE, UNTRUSTED_LOCKDOWN_SERVICE, UNTRUSTED_TUNNEL_SERVICE, buildRemoteXpcMessage, buildXpcEmptyDict, decodeXpcBody, encodeXpcBody, parseRemoteXpcMessage, parseRsdHandshake, REMOTEXPC_MAGIC, XPC_OBJECT_MAGIC, } from './xpc';
export type { RemoteXpcMessage, XpcValue } from './xpc';
export declare var xpcDebugLog: ((msg: string) => void) | null;
export declare function setXpcDebugLog(fn: ((msg: string) => void) | null): void;
export type XpcSendCallback = (streamId: number, data: Uint8Array) => void;
export declare class RemoteXpcConnection {
    sendOnStream: XpcSendCallback;
    messageId: number;
    buffer: Uint8Array;
    onMessage: ((parsed: Record<string, XpcValue> | null, flags: number) => void) | null;
    log: ((msg: string) => void) | null;
    clientStreamId: number;
    serverStreamId: number;
    private inbox;
    private waiters;
    private msgQueue;
    private msgWaiters;
    constructor(sendOnStream: XpcSendCallback, clientStreamId?: number, serverStreamId?: number);
    _log(msg: string): void;
    initialize(): Promise<void>;
    feed(data: Uint8Array): void;
    sendDict(dict: Record<string, XpcValue>): void;
    waitForAnyMessage(timeoutMs?: number): Promise<{
        parsed: Record<string, XpcValue> | null;
        flags: number;
    }>;
    waitForDict(timeoutMs?: number): Promise<Record<string, XpcValue>>;
}
//# sourceMappingURL=remotexpc.d.ts.map