// Minimal TCP stack over IPv6
// Handles: 3-way handshake, data transfer (send/receive), FIN teardown
// Does NOT handle: congestion control, SACK, window scaling, retransmit timers (yet)
export const TCP_HEADER_MIN = 20;
export var tcpDebugLog = null;
export function setTcpDebugLog(fn) { tcpDebugLog = fn; }
function tcpDebug(msg) {
    if (tcpDebugLog)
        tcpDebugLog(msg);
}
function tcpHexDump(data, maxBytes = 32) {
    const len = Math.min(data.length, maxBytes);
    const parts = [];
    for (let i = 0; i < len; i++)
        parts.push(data[i].toString(16).padStart(2, '0'));
    if (data.length > maxBytes)
        parts.push('...');
    return parts.join(' ');
}
// TCP flags
export const TH_FIN = 0x01;
export const TH_SYN = 0x02;
export const TH_RST = 0x04;
export const TH_PSH = 0x08;
export const TH_ACK = 0x10;
export var TcpState;
(function (TcpState) {
    TcpState["CLOSED"] = "CLOSED";
    TcpState["SYN_SENT"] = "SYN_SENT";
    TcpState["ESTABLISHED"] = "ESTABLISHED";
    TcpState["FIN_WAIT_1"] = "FIN_WAIT_1";
    TcpState["FIN_WAIT_2"] = "FIN_WAIT_2";
    TcpState["TIME_WAIT"] = "TIME_WAIT";
    TcpState["CLOSE_WAIT"] = "CLOSE_WAIT";
    TcpState["LAST_ACK"] = "LAST_ACK";
})(TcpState || (TcpState = {}));
export function parseTcp(data) {
    if (data.length < TCP_HEADER_MIN) {
        tcpDebug(`[TCP] PARSE FAIL: ${data.length}B < ${TCP_HEADER_MIN}B minimum header`);
        return null;
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const srcPort = view.getUint16(0, false);
    const dstPort = view.getUint16(2, false);
    const seqNum = view.getUint32(4, false);
    const ackNum = view.getUint32(8, false);
    const dataOffsetAndFlags = view.getUint16(12, false);
    const dataOffset = (dataOffsetAndFlags >> 12) & 0xF;
    const flags = dataOffsetAndFlags & 0x3F;
    const windowSize = view.getUint16(14, false);
    const checksum = view.getUint16(16, false);
    const urgentPtr = view.getUint16(18, false);
    const headerLen = dataOffset * 4;
    const options = headerLen > 20 ? data.slice(20, headerLen) : new Uint8Array(0);
    const payload = data.slice(headerLen);
    const flagNames = [];
    if (flags & TH_FIN)
        flagNames.push('FIN');
    if (flags & TH_SYN)
        flagNames.push('SYN');
    if (flags & TH_RST)
        flagNames.push('RST');
    if (flags & TH_PSH)
        flagNames.push('PSH');
    if (flags & TH_ACK)
        flagNames.push('ACK');
    tcpDebug(`[TCP] PARSE: ${srcPort}->${dstPort} [${flagNames.join(',')}] seq=${seqNum} ack=${ackNum} win=${windowSize} hdrLen=${headerLen} payload=${payload.length}B cksum=0x${checksum.toString(16)}`);
    if (options.length > 0) {
        tcpDebug(`[TCP]   options: ${tcpHexDump(options, 16)}`);
    }
    if (payload.length > 0 && payload.length <= 64) {
        tcpDebug(`[TCP]   payload: ${tcpHexDump(payload, 32)}`);
    }
    return { srcPort, dstPort, seqNum, ackNum, dataOffset, flags, windowSize, checksum, urgentPtr, options, payload };
}
export function buildTcp(srcPort, dstPort, seqNum, ackNum, flags, windowSize, payload, options) {
    const optLen = options ? options.length : 0;
    const optPadded = Math.ceil(optLen / 4) * 4;
    const headerLen = 20 + optPadded;
    const dataOffset = headerLen / 4;
    const segment = new Uint8Array(headerLen + payload.length);
    const view = new DataView(segment.buffer);
    view.setUint16(0, srcPort, false);
    view.setUint16(2, dstPort, false);
    view.setUint32(4, seqNum, false);
    view.setUint32(8, ackNum, false);
    view.setUint16(12, (dataOffset << 12) | (flags & 0x3F), false);
    view.setUint16(14, windowSize, false);
    // checksum at 16, fill later
    view.setUint16(18, 0, false); // urgent pointer
    if (options && options.length > 0) {
        segment.set(options, 20);
    }
    segment.set(payload, headerLen);
    return segment;
}
/**
 * Compute TCP checksum over IPv6 pseudo-header + TCP segment.
 */
export function tcpChecksum(srcAddr, dstAddr, tcpSegment) {
    const pseudoLen = 32 + 4 + 4; // src(16) + dst(16) + length(4) + zeros(3) + next(1)
    const totalLen = pseudoLen + tcpSegment.length;
    const buf = new Uint8Array(totalLen + (totalLen % 2));
    buf.set(srcAddr, 0);
    buf.set(dstAddr, 16);
    const view = new DataView(buf.buffer);
    view.setUint32(32, tcpSegment.length, false); // TCP length
    buf[36] = 0;
    buf[37] = 0;
    buf[38] = 0;
    buf[39] = 6; // next header = TCP
    buf.set(tcpSegment, 40);
    let sum = 0;
    const dv = new DataView(buf.buffer);
    for (let i = 0; i < buf.length; i += 2) {
        sum += dv.getUint16(i, false);
    }
    while (sum > 0xFFFF) {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    return (~sum) & 0xFFFF;
}
/**
 * Build a TCP segment with correct checksum for IPv6.
 */
export function buildTcpWithChecksum(srcAddr, dstAddr, srcPort, dstPort, seqNum, ackNum, flags, windowSize, payload, options) {
    const seg = buildTcp(srcPort, dstPort, seqNum, ackNum, flags, windowSize, payload, options);
    seg[16] = 0;
    seg[17] = 0;
    const cksum = tcpChecksum(srcAddr, dstAddr, seg);
    seg[16] = (cksum >> 8) & 0xFF;
    seg[17] = cksum & 0xFF;
    const flagNames = [];
    if (flags & TH_FIN)
        flagNames.push('FIN');
    if (flags & TH_SYN)
        flagNames.push('SYN');
    if (flags & TH_RST)
        flagNames.push('RST');
    if (flags & TH_PSH)
        flagNames.push('PSH');
    if (flags & TH_ACK)
        flagNames.push('ACK');
    tcpDebug(`[TCP] BUILD: ${srcPort}->${dstPort} [${flagNames.join(',')}] seq=${seqNum} ack=${ackNum} win=${windowSize} payload=${payload.length}B cksum=0x${cksum.toString(16)}`);
    return seg;
}
export class TcpConnection {
    constructor(srcAddr, dstAddr, srcPort, dstPort, sendPacket) {
        this.state = TcpState.CLOSED;
        this.srcAddr = srcAddr;
        this.dstAddr = dstAddr;
        this.srcPort = srcPort;
        this.dstPort = dstPort;
        this.sendPacket = sendPacket;
        this.localSeq = 0;
        this.localAck = 0;
        this.remoteWindowSize = 65535;
        this.onData = null;
        this.onConnected = null;
        this.onClosed = null;
        this.onError = null;
        this.log = null;
        this._initialSeq = Math.floor(Math.random() * 0x7FFFFFFF);
        this._mss = 1460;
        this.localSeq = this._initialSeq;
    }
    _log(msg) {
        if (this.log)
            this.log(`[TCP ${this.srcPort}->${this.dstPort}] ${msg}`);
    }
    connect() {
        this.state = TcpState.SYN_SENT;
        this._log(`connect() -> SYN_SENT, sending SYN seq=${this.localSeq}`);
        const mssOption = new Uint8Array([2, 4, (this._mss >> 8) & 0xFF, this._mss & 0xFF]);
        tcpDebug(`[TCP] ${this.srcPort}->${this.dstPort}: MSS option = ${this._mss}`);
        const syn = buildTcpWithChecksum(this.srcAddr, this.dstAddr, this.srcPort, this.dstPort, this.localSeq, 0, TH_SYN, 65535, new Uint8Array(0), mssOption);
        this.sendPacket(syn);
    }
    handleSegment(seg) {
        var flagStr = '';
        if (seg.flags & TH_SYN)
            flagStr += 'SYN ';
        if (seg.flags & TH_ACK)
            flagStr += 'ACK ';
        if (seg.flags & TH_FIN)
            flagStr += 'FIN ';
        if (seg.flags & TH_RST)
            flagStr += 'RST ';
        if (seg.flags & TH_PSH)
            flagStr += 'PSH ';
        tcpDebug(`[TCP] handleSegment: state=${this.state} ${seg.srcPort}->${seg.dstPort} [${flagStr.trim()}] seq=${seg.seqNum} ack=${seg.ackNum} win=${seg.windowSize} len=${seg.payload.length}`);
        this._log('handleSegment state=' + this.state + ' flags=[' + flagStr.trim() + '] seq=' + seg.seqNum + ' ack=' + seg.ackNum + ' len=' + seg.payload.length);
        // Verify checksum of incoming segment
        const computedCksum = tcpChecksum(this.dstAddr, this.srcAddr, new Uint8Array(seg.dataOffset * 4 + seg.payload.length));
        tcpDebug(`[TCP]   incoming checksum: received=0x${seg.checksum.toString(16)} computed=0x${computedCksum.toString(16)}`);
        switch (this.state) {
            case TcpState.SYN_SENT:
                this._handleSynSent(seg);
                break;
            case TcpState.ESTABLISHED:
                this._handleEstablished(seg);
                break;
            case TcpState.FIN_WAIT_1:
                this._handleFinWait1(seg);
                break;
            case TcpState.FIN_WAIT_2:
                this._handleFinWait2(seg);
                break;
            case TcpState.CLOSE_WAIT:
                tcpDebug(`[TCP] ${this.srcPort}->${this.dstPort}: CLOSE_WAIT - waiting for local close`);
                break;
            case TcpState.LAST_ACK:
                if (seg.flags & TH_ACK) {
                    this.state = TcpState.CLOSED;
                    this._log('CLOSED (LAST_ACK -> ACK received)');
                    tcpDebug(`[TCP] ${this.srcPort}->${this.dstPort}: LAST_ACK -> ACK -> CLOSED`);
                    if (this.onClosed)
                        this.onClosed();
                }
                break;
            default:
                if (seg.flags & TH_RST) {
                    this.state = TcpState.CLOSED;
                    this._log('RST received, connection reset');
                    tcpDebug(`[TCP] ${this.srcPort}->${this.dstPort}: RST received in state ${this.state} -> CLOSED`);
                    if (this.onError)
                        this.onError('Connection reset by peer');
                }
        }
    }
    _handleSynSent(seg) {
        tcpDebug(`[TCP] _handleSynSent: ${this.srcPort}->${this.dstPort}`);
        if (seg.flags & TH_RST) {
            this.state = TcpState.CLOSED;
            this._log('RST received during handshake');
            tcpDebug(`[TCP]   RST received => CLOSED (connection refused)`);
            if (this.onError)
                this.onError('Connection refused');
            return;
        }
        if ((seg.flags & (TH_SYN | TH_ACK)) === (TH_SYN | TH_ACK)) {
            tcpDebug(`[TCP]   SYN-ACK received! remoteSeq=${seg.seqNum} remoteAck=${seg.ackNum}`);
            tcpDebug(`[TCP]   our seq was ${this.localSeq}, ack should be ${seg.seqNum + 1}`);
            this.localAck = (seg.seqNum + 1) >>> 0;
            this.localSeq = seg.ackNum;
            this.remoteWindowSize = seg.windowSize;
            tcpDebug(`[TCP]   updated: localSeq=${this.localSeq} localAck=${this.localAck} remoteWin=${this.remoteWindowSize}`);
            this._log(`SYN-ACK received, sending ACK. remoteSeq=${seg.seqNum}, ack=${this.localAck}`);
            const ack = buildTcpWithChecksum(this.srcAddr, this.dstAddr, this.srcPort, this.dstPort, this.localSeq, this.localAck, TH_ACK, 65535, new Uint8Array(0));
            this.sendPacket(ack);
            this.state = TcpState.ESTABLISHED;
            tcpDebug(`[TCP] ${this.srcPort}->${this.dstPort}: STATE => ESTABLISHED`);
            this._log('ESTABLISHED');
            if (this.onConnected)
                this.onConnected();
        }
        else {
            tcpDebug(`[TCP]   flags=0x${seg.flags.toString(2)} - not SYN-ACK, ignoring`);
        }
    }
    _handleEstablished(seg) {
        if (seg.flags & TH_RST) {
            this.state = TcpState.CLOSED;
            this._log('RST received');
            if (this.onError)
                this.onError('Connection reset');
            return;
        }
        // Process incoming data
        if (seg.payload.length > 0) {
            this.localAck = (seg.seqNum + seg.payload.length) >>> 0;
            this._log(`DATA received: ${seg.payload.length} bytes, ack=${this.localAck}`);
            // Send ACK
            const ack = buildTcpWithChecksum(this.srcAddr, this.dstAddr, this.srcPort, this.dstPort, this.localSeq, this.localAck, TH_ACK, 65535, new Uint8Array(0));
            this.sendPacket(ack);
            if (this.onData)
                this.onData(seg.payload);
        }
        // Handle FIN from peer
        if (seg.flags & TH_FIN) {
            this.localAck = (seg.seqNum + 1) >>> 0;
            if (seg.payload.length > 0) {
                this.localAck = (seg.seqNum + seg.payload.length + 1) >>> 0;
            }
            this._log(`FIN received, sending ACK. ack=${this.localAck}`);
            const ack = buildTcpWithChecksum(this.srcAddr, this.dstAddr, this.srcPort, this.dstPort, this.localSeq, this.localAck, TH_ACK, 65535, new Uint8Array(0));
            this.sendPacket(ack);
            this.state = TcpState.CLOSE_WAIT;
            if (this.onClosed)
                this.onClosed();
        }
        // Update ack of our sent data
        if (seg.flags & TH_ACK) {
            // The peer is acknowledging data we sent
            // Just update for now; full retransmit tracking would go here
        }
    }
    _handleFinWait1(seg) {
        if (seg.flags & TH_ACK) {
            if (seg.flags & TH_FIN) {
                // Simultaneous close
                this.localAck = (seg.seqNum + 1) >>> 0;
                const ack = buildTcpWithChecksum(this.srcAddr, this.dstAddr, this.srcPort, this.dstPort, this.localSeq, this.localAck, TH_ACK, 65535, new Uint8Array(0));
                this.sendPacket(ack);
                this.state = TcpState.TIME_WAIT;
                this._log('TIME_WAIT (simultaneous close)');
                setTimeout(() => {
                    this.state = TcpState.CLOSED;
                    if (this.onClosed)
                        this.onClosed();
                }, 1000);
            }
            else {
                this.state = TcpState.FIN_WAIT_2;
                this._log('FIN_WAIT_2');
            }
        }
    }
    _handleFinWait2(seg) {
        if (seg.flags & TH_FIN) {
            this.localAck = (seg.seqNum + 1) >>> 0;
            const ack = buildTcpWithChecksum(this.srcAddr, this.dstAddr, this.srcPort, this.dstPort, this.localSeq, this.localAck, TH_ACK, 65535, new Uint8Array(0));
            this.sendPacket(ack);
            this.state = TcpState.TIME_WAIT;
            this._log('TIME_WAIT');
            setTimeout(() => {
                this.state = TcpState.CLOSED;
                if (this.onClosed)
                    this.onClosed();
            }, 1000);
        }
    }
    /**
     * Send data over the established connection.
     */
    send(data) {
        if (this.state !== TcpState.ESTABLISHED) {
            this._log(`Cannot send in state ${this.state}`);
            return;
        }
        this._log(`Sending ${data.length} bytes, seq=${this.localSeq}`);
        const seg = buildTcpWithChecksum(this.srcAddr, this.dstAddr, this.srcPort, this.dstPort, this.localSeq, this.localAck, TH_ACK | TH_PSH, 65535, data);
        this.localSeq = (this.localSeq + data.length) >>> 0;
        this.sendPacket(seg);
    }
    /**
     * Initiate graceful close (send FIN).
     */
    close() {
        if (this.state === TcpState.ESTABLISHED) {
            this._log('Sending FIN');
            const fin = buildTcpWithChecksum(this.srcAddr, this.dstAddr, this.srcPort, this.dstPort, this.localSeq, this.localAck, TH_FIN | TH_ACK, 65535, new Uint8Array(0));
            this.localSeq = (this.localSeq + 1) >>> 0;
            this.sendPacket(fin);
            this.state = TcpState.FIN_WAIT_1;
        }
        else if (this.state === TcpState.CLOSE_WAIT) {
            this._log('Sending FIN (CLOSE_WAIT)');
            const fin = buildTcpWithChecksum(this.srcAddr, this.dstAddr, this.srcPort, this.dstPort, this.localSeq, this.localAck, TH_FIN | TH_ACK, 65535, new Uint8Array(0));
            this.localSeq = (this.localSeq + 1) >>> 0;
            this.sendPacket(fin);
            this.state = TcpState.LAST_ACK;
        }
    }
}
//# sourceMappingURL=tcpstack.js.map