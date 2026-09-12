import { buildPlistFrame, decodePlist } from './plist';
const RESPONSE_TIMEOUT_MS = 10000;
export class LockdownConnection {
    constructor(sendData) {
        this.buffer = new Uint8Array(0);
        this.inbox = [];
        this.waiters = [];
        this.sendData = sendData;
    }
    feed(data) {
        const combined = new Uint8Array(this.buffer.length + data.length);
        combined.set(this.buffer);
        combined.set(data, this.buffer.length);
        this.buffer = combined;
        while (this.buffer.length >= 4) {
            const bodyLength = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength).getUint32(0, false);
            if (this.buffer.length < 4 + bodyLength)
                return;
            const response = decodePlist(this.buffer.slice(4, 4 + bodyLength));
            this.buffer = this.buffer.slice(4 + bodyLength);
            const waiter = this.waiters.shift();
            if (waiter)
                waiter(response);
            else
                this.inbox.push(response);
        }
    }
    async readDeviceInfo() {
        this.sendData(buildPlistFrame({
            Label: 'EnVoid',
            ProtocolVersion: '2',
            Request: 'RSDCheckin',
        }));
        this.validateResponse(await this.receive(), 'RSDCheckin');
        this.validateResponse(await this.receive(), 'StartService');
        this.sendData(buildPlistFrame({ Label: 'EnVoid', Request: 'GetValue' }));
        const response = await this.receive();
        if (response.Error !== undefined) {
            throw new Error(`Lockdown GetValue failed: ${String(response.Error)}`);
        }
        const values = response.Value;
        if (!values || typeof values !== 'object' ||
            Array.isArray(values) || values instanceof Uint8Array) {
            throw new Error('Lockdown GetValue returned no device information');
        }
        return {
            deviceName: this.getStringValue(values, 'DeviceName'),
            productType: this.getStringValue(values, 'ProductType'),
            productVersion: this.getStringValue(values, 'ProductVersion') ||
                this.getStringValue(values, 'HumanReadableProductVersionString'),
            deviceClass: this.getStringValue(values, 'DeviceClass'),
        };
    }
    getStringValue(values, key) {
        const value = values[key];
        return typeof value === 'string' && value.length > 0
            ? value
            : undefined;
    }
    receive(timeoutMs = RESPONSE_TIMEOUT_MS) {
        const queued = this.inbox.shift();
        if (queued)
            return Promise.resolve(queued);
        return new Promise((resolve, reject) => {
            const onResponse = (value) => {
                clearTimeout(timer);
                resolve(value);
            };
            const timer = setTimeout(() => {
                const index = this.waiters.indexOf(onResponse);
                if (index >= 0)
                    this.waiters.splice(index, 1);
                reject(new Error(`Lockdown response timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.waiters.push(onResponse);
        });
    }
    validateResponse(response, expectedRequest) {
        if (response.Request !== expectedRequest) {
            throw new Error(`Expected lockdown ${expectedRequest} response`);
        }
        if (response.Error !== undefined) {
            throw new Error(`Lockdown ${expectedRequest} failed: ${String(response.Error)}`);
        }
    }
}
//# sourceMappingURL=lockdown.js.map