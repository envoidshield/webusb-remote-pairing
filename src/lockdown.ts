import { buildPlistFrame, decodePlist, PlistValue } from './plist'
import type { DeviceInfo } from './types'

type PlistDictionary = { [key: string]: PlistValue }
type SendCallback = (data: Uint8Array) => void

const RESPONSE_TIMEOUT_MS = 10000

export class LockdownConnection {
    private sendData: SendCallback
    private buffer = new Uint8Array(0)
    private inbox: PlistDictionary[] = []
    private waiters: Array<(value: PlistDictionary) => void> = []

    constructor(sendData: SendCallback) {
        this.sendData = sendData
    }

    feed(data: Uint8Array): void {
        const combined = new Uint8Array(this.buffer.length + data.length)
        combined.set(this.buffer)
        combined.set(data, this.buffer.length)
        this.buffer = combined

        while (this.buffer.length >= 4) {
            const bodyLength = new DataView(
                this.buffer.buffer,
                this.buffer.byteOffset,
                this.buffer.byteLength,
            ).getUint32(0, false)
            if (this.buffer.length < 4 + bodyLength) return
            const response = decodePlist(this.buffer.slice(4, 4 + bodyLength))
            this.buffer = this.buffer.slice(4 + bodyLength)
            const waiter = this.waiters.shift()
            if (waiter) waiter(response)
            else this.inbox.push(response)
        }
    }

    async readDeviceInfo(): Promise<DeviceInfo> {
        this.sendData(buildPlistFrame({
            Label: 'EnVoid',
            ProtocolVersion: '2',
            Request: 'RSDCheckin',
        }))
        this.validateResponse(await this.receive(), 'RSDCheckin')
        this.validateResponse(await this.receive(), 'StartService')

        return {
            deviceName: await this.getStringValue('DeviceName'),
            productType: await this.getStringValue('ProductType'),
            productVersion: await this.getStringValue('HumanReadableProductVersionString'),
            deviceClass: await this.getStringValue('DeviceClass'),
        }
    }

    private async getStringValue(key: string): Promise<string | undefined> {
        this.sendData(buildPlistFrame({ Key: key, Label: 'EnVoid', Request: 'GetValue' }))
        const response = await this.receive()
        if (response.Error !== undefined) {
            throw new Error(`Lockdown GetValue ${key} failed: ${String(response.Error)}`)
        }
        return typeof response.Value === 'string' && response.Value.length > 0
            ? response.Value
            : undefined
    }

    private receive(timeoutMs: number = RESPONSE_TIMEOUT_MS): Promise<PlistDictionary> {
        const queued = this.inbox.shift()
        if (queued) return Promise.resolve(queued)

        return new Promise((resolve, reject) => {
            const onResponse = (value: PlistDictionary) => {
                clearTimeout(timer)
                resolve(value)
            }
            const timer = setTimeout(() => {
                const index = this.waiters.indexOf(onResponse)
                if (index >= 0) this.waiters.splice(index, 1)
                reject(new Error(`Lockdown response timed out after ${timeoutMs}ms`))
            }, timeoutMs)
            this.waiters.push(onResponse)
        })
    }

    private validateResponse(response: PlistDictionary, expectedRequest: string): void {
        if (response.Request !== expectedRequest) {
            throw new Error(`Expected lockdown ${expectedRequest} response`)
        }
        if (response.Error !== undefined) {
            throw new Error(`Lockdown ${expectedRequest} failed: ${String(response.Error)}`)
        }
    }
}
