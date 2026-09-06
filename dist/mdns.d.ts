export interface MdnsRecord {
    name: string;
    type: number;
    class_: number;
    ttl: number;
    data: Uint8Array;
    parsed?: MdnsParsedData;
}
export type MdnsParsedData = {
    type: 'A';
    address: string;
} | {
    type: 'AAAA';
    address: Uint8Array;
    addressStr: string;
} | {
    type: 'PTR';
    name: string;
} | {
    type: 'SRV';
    priority: number;
    weight: number;
    port: number;
    target: string;
} | {
    type: 'TXT';
    entries: string[];
};
export interface MdnsMessage {
    id: number;
    flags: number;
    questions: MdnsQuestion[];
    answers: MdnsRecord[];
    authority: MdnsRecord[];
    additional: MdnsRecord[];
}
export interface MdnsQuestion {
    name: string;
    type: number;
    class_: number;
}
export declare var mdnsDebugLog: ((msg: string) => void) | null;
export declare function setMdnsDebugLog(fn: ((msg: string) => void) | null): void;
export declare function parseMdns(data: Uint8Array): MdnsMessage | null;
/**
 * Discovered service info.
 */
export interface RemotePairingService {
    address: Uint8Array;
    port: number;
    hostname: string;
    serviceName: string;
}
/**
 * Search all records in an mDNS message for Apple remote services.
 * Looks for (in priority order):
 *   1. _remoted._tcp (Remote Service Discovery - RSD)
 *   2. _remotepairing._tcp (RemoteXPC pairing)
 * Returns { address, port, hostname, serviceName } if found.
 */
export declare function findRemotePairingService(msg: MdnsMessage): RemotePairingService | null;
/**
 * Collect ALL discovered services from an mDNS message for logging.
 */
export declare function listAllServices(msg: MdnsMessage): string[];
//# sourceMappingURL=mdns.d.ts.map