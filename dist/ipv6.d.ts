export declare const IPV6_HEADER_LENGTH = 40;
export declare const IPPROTO_TCP = 6;
export declare const IPPROTO_UDP = 17;
export declare const IPPROTO_ICMPV6 = 58;
export declare const IPPROTO_HOPBYHOP = 0;
export declare const ICMPV6_ROUTER_SOLICITATION = 133;
export declare const ICMPV6_ROUTER_ADVERTISEMENT = 134;
export declare const ICMPV6_NEIGHBOR_SOLICITATION = 135;
export declare const ICMPV6_NEIGHBOR_ADVERTISEMENT = 136;
export declare const NDP_OPT_SOURCE_LINK_ADDR = 1;
export declare const NDP_OPT_TARGET_LINK_ADDR = 2;
export declare var ipv6DebugLog: ((msg: string) => void) | null;
export declare function setIpv6DebugLog(fn: ((msg: string) => void) | null): void;
export interface IPv6Packet {
    version: number;
    trafficClass: number;
    flowLabel: number;
    payloadLength: number;
    nextHeader: number;
    hopLimit: number;
    srcAddr: Uint8Array;
    dstAddr: Uint8Array;
    payload: Uint8Array;
}
export declare function parseIPv6(data: Uint8Array): IPv6Packet | null;
export declare function buildIPv6(nextHeader: number, hopLimit: number, srcAddr: Uint8Array, dstAddr: Uint8Array, payload: Uint8Array): Uint8Array;
/**
 * Skip extension headers to find the real payload.
 * Returns { nextHeader, payload } after all extension headers.
 */
export declare function skipExtensionHeaders(nextHeader: number, payload: Uint8Array): {
    nextHeader: number;
    payload: Uint8Array;
};
export declare function ipv6ToString(addr: Uint8Array): string;
export declare function ipv6FromString(s: string): Uint8Array;
export declare function ipv6IsLinkLocal(addr: Uint8Array): boolean;
/**
 * Generate a link-local IPv6 address from a MAC address (EUI-64).
 */
export declare function ipv6LinkLocalFromMac(mac: Uint8Array): Uint8Array;
/**
 * Solicited-node multicast address: ff02::1:ffXX:XXXX
 * where XX:XXXX are the last 3 bytes of the unicast address.
 */
export declare function solicitedNodeAddress(addr: Uint8Array): Uint8Array;
export declare const ALL_NODES_MULTICAST: Uint8Array;
export declare function icmpv6Checksum(srcAddr: Uint8Array, dstAddr: Uint8Array, icmpPayload: Uint8Array): number;
/**
 * Build a Neighbor Solicitation for target address.
 * Includes source link-layer address option.
 */
export declare function buildNeighborSolicitation(targetAddr: Uint8Array, sourceMac: Uint8Array, srcIpv6: Uint8Array): Uint8Array;
/**
 * Parse a Neighbor Advertisement to extract the target's MAC.
 */
export interface NeighborAdvertisement {
    router: boolean;
    solicited: boolean;
    override: boolean;
    targetAddr: Uint8Array;
    targetMac: Uint8Array | null;
}
export declare function parseNeighborAdvertisement(icmpPayload: Uint8Array): NeighborAdvertisement | null;
//# sourceMappingURL=ipv6.d.ts.map