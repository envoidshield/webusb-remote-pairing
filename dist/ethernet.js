// Ethernet frame parser and builder
export const ETHERTYPE_IPV4 = 0x0800;
export const ETHERTYPE_IPV6 = 0x86DD;
export const ETHERTYPE_ARP = 0x0806;
export function parseEthernet(data) {
    if (data.length < 14)
        return null;
    const destMac = data.slice(0, 6);
    const srcMac = data.slice(6, 12);
    const ethertype = (data[12] << 8) | data[13];
    const payload = data.slice(14);
    return { destMac, srcMac, ethertype, payload };
}
export function buildEthernet(destMac, srcMac, ethertype, payload) {
    const frame = new Uint8Array(14 + payload.length);
    frame.set(destMac, 0);
    frame.set(srcMac, 6);
    frame[12] = (ethertype >> 8) & 0xFF;
    frame[13] = ethertype & 0xFF;
    frame.set(payload, 14);
    return frame;
}
export function macToString(mac) {
    return Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join(':');
}
export function macFromString(s) {
    return new Uint8Array(s.split(':').map(h => parseInt(h, 16)));
}
/**
 * Build IPv6 multicast MAC from IPv6 multicast address.
 * Last 4 bytes of IPv6 -> 33:33:XX:XX:XX:XX
 */
export function ipv6MulticastMac(ipv6Addr) {
    return new Uint8Array([0x33, 0x33, ipv6Addr[12], ipv6Addr[13], ipv6Addr[14], ipv6Addr[15]]);
}
/**
 * Build solicited-node multicast MAC for an IPv6 address.
 * 33:33:ff:XX:XX:XX where XX:XX:XX are the last 3 bytes of the IPv6 address.
 */
export function solicitedNodeMac(ipv6Addr) {
    return new Uint8Array([0x33, 0x33, 0xff, ipv6Addr[13], ipv6Addr[14], ipv6Addr[15]]);
}
//# sourceMappingURL=ethernet.js.map