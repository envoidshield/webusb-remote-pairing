import type { SelfIdentity, DevicePairRecord } from './pairing/record'

export type PairingPhase =
    | 'idle'
    | 'claiming'
    | 'discovering'
    | 'ndp'
    | 'rsd-tcp'
    | 'rsd-handshake'
    | 'pair-tcp'
    | 'pairing'
    | 'complete'
    | 'error'

export interface PairingProgress {
    phase: PairingPhase
    message?: string
}

export interface TrustRecord {
    udid: string
    hostIdentifier: string
    privateKey: Uint8Array
    publicKey: Uint8Array
    remoteUnlockHostKey: string
    plistXml: string
    deviceRecord: DevicePairRecord
}

export interface PairDeviceOptions {
    /** Authorized WebUSB device. If omitted, uses the first authorized Apple device. */
    device?: USBDevice
    /** Host label sent during pairing (default: EnVoid). */
    hostName?: string
    /** Verbose protocol logging. */
    debug?: boolean
    onProgress?: (progress: PairingProgress) => void
    onLog?: (message: string) => void
    /** Override host identity (default: load/create from IndexedDB). */
    identity?: SelfIdentity
    /** Persist trust record when pairing completes (default: true). */
    persist?: boolean
    signal?: AbortSignal
}

export interface ClaimedNcmInterface {
    epIn: number
    epOut: number
    claimedIface: number
}
