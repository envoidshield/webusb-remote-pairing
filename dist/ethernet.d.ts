export declare const ETHERTYPE_IPV4 = 2048;
export declare const ETHERTYPE_IPV6 = 34525;
export declare const ETHERTYPE_ARP = 2054;
export interface EthernetFrame {
    destMac: Uint8Array;
    srcMac: Uint8Array;
    ethertype: number;
    payload: Uint8Array;
}
export declare function parseEthernet(data: Uint8Array): EthernetFrame | null;
export declare function buildEthernet(destMac: Uint8Array, srcMac: Uint8Array, ethertype: number, payload: Uint8Array): Uint8Array;
export declare function macToString(mac: Uint8Array): string;
export declare function macFromString(s: string): Uint8Array;
/**
 * Build IPv6 multicast MAC from IPv6 multicast address.
 * Last 4 bytes of IPv6 -> 33:33:XX:XX:XX:XX
 */
export declare function ipv6MulticastMac(ipv6Addr: Uint8Array): Uint8Array;
/**
 * Build solicited-node multicast MAC for an IPv6 address.
 * 33:33:ff:XX:XX:XX where XX:XX:XX are the last 3 bytes of the IPv6 address.
 */
export declare function solicitedNodeMac(ipv6Addr: Uint8Array): Uint8Array;
//# sourceMappingURL=ethernet.d.ts.map