# @envoidshield/webusb-remote-pairing

Browser-only **iOS 17+ USB remote pairing** for Chrome (WebUSB). No native helpers, no TUN/VPN.

Claims the device CDC-NCM interface, runs Ethernet → IPv6 → mDNS → TCP → HTTP/2 → RemoteXPC in JavaScript, completes RSD handshake, pairs via `com.apple.internal.dt.coredevice.untrusted.tunnelservice` (SRP-3072 + Ed25519), and returns a TrustRecord plist.

Compatible with pymobiledevice3 / go-ios autotrust.

**Reference demo app:** [hack-different/webmuxd-example](https://github.com/hack-different/webmuxd-example)

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Browser** | Chromium or Chrome only (WebUSB). Not Safari or Firefox. |
| **Origin** | `https://` or `http://localhost` — WebUSB is blocked on plain HTTP remote origins. |
| **User gesture** | `requestAppleUsbDevice()` must run from a click/tap handler. |
| **Device** | iPhone or iPad on **iOS 17+**, connected by **USB cable**. |
| **Device state** | Unlocked. When pairing reaches the `pairing` phase, tap **Trust This Computer** and enter the passcode if prompted. |
| **Timing** | Full flow typically takes **1–7 minutes** (mDNS, NDP, dual TCP sessions, SRP). |

### Peer dependencies

This package does not bundle crypto. Install these in your app:

```bash
npm install @noble/ciphers @noble/curves @noble/hashes
```

## Install

### GitHub Packages (recommended)

Add to `~/.npmrc` (or project `.npmrc`):

```ini
@envoidshield:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

Token needs `read:packages` (and `write:packages` to publish).

```bash
npm install @envoidshield/webusb-remote-pairing @noble/ciphers @noble/curves @noble/hashes
```

### From git

```bash
npm install github:envoidshield/webusb-remote-pairing @noble/ciphers @noble/curves @noble/hashes
```

## Quick start

```typescript
import {
  requestAppleUsbDevice,
  getAuthorizedAppleDevice,
  pairUsbDevice,
  downloadTrustRecord,
} from '@envoidshield/webusb-remote-pairing'

async function pairMyIpad() {
  // First visit: user picks the device in Chrome's USB chooser (must be a click handler).
  if (!(await getAuthorizedAppleDevice())) {
    await requestAppleUsbDevice()
  }

  const record = await pairUsbDevice({
    debug: true,
    onProgress: ({ phase, message }) => console.log(phase, message),
    onLog: (line) => console.log(line),
  })

  console.log('UDID', record.udid)
  console.log('Host ID', record.hostIdentifier)
  downloadTrustRecord(record.udid, record.deviceRecord) // remote_<UDID>.plist
}
```

### Session with cancel support

```typescript
import { RemotePairingSession } from '@envoidshield/webusb-remote-pairing'

const controller = new AbortController()
const session = new RemotePairingSession({
  signal: controller.signal,
  onProgress: ({ phase }) => console.log(phase),
})

// controller.abort() or session.abort() stops USB read loop and rejects pair()
const record = await session.pair()
```

## Pairing flow (what happens)

```
iPhone USB (CDC-NCM)
  → NCM / Ethernet / IPv6 + NDP
  → mDNS _remoted._tcp (RSD)
  → TCP → HTTP/2 → RemoteXPC → RSD Handshake (UDID + Services map)
  → second TCP → com.apple.internal.dt.coredevice.untrusted.tunnelservice
  → ControlChannel + SRP-3072 pair-setup (Trust dialog on device)
  → TrustRecord plist
```

Host identity matches Envoid go-ios: UUID v3 (MD5) of DNS namespace + `"EnVoid"` → `DBDA6554-8DC4-3CA9-9896-3BBE6D5A33A1`.

Pair-setup uses user `Pair-Setup`, password `000000`, RFC 5054 3072-bit group, SHA-512.

## `PairDeviceOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `device` | `USBDevice` | first authorized Apple device | Pre-authorized WebUSB handle |
| `hostName` | `string` | `"EnVoid"` | Host label sent during pairing |
| `debug` | `boolean` | `false` | Verbose protocol logging via `onLog` |
| `onProgress` | `(p: PairingProgress) => void` | — | Phase updates for UI |
| `onLog` | `(msg: string) => void` | — | Debug log lines |
| `identity` | `SelfIdentity` | load/create from IndexedDB | Override host Ed25519 identity |
| `persist` | `boolean` | `true` | Save trust record to IndexedDB on success |
| `signal` | `AbortSignal` | — | Abort pairing (also calls `session.abort()`) |

## `PairingPhase` values

| Phase | Meaning |
|-------|---------|
| `claiming` | Opening USB device and claiming CDC-NCM |
| `discovering` | Waiting for `_remoted._tcp` via mDNS |
| `ndp` | IPv6 neighbor discovery (link-layer resolve) |
| `rsd-tcp` | TCP connect to RSD service |
| `rsd-handshake` | RemoteXPC init + RSD handshake (UDID, tunnel port) |
| `pair-tcp` | TCP connect to `untrusted.tunnelservice` |
| `pairing` | **Approve Trust on the device** — SRP pair-setup in progress |
| `complete` | Success |
| `error` | Failed (see `onLog` / thrown error) |

## API

### High level

| Export | Description |
|--------|-------------|
| `pairUsbDevice(opts?)` | One-shot: claim USB → discover RSD → pair → return `TrustRecord` |
| `RemotePairingSession` | Same flow with `pair()`, `abort()`, `currentPhase` |
| `requestAppleUsbDevice()` | `navigator.usb.requestDevice` for Apple (`vendorId 0x05ac`) |
| `getAuthorizedAppleDevice()` | First pre-authorized Apple device, or `null` |

### Trust record / persistence

| Export | Description |
|--------|-------------|
| `getOrCreateSelfIdentity()` | Load or create host Ed25519 keypair (IndexedDB) |
| `saveTrustRecord(udid, identity, hostKey)` | Persist paired device record |
| `buildTrustRecordPlist(deviceRecord)` | Build plist XML string |
| `downloadTrustRecord(udid, deviceRecord)` | Trigger browser download `remote_<UDID>.plist` |
| `HOST_NAME` | Default host label (`"EnVoid"`) |
| `envoidHostIdentifier()` | Default host UUID v3 |

### Low level (advanced / testing)

Protocol building blocks are exported: `claimCdcNcmInterface`, `ControlChannel`, `setupNewPairingGetHostKey`, XPC/HTTP2/TCP stack types, SRP/TLV/OPack helpers, `parseRsdHandshake`, etc. See `src/index.ts`.

### `TrustRecord`

```typescript
{
  udid: string
  hostIdentifier: string   // UUID v3 of "EnVoid" by default
  privateKey: Uint8Array   // host Ed25519 private key
  publicKey: Uint8Array
  remoteUnlockHostKey: string
  plistXml: string
  deviceRecord: {
    private_key: Uint8Array
    public_key: Uint8Array
    remote_unlock_host_key: string
  }
}
```

## Using the plist after pairing

The downloaded `remote_<UDID>.plist` is a **pair record** compatible with Envoid/go-ios autotrust layout.

**go-ios** — place under your autotrust directory (same layout as other paired hosts):

```bash
# Typical layout (adjust to your go-ios config):
cp remote_<UDID>.plist ~/.go-ios/<host-uuid>/remote_<UDID>.plist
```

**pymobiledevice3** — import or merge into your pairing record store for the same host identifier (`DBDA6554-8DC4-3CA9-9896-3BBE6D5A33A1` unless you overrode `identity`).

The browser flow only **creates** the record; downstream tools use it for subsequent trusted tunnel / CoreDevice sessions over USB or network.

## Bundler notes

- Package ships prebuilt **ES2020 ESM** in `dist/` (`import` syntax, `BigInt`).
- **Create React App 4 / older webpack:** ensure `@noble/*` resolves from your app root (not a nested `node_modules` inside this package). Prefer importing the published package from GitHub Packages rather than a monorepo `file:` link without transpilation.
- **Modern bundlers** (Vite, webpack 5, esbuild): work out of the box.

## Security

- Host **private keys** and paired records are stored in **IndexedDB** in the browser origin that ran pairing.
- Run pairing UI on **localhost** or a trusted origin only; do not expose on the public internet.
- Anyone with access to the origin's IndexedDB or downloaded plist can impersonate the paired host toward that device.

## Limitations

- **USB only** — no Wi‑Fi `_remotepairing._tcp` / JSON RPPairing path
- **No TUN/VPN** — browser cannot create utun; pair + persist only
- **No classic lockdown** — not USBMux `:62078` / RSA pair records
- **No pair-verify reconnect**, `createListener`, or TLS-PSK tunnel in this library
- **WebUSB chooser** cannot be automated (E2E tests need a human to select the device)

## Common errors

| Error | Cause |
|-------|--------|
| `No device selected` | User cancelled Chrome's USB chooser |
| `No authorized Apple USB device` | Call `requestAppleUsbDevice()` first (from a click handler) |
| `No CDC-NCM data interface found` | iPhone still in the 4-config USB mode. The library now sends Apple GET_MODE/SET_MODE(3) like go-ios and waits for re-enumeration. If it still fails on Windows: close iTunes / Apple Mobile Device Service, unlock the phone, use a data cable, iOS 17+. |
| Pairing hangs at `discovering` | mDNS not seen — replug USB, unlock device |
| Pairing hangs at `pairing` | Trust not approved on device |
| `Module parse failed: Unexpected token` | Old bundler not transpiling `dist/` or `@noble/*` — see Bundler notes |

## Development

```bash
git clone https://github.com/envoidshield/webusb-remote-pairing.git
cd webusb-remote-pairing
npm install
npm run build   # emits dist/
npm test        # tsc --noEmit
```

## License

MIT
