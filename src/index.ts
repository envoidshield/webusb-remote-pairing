/**
 * @envoidshield/webusb-remote-pairing
 *
 * Browser WebUSB pairing for iOS 17+ over USB CDC-NCM.
 */

export type {
    PairingPhase,
    PairingProgress,
    TrustRecord,
    PairDeviceOptions,
    ClaimedNcmInterface,
} from './types'

export {
    RemotePairingSession,
    pairUsbDevice,
} from './session'

export {
    requestAppleUsbDevice,
    getAuthorizedAppleDevice,
    claimCdcNcmInterface,
    releaseCdcNcmInterface,
    findNcmCandidates,
} from './usb-claim'

export {
    UsbReselectRequiredError, isUsbReselectRequiredError,
    PairingTrustDeniedError, isPairingTrustDeniedError, PAIRING_TRUST_DENIED_MSG,
    USB_CLAIM_FAILED_MSG,
} from './errors'

export type { NcmCandidate } from './usb-claim'

export {
    HOST_NAME,
    envoidHostIdentifier,
    createSelfIdentity,
    getOrCreateSelfIdentity,
    saveTrustRecord,
    buildTrustRecordPlist,
    downloadTrustRecord,
    loadStore,
    saveStore,
} from './pairing/record'

export type {
    SelfIdentity,
    DevicePairRecord,
    PairingStore,
} from './pairing/record'

export { setupNewPairingGetHostKey } from './pairing/remotePair'
export { ControlChannel, wrapEnvelope, unwrapEnvelope } from './pairing/channel'
export { TlvBuffer, tlvReadCoalesced, typePublicKey, typeSalt } from './pairing/tlv'
export { opackEncode } from './pairing/opack'
export { srpXHash, SRP_PASSWORD } from './pairing/srp'
export {
    encodeXpcBody,
    decodeXpcBody,
    buildXpcEmptyDict,
    encodeRemoteXpcDict,
    parseRemoteXpcMessage,
} from './xpc'
export { parseRsdHandshake, UNTRUSTED_TUNNEL_SERVICE } from './remotexpc'

export { RemoteXpcConnection } from './remotexpc'
export { Http2Connection } from './xhttp'
export { TcpConnection, TcpState } from './tcpstack'
