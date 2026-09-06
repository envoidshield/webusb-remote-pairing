// RemoteXPC object codec (port of go-ios/ios/xpc/encoding.go)
export const REMOTEXPC_MAGIC = 0x29b00b92;
export const XPC_OBJECT_MAGIC = 0x42133742;
export const BODY_VERSION = 5;
export const XPC_TYPE_NULL = 0x00001000;
export const XPC_TYPE_BOOL = 0x00002000;
export const XPC_TYPE_INT64 = 0x00003000;
export const XPC_TYPE_UINT64 = 0x00004000;
export const XPC_TYPE_DOUBLE = 0x00005000;
export const XPC_TYPE_DATE = 0x00007000;
export const XPC_TYPE_DATA = 0x00008000;
export const XPC_TYPE_STRING = 0x00009000;
export const XPC_TYPE_UUID = 0x0000a000;
export const XPC_TYPE_ARRAY = 0x0000e000;
export const XPC_TYPE_DICT = 0x0000f000;
function calcPadding(l) {
    const c = Math.ceil(l / 4);
    return c * 4 - l;
}
function align4(offset) {
    return (offset + 3) & ~3;
}
export function decodeXpcObject(data, offset = 0) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const t = view.getUint32(offset, true);
    offset += 4;
    switch (t) {
        case XPC_TYPE_NULL:
            return { value: null, next: offset };
        case XPC_TYPE_BOOL: {
            const b = view.getUint8(offset) !== 0;
            return { value: b, next: offset + 4 };
        }
        case XPC_TYPE_INT64: {
            const lo = view.getUint32(offset, true);
            const hi = view.getUint32(offset + 4, true);
            const v = hi * 0x100000000 + lo;
            return { value: v > 0x7fffffff ? BigInt(v) : v, next: offset + 8 };
        }
        case XPC_TYPE_UINT64: {
            const lo = view.getUint32(offset, true);
            const hi = view.getUint32(offset + 4, true);
            return { value: BigInt(lo) + (BigInt(hi) << BigInt(32)), next: offset + 8 };
        }
        case XPC_TYPE_DOUBLE:
            return { value: view.getFloat64(offset, true), next: offset + 8 };
        case XPC_TYPE_DATE:
            return { value: view.getBigInt64(offset, true), next: offset + 8 };
        case XPC_TYPE_DATA: {
            const l = view.getUint32(offset, true);
            offset += 4;
            const bytes = data.slice(offset, offset + l);
            return { value: bytes, next: align4(offset + l) };
        }
        case XPC_TYPE_STRING: {
            const l = view.getUint32(offset, true);
            offset += 4;
            const raw = data.slice(offset, offset + l);
            const str = new TextDecoder().decode(raw).replace(/\0+$/, '');
            return { value: str, next: align4(offset + l) };
        }
        case XPC_TYPE_UUID: {
            const bytes = data.slice(offset, offset + 16);
            return { value: bytes, next: offset + 16 };
        }
        case XPC_TYPE_ARRAY: {
            view.getUint32(offset, true); // object payload length
            offset += 4;
            const numEntries = view.getUint32(offset, true);
            offset += 4;
            const arr = [];
            for (let i = 0; i < numEntries; i++) {
                const item = decodeXpcObject(data, offset);
                arr.push(item.value);
                offset = item.next;
            }
            return { value: arr, next: offset };
        }
        case XPC_TYPE_DICT: {
            const payloadLen = view.getUint32(offset, true);
            offset += 4;
            const numEntries = view.getUint32(offset, true);
            offset += 4;
            const end = offset + payloadLen - 4;
            const dict = {};
            for (let i = 0; i < numEntries && offset < end; i++) {
                const keyStart = offset;
                while (offset < data.length && data[offset] !== 0)
                    offset++;
                const key = new TextDecoder().decode(data.slice(keyStart, offset));
                offset++;
                offset = align4(offset);
                const item = decodeXpcObject(data, offset);
                dict[key] = item.value;
                offset = item.next;
            }
            return { value: dict, next: offset };
        }
        default:
            throw new Error(`decodeXpcObject: unknown type 0x${t.toString(16)}`);
    }
}
export function decodeXpcBody(data) {
    if (data.length < 16)
        return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0, true) !== XPC_OBJECT_MAGIC)
        return null;
    if (view.getUint32(4, true) !== BODY_VERSION)
        return null;
    const result = decodeXpcObject(data, 8);
    if (result.value && typeof result.value === 'object' && !Array.isArray(result.value) && !(result.value instanceof Uint8Array)) {
        return result.value;
    }
    return null;
}
function encodeDictionaryKey(buf, key) {
    const content = new TextEncoder().encode(key);
    for (let i = 0; i < content.length; i++)
        buf.push(content[i]);
    buf.push(0);
    const pad = calcPadding(content.length + 1);
    for (let i = 0; i < pad; i++)
        buf.push(0);
}
function writeU32(buf, v) {
    buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
}
function writeU64(buf, v) {
    const lo = Number(v & BigInt(0xffffffff));
    const hi = Number((v >> BigInt(32)) & BigInt(0xffffffff));
    writeU32(buf, lo);
    writeU32(buf, hi);
}
function encodeObjectPayload(value) {
    const payload = [];
    if (value === null || value === undefined) {
        writeU32(payload, XPC_TYPE_NULL);
        return payload;
    }
    if (typeof value === 'boolean') {
        writeU32(payload, XPC_TYPE_BOOL);
        payload.push(value ? 1 : 0, 0, 0, 0);
        return payload;
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            writeU32(payload, XPC_TYPE_INT64);
            writeU64(payload, BigInt(value));
        }
        else {
            writeU32(payload, XPC_TYPE_DOUBLE);
            const view = new DataView(new ArrayBuffer(8));
            view.setFloat64(0, value, true);
            for (let i = 0; i < 8; i++)
                payload.push(view.getUint8(i));
        }
        return payload;
    }
    if (typeof value === 'bigint') {
        writeU32(payload, XPC_TYPE_UINT64);
        writeU64(payload, value);
        return payload;
    }
    if (typeof value === 'string') {
        writeU32(payload, XPC_TYPE_STRING);
        const bytes = new TextEncoder().encode(value);
        writeU32(payload, bytes.length + 1);
        for (let i = 0; i < bytes.length; i++)
            payload.push(bytes[i]);
        payload.push(0);
        const pad = calcPadding(bytes.length + 1);
        for (let i = 0; i < pad; i++)
            payload.push(0);
        return payload;
    }
    if (value instanceof Uint8Array) {
        writeU32(payload, XPC_TYPE_DATA);
        writeU32(payload, value.length);
        for (let i = 0; i < value.length; i++)
            payload.push(value[i]);
        const pad = calcPadding(value.length);
        for (let i = 0; i < pad; i++)
            payload.push(0);
        return payload;
    }
    if (Array.isArray(value)) {
        const objects = [];
        for (const item of value) {
            objects.push(...encodeObjectPayload(item));
        }
        writeU32(payload, XPC_TYPE_ARRAY);
        writeU32(payload, objects.length);
        writeU32(payload, value.length);
        payload.push(...objects);
        return payload;
    }
    const dict = value;
    const inner = [];
    writeU32(inner, Object.keys(dict).length);
    for (const [k, v] of Object.entries(dict)) {
        encodeDictionaryKey(inner, k);
        inner.push(...encodeObjectPayload(v));
    }
    writeU32(payload, XPC_TYPE_DICT);
    writeU32(payload, inner.length);
    payload.push(...inner);
    return payload;
}
export function encodeXpcBody(dict) {
    const payload = encodeObjectPayload(dict);
    const buf = new Uint8Array(8 + payload.length);
    const view = new DataView(buf.buffer);
    view.setUint32(0, XPC_OBJECT_MAGIC, true);
    view.setUint32(4, BODY_VERSION, true);
    buf.set(new Uint8Array(payload), 8);
    return buf;
}
export function buildXpcEmptyDict() {
    return encodeXpcBody({});
}
export function getChildMap(m, ...keys) {
    let cur = m;
    for (const k of keys) {
        if (!cur || typeof cur !== 'object' || Array.isArray(cur) || cur instanceof Uint8Array) {
            throw new Error(`getChildMap: missing '${k}'`);
        }
        cur = cur[k];
    }
    if (!cur || typeof cur !== 'object' || Array.isArray(cur) || cur instanceof Uint8Array) {
        throw new Error('getChildMap: not a map');
    }
    return cur;
}
export function getChildString(m, ...keys) {
    let cur = m;
    for (const k of keys) {
        if (!cur || typeof cur !== 'object' || Array.isArray(cur) || cur instanceof Uint8Array) {
            throw new Error(`getChildString: missing '${k}'`);
        }
        cur = cur[k];
    }
    return String(cur);
}
export const ALWAYS_SET_FLAG = 0x00000001;
export const DATA_FLAG = 0x00000100;
export const INIT_HANDSHAKE_FLAG = 0x00400000;
export function buildRemoteXpcMessage(flags, messageId, body) {
    const bodyLen = body ? body.length : 0;
    const total = 24 + bodyLen;
    const buf = new Uint8Array(total);
    const view = new DataView(buf.buffer);
    view.setUint32(0, REMOTEXPC_MAGIC, true);
    view.setUint32(4, flags, true);
    view.setUint32(8, bodyLen, true);
    view.setUint32(12, 0, true);
    view.setUint32(16, messageId, true);
    view.setUint32(20, 0, true);
    if (body)
        buf.set(body, 24);
    return buf;
}
export function encodeRemoteXpcDict(messageId, dict, extraFlags = 0) {
    const body = encodeXpcBody(dict);
    return buildRemoteXpcMessage(ALWAYS_SET_FLAG | DATA_FLAG | extraFlags, messageId, body);
}
export function parseRemoteXpcMessage(data) {
    if (data.length < 24)
        return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0, true) !== REMOTEXPC_MAGIC)
        return null;
    const flags = view.getUint32(4, true);
    const bodyLength = view.getUint32(8, true) + view.getUint32(12, true) * 0x100000000;
    const messageId = view.getUint32(16, true) + view.getUint32(20, true) * 0x100000000;
    const totalLength = 24 + bodyLength;
    if (data.length < totalLength)
        return null;
    const body = bodyLength > 0 ? data.slice(24, 24 + bodyLength) : null;
    return [{ flags, bodyLength, messageId, body }, data.slice(totalLength)];
}
export const UNTRUSTED_TUNNEL_SERVICE = 'com.apple.internal.dt.coredevice.untrusted.tunnelservice';
export function parseRsdHandshake(body) {
    if (body.MessageType !== 'Handshake')
        return null;
    let udid = '';
    if (body.Properties && typeof body.Properties === 'object' && !Array.isArray(body.Properties)) {
        const props = body.Properties;
        if (typeof props.UniqueDeviceID === 'string')
            udid = props.UniqueDeviceID;
    }
    if (!udid)
        return null;
    if (!body.Services || typeof body.Services !== 'object' || Array.isArray(body.Services))
        return null;
    const services = body.Services;
    const entry = services[UNTRUSTED_TUNNEL_SERVICE];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        return null;
    const portStr = entry.Port;
    const port = typeof portStr === 'string' ? parseInt(portStr, 10) : Number(portStr);
    if (!port || Number.isNaN(port))
        return null;
    return { udid, tunnelPort: port };
}
//# sourceMappingURL=xpc.js.map