# @envoidshield/webusb-remote-pairing

Browser-only **iOS 17+ USB remote pairing** for Chrome (WebUSB). No native helpers, no TUN/VPN.

Claims the device CDC-NCM interface, runs Ethernet → IPv6 → mDNS → TCP → HTTP/2 → RemoteXPC in JavaScript, completes RSD handshake, pairs via `com.apple.internal.dt.coredevice.untrusted.tunnelservice` (SRP-3072 + Ed25519), and returns a TrustRecord plist.

Compatible with pymobiledevice3 / go-ios autotrust.

## Install

```bash
# GitHub Packages (envoidshield org)
npm install @envoidshield/webusb-remote-pairing --registry=https://npm.pkg.github.com

# or from git
npm install github:envoidshield/webusb-remote-pairing
```

Requires **Chromium** with WebUSB (`chrome://flags` → experimental web platform features if needed).

## Quick start

```typescript
import {
  requestAppleUsbDevice,
  pairUsbDevice,
  downloadTrustRecord,
} from '@envoidshield/webusb-remote-pairing'

async function pairMyIpad() {
  // First time only — user picks the device in the system chooser
  await requestAppleUsbDevice()

  const record = await pairUsbDevice({
    debug: true,
    onProgress: ({ phase, message }) => console.log(phase, message),
    onLog: (line) => console.log(line),
  })

  console.log('UDID', record.udid)
  console.log('Host ID', record.hostIdentifier)
  downloadTrustRecord(record.udid, record.deviceRecord)
}
```

## API

| Export | Description |
|--------|-------------|
| `pairUsbDevice(opts?)` | One-shot: claim USB → discover RSD → pair → return `TrustRecord` |
| `RemotePairingSession` | Same flow with `pair()`, `abort()`, `currentPhase` |
| `requestAppleUsbDevice()` | `navigator.usb.requestDevice` for Apple (`0x05ac`) |
| `getAuthorizedAppleDevice()` | First pre-authorized Apple device, or `null` |
| `buildTrustRecordPlist` / `downloadTrustRecord` | Plist export |
| `getOrCreateSelfIdentity` / `saveTrustRecord` | IndexedDB persistence (browser) |

### `TrustRecord`

```typescript
{
  udid: string
  hostIdentifier: string   // UUID v3 of "EnVoid" by default
  privateKey: Uint8Array
  publicKey: Uint8Array
  remoteUnlockHostKey: string
  plistXml: string
  deviceRecord: { private_key, public_key, remote_unlock_host_key }
}
```

## Build

```bash
cd packages/webusb-remote-pairing
npm install
npm run build   # emits dist/
```

## License

MIT
