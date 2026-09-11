export declare class UsbReselectRequiredError extends Error {
    constructor(message?: string);
}
export declare function isUsbReselectRequiredError(err: unknown): boolean;
export declare const PAIRING_TRUST_DENIED_MSG = "Trust was not granted on the iPhone. Tap ADD DEVICE again and tap Trust when prompted.";
export declare const USB_CLAIM_FAILED_MSG: string;
export declare class PairingTrustDeniedError extends Error {
    constructor(message?: string);
}
export declare function isPairingTrustDeniedError(err: unknown): boolean;
//# sourceMappingURL=errors.d.ts.map