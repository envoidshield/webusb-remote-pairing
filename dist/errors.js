export class UsbReselectRequiredError extends Error {
    constructor(message = 'Chrome needs you to select the iPhone again after USB mode switch') {
        super(message);
        this.name = 'UsbReselectRequiredError';
    }
}
export function isUsbReselectRequiredError(err) {
    return err instanceof UsbReselectRequiredError
        || (err != null && typeof err === 'object' && err.name === 'UsbReselectRequiredError');
}
export const PAIRING_TRUST_DENIED_MSG = 'Trust was not granted on the iPhone. Tap ADD DEVICE again and tap Trust when prompted.';
export const USB_CLAIM_FAILED_MSG = 'Could not claim the iPhone USB network interface. First enable Personal Hotspot over USB on the iPhone, ' +
    'then tap ADD DEVICE again. If it still fails, quit Apple Devices and Xcode on this Mac, ' +
    'unplug the USB cable for 5 seconds, and replug.';
export class PairingTrustDeniedError extends Error {
    constructor(message = PAIRING_TRUST_DENIED_MSG) {
        super(message);
        this.name = 'PairingTrustDeniedError';
    }
}
export function isPairingTrustDeniedError(err) {
    return err instanceof PairingTrustDeniedError
        || (err != null && typeof err === 'object' && err.name === 'PairingTrustDeniedError');
}
//# sourceMappingURL=errors.js.map