export declare const TCP_HEADER_MIN = 20;
export declare var tcpDebugLog: ((msg: string) => void) | null;
export declare function setTcpDebugLog(fn: ((msg: string) => void) | null): void;
export declare const TH_FIN = 1;
export declare const TH_SYN = 2;
export declare const TH_RST = 4;
export declare const TH_PSH = 8;
export declare const TH_ACK = 16;
export declare enum TcpState {
    CLOSED = "CLOSED",
    SYN_SENT = "SYN_SENT",
    ESTABLISHED = "ESTABLISHED",
    FIN_WAIT_1 = "FIN_WAIT_1",
    FIN_WAIT_2 = "FIN_WAIT_2",
    TIME_WAIT = "TIME_WAIT",
    CLOSE_WAIT = "CLOSE_WAIT",
    LAST_ACK = "LAST_ACK"
}
export interface TcpSegment {
    srcPort: number;
    dstPort: number;
    seqNum: number;
    ackNum: number;
    dataOffset: number;
    flags: number;
    windowSize: number;
    checksum: number;
    urgentPtr: number;
    options: Uint8Array;
    payload: Uint8Array;
}
export declare function parseTcp(data: Uint8Array): TcpSegment | null;
export declare function buildTcp(srcPort: number, dstPort: number, seqNum: number, ackNum: number, flags: number, windowSize: number, payload: Uint8Array, options?: Uint8Array): Uint8Array;
/**
 * Compute TCP checksum over IPv6 pseudo-header + TCP segment.
 */
export declare function tcpChecksum(srcAddr: Uint8Array, dstAddr: Uint8Array, tcpSegment: Uint8Array): number;
/**
 * Build a TCP segment with correct checksum for IPv6.
 */
export declare function buildTcpWithChecksum(srcAddr: Uint8Array, dstAddr: Uint8Array, srcPort: number, dstPort: number, seqNum: number, ackNum: number, flags: number, windowSize: number, payload: Uint8Array, options?: Uint8Array): Uint8Array;
export type TcpSendCallback = (ipv6Payload: Uint8Array) => void;
export declare class TcpConnection {
    state: TcpState;
    srcAddr: Uint8Array;
    dstAddr: Uint8Array;
    srcPort: number;
    dstPort: number;
    sendPacket: TcpSendCallback;
    localSeq: number;
    localAck: number;
    remoteWindowSize: number;
    onData: ((data: Uint8Array) => void) | null;
    onConnected: (() => void) | null;
    onClosed: (() => void) | null;
    onError: ((msg: string) => void) | null;
    log: ((msg: string) => void) | null;
    _initialSeq: number;
    _mss: number;
    constructor(srcAddr: Uint8Array, dstAddr: Uint8Array, srcPort: number, dstPort: number, sendPacket: TcpSendCallback);
    _log(msg: string): void;
    connect(): void;
    handleSegment(seg: TcpSegment): void;
    _handleSynSent(seg: TcpSegment): void;
    _handleEstablished(seg: TcpSegment): void;
    _handleFinWait1(seg: TcpSegment): void;
    _handleFinWait2(seg: TcpSegment): void;
    /**
     * Send data over the established connection.
     */
    send(data: Uint8Array): void;
    /**
     * Initiate graceful close (send FIN).
     */
    close(): void;
}
//# sourceMappingURL=tcpstack.d.ts.map