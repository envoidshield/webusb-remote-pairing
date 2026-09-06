export declare var FRAME_DATA: number;
export declare var FRAME_HEADERS: number;
export declare var FRAME_RST_STREAM: number;
export declare var FRAME_SETTINGS: number;
export declare var FRAME_PING: number;
export declare var FRAME_GOAWAY: number;
export declare var FRAME_WINDOW_UPDATE: number;
export declare var FLAG_ACK: number;
export declare var FLAG_END_STREAM: number;
export declare var FLAG_END_HEADERS: number;
export declare var SETTINGS_HEADER_TABLE_SIZE: number;
export declare var SETTINGS_ENABLE_PUSH: number;
export declare var SETTINGS_MAX_CONCURRENT_STREAMS: number;
export declare var SETTINGS_INITIAL_WINDOW_SIZE: number;
export declare var SETTINGS_MAX_FRAME_SIZE: number;
export declare var SETTINGS_MAX_HEADER_LIST_SIZE: number;
export declare var http2DebugLog: ((msg: string) => void) | null;
export declare function setHttp2DebugLog(fn: ((msg: string) => void) | null): void;
export interface Http2Frame {
    length: number;
    type: number;
    flags: number;
    streamId: number;
    payload: Uint8Array;
}
export interface Http2Settings {
    headerTableSize?: number;
    enablePush?: boolean;
    maxConcurrentStreams?: number;
    initialWindowSize?: number;
    maxFrameSize?: number;
    maxHeaderListSize?: number;
}
export declare function getClientPreface(): Uint8Array;
export declare function parseHttp2Frame(data: Uint8Array): [Http2Frame, Uint8Array] | null;
export declare function buildHttp2Frame(type: number, flags: number, streamId: number, payload: Uint8Array): Uint8Array;
export declare function buildSettingsFrame(settings: Http2Settings): Uint8Array;
export declare function buildSettingsAck(): Uint8Array;
export declare function buildWindowUpdate(streamId: number, increment: number): Uint8Array;
export declare function buildDataFrame(streamId: number, data: Uint8Array, endStream?: boolean): Uint8Array;
/** Open a RemoteXPC stream with empty HEADERS (matches go-ios http.HttpConnection.write). */
export declare function buildHeadersFrame(streamId: number): Uint8Array;
export declare function parseSettings(payload: Uint8Array): Http2Settings;
export type Http2SendCallback = (data: Uint8Array) => void;
export declare class Http2Connection {
    sendRaw: Http2SendCallback;
    buffer: Uint8Array;
    prefaceSent: boolean;
    peerSettingsReceived: boolean;
    onStreamData: {
        [streamId: number]: (data: Uint8Array) => void;
    };
    openedStreams: {
        [streamId: number]: boolean;
    };
    onReady: (() => void) | null;
    log: ((msg: string) => void) | null;
    clientStreamId: number;
    serverStreamId: number;
    constructor(sendRaw: Http2SendCallback);
    _log(msg: string): void;
    start(): void;
    feed(data: Uint8Array): void;
    _handleFrame(frame: Http2Frame): void;
    openStream(streamId: number): void;
    sendData(streamId: number, data: Uint8Array): void;
}
//# sourceMappingURL=xhttp.d.ts.map