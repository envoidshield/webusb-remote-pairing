// IPv6 packet parser, builder, and NDP (Neighbor Discovery Protocol)
export const IPV6_HEADER_LENGTH = 40;
export const IPPROTO_TCP = 6;
export const IPPROTO_UDP = 17;
export const IPPROTO_ICMPV6 = 58;
export const IPPROTO_HOPBYHOP = 0;
// ICMPv6 types
export const ICMPV6_ROUTER_SOLICITATION = 133;
export const ICMPV6_ROUTER_ADVERTISEMENT = 134;
export const ICMPV6_NEIGHBOR_SOLICITATION = 135;
export const ICMPV6_NEIGHBOR_ADVERTISEMENT = 136;
// NDP option types
export const NDP_OPT_SOURCE_LINK_ADDR = 1;
export const NDP_OPT_TARGET_LINK_ADDR = 2;
export var ipv6DebugLog = null;
export function setIpv6DebugLog(fn) { ipv6DebugLog = fn; }
function ipv6Debug(msg) {
    if (ipv6DebugLog)
        ipv6DebugLog(msg);
}
function ipv6HexDump(data, maxBytes = 32) {
    const len = Math.min(data.length, maxBytes);
    const parts = [];
    for (let i = 0; i < len; i++)
        parts.push(data[i].toString(16).padStart(2, '0'));
    if (data.length > maxBytes)
        parts.push('...');
    return parts.join(' ');
}
export function parseIPv6(data) {
    if (data.length < IPV6_HEADER_LENGTH) {
        ipv6Debug(`[IPv6] PARSE FAIL: ${data.length}B < ${IPV6_HEADER_LENGTH}B header`);
        return null;
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const firstWord = view.getUint32(0, false);
    const version = (firstWord >> 28) & 0xF;
    if (version !== 6) {
        ipv6Debug(`[IPv6] PARSE FAIL: version ${version} != 6`);
        return null;
    }
    const trafficClass = (firstWord >> 20) & 0xFF;
    const flowLabel = firstWord & 0xFFFFF;
    const payloadLength = view.getUint16(4, false);
    const nextHeader = data[6];
    const hopLimit = data[7];
    const srcAddr = data.slice(8, 24);
    const dstAddr = data.slice(24, 40);
    const payload = data.slice(40, 40 + payloadLength);
    const protoNames = { 6: 'TCP', 17: 'UDP', 58: 'ICMPv6', 0: 'HOPBYHOP' };
    const protoName = protoNames[nextHeader] || `proto-${nextHeader}`;
    ipv6Debug(`[IPv6] PARSE: ${ipv6ToString(srcAddr)} -> ${ipv6ToString(dstAddr)} ${protoName} payload=${payloadLength}B hop=${hopLimit} tc=${trafficClass} flow=0x${flowLabel.toString(16)}`);
    ipv6Debug(`[IPv6]   raw header: ${ipv6HexDump(data.slice(0, 40))}`);
    return { version, trafficClass, flowLabel, payloadLength, nextHeader, hopLimit, srcAddr, dstAddr, payload };
}
export function buildIPv6(nextHeader, hopLimit, srcAddr, dstAddr, payload) {
    const packet = new Uint8Array(IPV6_HEADER_LENGTH + payload.length);
    const view = new DataView(packet.buffer);
    // Version(4) + TC(8) + Flow(20) = 0x60000000
    view.setUint32(0, 0x60000000, false);
    view.setUint16(4, payload.length, false); // payload length
    packet[6] = nextHeader;
    packet[7] = hopLimit;
    packet.set(srcAddr, 8);
    packet.set(dstAddr, 24);
    packet.set(payload, 40);
    return packet;
}
/**
 * Skip extension headers to find the real payload.
 * Returns { nextHeader, payload } after all extension headers.
 */
export function skipExtensionHeaders(nextHeader, payload) {
    const extensionHeaders = new Set([IPPROTO_HOPBYHOP, 43, 44, 60]); // hop-by-hop, routing, fragment, destination
    while (extensionHeaders.has(nextHeader) && payload.length >= 8) {
        const extNextHeader = payload[0];
        const extLength = (payload[1] + 1) * 8;
        if (payload.length < extLength)
            break;
        nextHeader = extNextHeader;
        payload = payload.slice(extLength);
    }
    return { nextHeader, payload };
}
// --- IPv6 Address Utilities ---
export function ipv6ToString(addr) {
    const groups = [];
    for (let i = 0; i < 16; i += 2) {
        groups.push(((addr[i] << 8) | addr[i + 1]).toString(16));
    }
    // Find longest run of consecutive zero groups for :: compression
    let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (let i = 0; i < 8; i++) {
        if (groups[i] === '0') {
            if (curStart < 0)
                curStart = i;
            curLen++;
            if (curLen > bestLen) {
                bestStart = curStart;
                bestLen = curLen;
            }
        }
        else {
            curStart = -1;
            curLen = 0;
        }
    }
    if (bestLen >= 2) {
        const left = groups.slice(0, bestStart).join(':');
        const right = groups.slice(bestStart + bestLen).join(':');
        return left + '::' + right;
    }
    return groups.join(':');
}
export function ipv6FromString(s) {
    const addr = new Uint8Array(16);
    // Handle :: expansion
    let parts;
    if (s.includes('::')) {
        const [left, right] = s.split('::');
        const leftParts = left ? left.split(':') : [];
        const rightParts = right ? right.split(':') : [];
        const missing = 8 - leftParts.length - rightParts.length;
        parts = [...leftParts, ...Array(missing).fill('0'), ...rightParts];
    }
    else {
        parts = s.split(':');
    }
    for (let i = 0; i < 8 && i < parts.length; i++) {
        const val = parseInt(parts[i] || '0', 16);
        addr[i * 2] = (val >> 8) & 0xFF;
        addr[i * 2 + 1] = val & 0xFF;
    }
    return addr;
}
export function ipv6IsLinkLocal(addr) {
    return addr[0] === 0xFE && (addr[1] & 0xC0) === 0x80;
}
/**
 * Generate a link-local IPv6 address from a MAC address (EUI-64).
 */
export function ipv6LinkLocalFromMac(mac) {
    const addr = new Uint8Array(16);
    addr[0] = 0xFE;
    addr[1] = 0x80;
    // bytes 2-7 = 0
    // EUI-64: insert ff:fe in middle, flip U/L bit
    addr[8] = mac[0] ^ 0x02;
    addr[9] = mac[1];
    addr[10] = mac[2];
    addr[11] = 0xFF;
    addr[12] = 0xFE;
    addr[13] = mac[3];
    addr[14] = mac[4];
    addr[15] = mac[5];
    return addr;
}
/**
 * Solicited-node multicast address: ff02::1:ffXX:XXXX
 * where XX:XXXX are the last 3 bytes of the unicast address.
 */
export function solicitedNodeAddress(addr) {
    const mcast = new Uint8Array(16);
    mcast[0] = 0xFF;
    mcast[1] = 0x02;
    mcast[11] = 0x01;
    mcast[12] = 0xFF;
    mcast[13] = addr[13];
    mcast[14] = addr[14];
    mcast[15] = addr[15];
    return mcast;
}
// All-nodes multicast: ff02::1
export const ALL_NODES_MULTICAST = new Uint8Array([0xFF, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01]);
// --- ICMPv6 Checksum ---
export function icmpv6Checksum(srcAddr, dstAddr, icmpPayload) {
    // Pseudo-header: src(16) + dst(16) + length(4) + zeros(3) + nextHeader(1)
    const pseudoLen = 32 + 4 + 4;
    const totalLen = pseudoLen + icmpPayload.length;
    const buf = new Uint8Array(totalLen + (totalLen % 2)); // pad to even
    buf.set(srcAddr, 0);
    buf.set(dstAddr, 16);
    const view = new DataView(buf.buffer);
    view.setUint32(32, icmpPayload.length, false); // upper-layer length
    buf[36] = 0;
    buf[37] = 0;
    buf[38] = 0;
    buf[39] = IPPROTO_ICMPV6;
    buf.set(icmpPayload, 40);
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
// --- NDP Messages ---
/**
 * Build a Neighbor Solicitation for target address.
 * Includes source link-layer address option.
 */
export function buildNeighborSolicitation(targetAddr, sourceMac, srcIpv6) {
    // ICMPv6 NS: type(1) + code(1) + checksum(2) + reserved(4) + target(16) + options
    // Option: type(1) + length(1, in units of 8) + mac(6) = 8 bytes
    const icmpLen = 24 + 8;
    const icmp = new Uint8Array(icmpLen);
    icmp[0] = ICMPV6_NEIGHBOR_SOLICITATION;
    icmp[1] = 0; // code
    // checksum at [2..3], fill after
    // reserved [4..7] = 0
    icmp.set(targetAddr, 8); // target address
    // Source link-layer address option
    icmp[24] = NDP_OPT_SOURCE_LINK_ADDR;
    icmp[25] = 1; // length in units of 8 bytes
    icmp.set(sourceMac, 26);
    // Compute checksum
    const dstAddr = solicitedNodeAddress(targetAddr);
    const cksum = icmpv6Checksum(srcIpv6, dstAddr, icmp);
    icmp[2] = (cksum >> 8) & 0xFF;
    icmp[3] = cksum & 0xFF;
    return icmp;
}
export function parseNeighborAdvertisement(icmpPayload) {
    if (icmpPayload.length < 24)
        return null;
    if (icmpPayload[0] !== ICMPV6_NEIGHBOR_ADVERTISEMENT)
        return null;
    const flags = icmpPayload[4];
    const router = !!(flags & 0x80);
    const solicited = !!(flags & 0x40);
    const override_ = !!(flags & 0x20);
    const targetAddr = icmpPayload.slice(8, 24);
    // Parse options for target link-layer address
    let targetMac = null;
    let offset = 24;
    while (offset + 2 <= icmpPayload.length) {
        const optType = icmpPayload[offset];
        const optLen = icmpPayload[offset + 1] * 8;
        if (optLen === 0)
            break;
        if (optType === NDP_OPT_TARGET_LINK_ADDR && optLen >= 8) {
            targetMac = icmpPayload.slice(offset + 2, offset + 8);
        }
        offset += optLen;
    }
    return { router, solicited, override: override_, targetAddr, targetMac };
}
//# sourceMappingURL=ipv6.js.map