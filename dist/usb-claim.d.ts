/// <reference types="w3c-web-usb" />
import type { ClaimedNcmInterface } from './types';
export interface NcmCandidate {
    configValue: number;
    ifaceNum: number;
    altSetting: number;
    epIn: number;
    epOut: number;
}
export declare function findNcmCandidates(device: USBDevice): NcmCandidate[];
export declare function claimCdcNcmInterface(device: USBDevice, log?: (msg: string) => void, signal?: AbortSignal): Promise<ClaimedNcmInterface>;
export declare function releaseCdcNcmInterface(device: USBDevice, claimedIface: number): Promise<void>;
export declare function requestAppleUsbDevice(): Promise<USBDevice>;
export declare function getAuthorizedAppleDevice(): Promise<USBDevice | null>;
//# sourceMappingURL=usb-claim.d.ts.map