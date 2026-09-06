// Minimal HTTP/2 implementation for RemoteXPC
// Only handles: connection preface, SETTINGS, WINDOW_UPDATE, DATA, HEADERS
export var FRAME_DATA = 0x00;
export var FRAME_HEADERS = 0x01;
export var FRAME_RST_STREAM = 0x03;
export var FRAME_SETTINGS = 0x04;
export var FRAME_PING = 0x06;
export var FRAME_GOAWAY = 0x07;
export var FRAME_WINDOW_UPDATE = 0x08;
export var FLAG_ACK = 0x01;
export var FLAG_END_STREAM = 0x01;
export var FLAG_END_HEADERS = 0x04;
export var SETTINGS_HEADER_TABLE_SIZE = 0x01;
export var SETTINGS_ENABLE_PUSH = 0x02;
export var SETTINGS_MAX_CONCURRENT_STREAMS = 0x03;
export var SETTINGS_INITIAL_WINDOW_SIZE = 0x04;
export var SETTINGS_MAX_FRAME_SIZE = 0x05;
export var SETTINGS_MAX_HEADER_LIST_SIZE = 0x06;
export var http2DebugLog = null;
export function setHttp2DebugLog(fn) { http2DebugLog = fn; }
function http2Debug(msg) {
    if (http2DebugLog)
        http2DebugLog(msg);
}
function http2HexDump(data, maxBytes = 48) {
    const len = Math.min(data.length, maxBytes);
    const parts = [];
    for (let i = 0; i < len; i++)
        parts.push(data[i].toString(16).padStart(2, '0'));
    if (data.length > maxBytes)
        parts.push('...');
    return parts.join(' ');
}
export function getClientPreface() {
    var preface = 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n';
    http2Debug(`[HTTP2] PREFACE: "${preface.replace(/\r\n/g, '\\r\\n')}"`);
    var arr = new Uint8Array(preface.length);
    for (var i = 0; i < preface.length; i++) {
        arr[i] = preface.charCodeAt(i);
    }
    return arr;
}
export function parseHttp2Frame(data) {
    if (data.length < 9) {
        http2Debug(`[HTTP2] PARSE: need at least 9 bytes, have ${data.length}`);
        return null;
    }
    var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    var length = (data[0] << 16) | (data[1] << 8) | data[2];
    var type = data[3];
    var flags = data[4];
    var streamId = view.getUint32(5, false) & 0x7FFFFFFF;
    if (data.length < 9 + length) {
        http2Debug(`[HTTP2] PARSE: incomplete frame, need ${9 + length}B, have ${data.length}B (type=${type} len=${length})`);
        return null;
    }
    var payload = data.slice(9, 9 + length);
    var remaining = data.slice(9 + length);
    const typeNames = {
        0: 'DATA', 1: 'HEADERS', 2: 'PRIORITY', 3: 'RST_STREAM',
        4: 'SETTINGS', 5: 'PUSH_PROMISE', 6: 'PING', 7: 'GOAWAY', 8: 'WINDOW_UPDATE'
    };
    const typeName = typeNames[type] || `UNKNOWN(${type})`;
    http2Debug(`[HTTP2] PARSE: ${typeName} stream=${streamId} flags=0x${flags.toString(16)} len=${length}`);
    http2Debug(`[HTTP2]   raw frame header: ${http2HexDump(data.slice(0, 9))}`);
    if (payload.length > 0 && payload.length <= 64) {
        http2Debug(`[HTTP2]   payload: ${http2HexDump(payload)}`);
    }
    else if (payload.length > 64) {
        http2Debug(`[HTTP2]   payload: ${payload.length}B (first 32: ${http2HexDump(payload, 32)})`);
    }
    return [{ length: length, type: type, flags: flags, streamId: streamId, payload: payload }, remaining];
}
export function buildHttp2Frame(type, flags, streamId, payload) {
    var frame = new Uint8Array(9 + payload.length);
    var view = new DataView(frame.buffer);
    frame[0] = (payload.length >> 16) & 0xFF;
    frame[1] = (payload.length >> 8) & 0xFF;
    frame[2] = payload.length & 0xFF;
    frame[3] = type;
    frame[4] = flags;
    view.setUint32(5, streamId & 0x7FFFFFFF, false);
    frame.set(payload, 9);
    const typeNames = {
        0: 'DATA', 1: 'HEADERS', 2: 'PRIORITY', 3: 'RST_STREAM',
        4: 'SETTINGS', 5: 'PUSH_PROMISE', 6: 'PING', 7: 'GOAWAY', 8: 'WINDOW_UPDATE'
    };
    const typeName = typeNames[type] || `UNKNOWN(${type})`;
    http2Debug(`[HTTP2] BUILD: ${typeName} stream=${streamId} flags=0x${flags.toString(16)} len=${payload.length} total=${frame.length}B`);
    return frame;
}
export function buildSettingsFrame(settings) {
    var entries = [];
    if (settings.headerTableSize !== undefined)
        entries.push([SETTINGS_HEADER_TABLE_SIZE, settings.headerTableSize]);
    if (settings.enablePush !== undefined)
        entries.push([SETTINGS_ENABLE_PUSH, settings.enablePush ? 1 : 0]);
    if (settings.maxConcurrentStreams !== undefined)
        entries.push([SETTINGS_MAX_CONCURRENT_STREAMS, settings.maxConcurrentStreams]);
    if (settings.initialWindowSize !== undefined)
        entries.push([SETTINGS_INITIAL_WINDOW_SIZE, settings.initialWindowSize]);
    if (settings.maxFrameSize !== undefined)
        entries.push([SETTINGS_MAX_FRAME_SIZE, settings.maxFrameSize]);
    if (settings.maxHeaderListSize !== undefined)
        entries.push([SETTINGS_MAX_HEADER_LIST_SIZE, settings.maxHeaderListSize]);
    var payload = new Uint8Array(entries.length * 6);
    var pView = new DataView(payload.buffer);
    for (var i = 0; i < entries.length; i++) {
        pView.setUint16(i * 6, entries[i][0], false);
        pView.setUint32(i * 6 + 2, entries[i][1], false);
    }
    return buildHttp2Frame(FRAME_SETTINGS, 0, 0, payload);
}
export function buildSettingsAck() {
    return buildHttp2Frame(FRAME_SETTINGS, FLAG_ACK, 0, new Uint8Array(0));
}
export function buildWindowUpdate(streamId, increment) {
    var payload = new Uint8Array(4);
    var view = new DataView(payload.buffer);
    view.setUint32(0, increment & 0x7FFFFFFF, false);
    return buildHttp2Frame(FRAME_WINDOW_UPDATE, 0, streamId, payload);
}
export function buildDataFrame(streamId, data, endStream) {
    return buildHttp2Frame(FRAME_DATA, endStream ? FLAG_END_STREAM : 0, streamId, data);
}
/** Open a RemoteXPC stream with empty HEADERS (matches go-ios http.HttpConnection.write). */
export function buildHeadersFrame(streamId) {
    return buildHttp2Frame(FRAME_HEADERS, FLAG_END_HEADERS, streamId, new Uint8Array(0));
}
export function parseSettings(payload) {
    var settings = {};
    var view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    for (var i = 0; i + 6 <= payload.length; i += 6) {
        var id = view.getUint16(i, false);
        var value = view.getUint32(i + 2, false);
        switch (id) {
            case SETTINGS_HEADER_TABLE_SIZE:
                settings.headerTableSize = value;
                break;
            case SETTINGS_ENABLE_PUSH:
                settings.enablePush = value === 1;
                break;
            case SETTINGS_MAX_CONCURRENT_STREAMS:
                settings.maxConcurrentStreams = value;
                break;
            case SETTINGS_INITIAL_WINDOW_SIZE:
                settings.initialWindowSize = value;
                break;
            case SETTINGS_MAX_FRAME_SIZE:
                settings.maxFrameSize = value;
                break;
            case SETTINGS_MAX_HEADER_LIST_SIZE:
                settings.maxHeaderListSize = value;
                break;
        }
    }
    return settings;
}
export class Http2Connection {
    constructor(sendRaw) {
        this.sendRaw = sendRaw;
        this.buffer = new Uint8Array(0);
        this.prefaceSent = false;
        this.peerSettingsReceived = false;
        this.onStreamData = {};
        this.openedStreams = {};
        this.onReady = null;
        this.log = null;
        this.clientStreamId = 1;
        this.serverStreamId = 3;
    }
    _log(msg) {
        if (this.log)
            this.log('[HTTP/2] ' + msg);
    }
    start() {
        this._log('Sending client preface + SETTINGS + WINDOW_UPDATE (batched)');
        var preface = getClientPreface();
        var settings = buildSettingsFrame({
            maxConcurrentStreams: 100,
            initialWindowSize: 1048576,
        });
        var winUpdate = buildWindowUpdate(0, 983041);
        http2Debug(`[HTTP2] SETTINGS frame contents:`);
        http2Debug(`[HTTP2]   MAX_CONCURRENT_STREAMS = 100`);
        http2Debug(`[HTTP2]   INITIAL_WINDOW_SIZE = 1048576`);
        var total = preface.length + settings.length + winUpdate.length;
        var batch = new Uint8Array(total);
        batch.set(preface, 0);
        batch.set(settings, preface.length);
        batch.set(winUpdate, preface.length + settings.length);
        http2Debug(`[HTTP2] SENDING BATCH: preface(${preface.length}) + settings(${settings.length}) + winupdate(${winUpdate.length}) = ${total}B`);
        http2Debug(`[HTTP2]   batch bytes: ${http2HexDump(batch, 64)}`);
        this.sendRaw(batch);
        this._log('Sent ' + total + ' bytes (preface=' + preface.length + ' settings=' + settings.length + ' winupdate=' + winUpdate.length + ')');
        this.prefaceSent = true;
    }
    feed(data) {
        var newBuf = new Uint8Array(this.buffer.length + data.length);
        newBuf.set(this.buffer);
        newBuf.set(data, this.buffer.length);
        this.buffer = newBuf;
        while (true) {
            var result = parseHttp2Frame(this.buffer);
            if (!result)
                break;
            var frame = result[0];
            var remaining = result[1];
            this.buffer = remaining;
            this._handleFrame(frame);
        }
    }
    _handleFrame(frame) {
        var typeNames = {
            0: 'DATA', 1: 'HEADERS', 2: 'PRIORITY', 3: 'RST_STREAM',
            4: 'SETTINGS', 5: 'PUSH_PROMISE', 6: 'PING', 7: 'GOAWAY', 8: 'WINDOW_UPDATE'
        };
        var typeName = typeNames[frame.type] || ('UNKNOWN(' + frame.type + ')');
        this._log('Frame: ' + typeName + ' stream=' + frame.streamId + ' flags=0x' + frame.flags.toString(16) + ' len=' + frame.length);
        switch (frame.type) {
            case FRAME_SETTINGS:
                if (!(frame.flags & FLAG_ACK)) {
                    var settings = parseSettings(frame.payload);
                    this._log('Peer settings: ' + JSON.stringify(settings));
                    this.sendRaw(buildSettingsAck());
                    this._log('Sent SETTINGS ACK');
                    if (!this.peerSettingsReceived) {
                        this.peerSettingsReceived = true;
                        if (this.onReady)
                            this.onReady();
                    }
                }
                else {
                    this._log('SETTINGS ACK received');
                }
                break;
            case FRAME_HEADERS:
                this._log('HEADERS received on stream ' + frame.streamId);
                this.openedStreams[frame.streamId] = true;
                break;
            case FRAME_DATA:
                var handler = this.onStreamData[frame.streamId];
                if (handler) {
                    handler(frame.payload);
                }
                else {
                    this._log('No handler for stream ' + frame.streamId + ', ' + frame.payload.length + ' bytes dropped');
                }
                break;
            case FRAME_WINDOW_UPDATE:
                break;
            case FRAME_PING:
                if (!(frame.flags & FLAG_ACK)) {
                    this.sendRaw(buildHttp2Frame(FRAME_PING, FLAG_ACK, 0, frame.payload));
                }
                break;
            case FRAME_RST_STREAM:
                if (frame.payload.length >= 4) {
                    var rstView = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength);
                    var errCode = rstView.getUint32(0, false);
                    this._log('RST_STREAM on stream ' + frame.streamId + ' error=' + errCode + ' (0x2=PROTOCOL_ERROR)');
                }
                else {
                    this._log('RST_STREAM on stream ' + frame.streamId);
                }
                break;
            case FRAME_GOAWAY:
                if (frame.payload.length >= 8) {
                    var goView = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength);
                    var lastStreamId = goView.getUint32(0, false) & 0x7FFFFFFF;
                    var errorCode = goView.getUint32(4, false);
                    var debugData = frame.payload.length > 8 ? new TextDecoder().decode(frame.payload.slice(8)) : '';
                    this._log('GOAWAY: lastStream=' + lastStreamId + ' error=' + errorCode + ' debug="' + debugData + '"');
                }
                else {
                    this._log('GOAWAY received');
                }
                break;
            default:
                break;
        }
    }
    openStream(streamId) {
        if (!this.openedStreams[streamId]) {
            this._log('Opening stream ' + streamId + ' with HEADERS');
            this.sendRaw(buildHeadersFrame(streamId));
            this.openedStreams[streamId] = true;
        }
    }
    sendData(streamId, data) {
        if (!this.openedStreams[streamId]) {
            this._log('Opening stream ' + streamId + ' with HEADERS then DATA');
            this.sendRaw(buildHeadersFrame(streamId));
            this.openedStreams[streamId] = true;
        }
        this.sendRaw(buildDataFrame(streamId, data));
    }
}
//# sourceMappingURL=xhttp.js.map