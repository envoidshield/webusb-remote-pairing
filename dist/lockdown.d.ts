import type { DeviceInfo } from './types';
type SendCallback = (data: Uint8Array) => void;
export declare class LockdownConnection {
    private sendData;
    private buffer;
    private inbox;
    private waiters;
    constructor(sendData: SendCallback);
    feed(data: Uint8Array): void;
    readDeviceInfo(): Promise<DeviceInfo>;
    private getStringValue;
    private receive;
    private validateResponse;
}
export {};
//# sourceMappingURL=lockdown.d.ts.map