// RemoteXPC connection over HTTP/2 streams. Codec lives in xpc.ts (go-ios encoding.go).
import { ALWAYS_SET_FLAG, DATA_FLAG, INIT_HANDSHAKE_FLAG, buildRemoteXpcMessage, buildXpcEmptyDict, decodeXpcBody, encodeXpcBody, parseRemoteXpcMessage, } from './xpc';
export { ALWAYS_SET_FLAG, DATA_FLAG, INIT_HANDSHAKE_FLAG, TRUSTED_LOCKDOWN_SERVICE, UNTRUSTED_LOCKDOWN_SERVICE, UNTRUSTED_TUNNEL_SERVICE, buildRemoteXpcMessage, buildXpcEmptyDict, decodeXpcBody, encodeXpcBody, parseRemoteXpcMessage, parseRsdHandshake, REMOTEXPC_MAGIC, XPC_OBJECT_MAGIC, } from './xpc';
export var xpcDebugLog = null;
export function setXpcDebugLog(fn) { xpcDebugLog = fn; }
export class RemoteXpcConnection {
    constructor(sendOnStream, clientStreamId, serverStreamId) {
        this.inbox = [];
        this.waiters = [];
        this.msgQueue = [];
        this.msgWaiters = [];
        this.sendOnStream = sendOnStream;
        this.messageId = 0;
        this.buffer = new Uint8Array(0);
        this.onMessage = null;
        this.log = null;
        this.clientStreamId = clientStreamId || 1;
        this.serverStreamId = serverStreamId || 3;
    }
    _log(msg) {
        if (this.log)
            this.log('[RemoteXPC] ' + msg);
    }
    async initialize() {
        this._log('Init step 1: client stream, flags=ALWAYS_SET, empty dict');
        this.sendOnStream(this.clientStreamId, buildRemoteXpcMessage(ALWAYS_SET_FLAG, this.messageId++, buildXpcEmptyDict()));
        await this.waitForAnyMessage();
        this._log('Init step 2: server stream, flags=INIT_HANDSHAKE|ALWAYS_SET, nil body');
        this.sendOnStream(this.serverStreamId, buildRemoteXpcMessage(INIT_HANDSHAKE_FLAG | ALWAYS_SET_FLAG, this.messageId++, null));
        await this.waitForAnyMessage();
        this._log('Init step 3: client stream, flags=0x201, nil body');
        this.sendOnStream(this.clientStreamId, buildRemoteXpcMessage(0x201, this.messageId++, null));
        await this.waitForAnyMessage();
        this._log('Init complete');
    }
    feed(data) {
        const newBuf = new Uint8Array(this.buffer.length + data.length);
        newBuf.set(this.buffer);
        newBuf.set(data, this.buffer.length);
        this.buffer = newBuf;
        while (true) {
            const result = parseRemoteXpcMessage(this.buffer);
            if (!result)
                break;
            const [msg, remaining] = result;
            this.buffer = remaining;
            this._log('Message: flags=0x' + msg.flags.toString(16) + ' bodyLen=' + msg.bodyLength);
            let parsed = null;
            if (msg.body && msg.body.length >= 16) {
                parsed = decodeXpcBody(msg.body);
                if (parsed)
                    this._log('  Parsed dict keys: ' + Object.keys(parsed).join(', '));
            }
            const notification = { parsed, flags: msg.flags };
            if (this.msgWaiters.length > 0) {
                this.msgWaiters.shift()(notification);
            }
            else {
                this.msgQueue.push(notification);
            }
            // Control-channel envelopes only — skip init chatter (e.g. ServiceVersion).
            if (parsed && parsed.value !== undefined && parsed.value !== null) {
                if (this.waiters.length > 0)
                    this.waiters.shift()(parsed);
                else
                    this.inbox.push(parsed);
            }
            if (this.onMessage)
                this.onMessage(parsed, msg.flags);
        }
    }
    sendDict(dict) {
        const body = encodeXpcBody(dict);
        this.sendOnStream(this.clientStreamId, buildRemoteXpcMessage(ALWAYS_SET_FLAG | DATA_FLAG, this.messageId++, body));
    }
    waitForAnyMessage(timeoutMs = 120000) {
        if (this.msgQueue.length > 0) {
            return Promise.resolve(this.msgQueue.shift());
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.msgWaiters.indexOf(onMsg);
                if (idx >= 0)
                    this.msgWaiters.splice(idx, 1);
                reject(new Error('RemoteXPC waitForAnyMessage timed out after ' + timeoutMs + 'ms'));
            }, timeoutMs);
            const onMsg = (msg) => {
                clearTimeout(timer);
                resolve(msg);
            };
            this.msgWaiters.push(onMsg);
        });
    }
    waitForDict(timeoutMs = 120000) {
        if (this.inbox.length > 0)
            return Promise.resolve(this.inbox.shift());
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.waiters.indexOf(onObj);
                if (idx >= 0)
                    this.waiters.splice(idx, 1);
                reject(new Error('RemoteXPC waitForDict timed out after ' + timeoutMs + 'ms'));
            }, timeoutMs);
            const onObj = (obj) => {
                clearTimeout(timer);
                resolve(obj);
            };
            this.waiters.push(onObj);
        });
    }
}
//# sourceMappingURL=remotexpc.js.map