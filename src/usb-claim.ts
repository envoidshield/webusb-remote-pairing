import type { ClaimedNcmInterface } from './types'
import { UsbReselectRequiredError, USB_CLAIM_FAILED_MSG } from './errors'

export interface NcmCandidate {
    configValue: number
    ifaceNum: number
    altSetting: number
    epIn: number
    epOut: number
}

// Apple vendor-specific USB mode switch (same as go-ios ncm/usb.go and usbmuxd).
// GET_MODE 0x45 / SET_MODE 0x52. Mode 3 exposes configuration 5 with CDC-NCM.
const APPLE_VID = 0x05ac
const APPLE_GET_MODE = 69
const APPLE_SET_MODE = 82
const APPLE_MUX_MODE = 1
const APPLE_NCM_MODE = 3
const REENUMERATE_TIMEOUT_MS = 15000

export function findNcmCandidates(device: USBDevice): NcmCandidate[] {
    const candidates: NcmCandidate[] = []
    for (let ci = 0; ci < device.configurations.length; ci++) {
        const config = device.configurations[ci]
        for (let ii = 0; ii < config.interfaces.length; ii++) {
            const iface = config.interfaces[ii]
            for (let ai = 0; ai < iface.alternates.length; ai++) {
                const alt = iface.alternates[ai]
                const eps = bulkInOut(alt)
                // go-ios: class 10 (CDC-Data), subclass 0, two endpoints. Do not require protocol 1;
                // Apple's private NCM data iface sometimes reports protocol 0.
                if (alt.interfaceClass === 10 && alt.interfaceSubclass === 0 && eps) {
                    candidates.push({
                        configValue: config.configurationValue,
                        ifaceNum: iface.interfaceNumber,
                        altSetting: alt.alternateSetting,
                        epIn: eps.bulkIn,
                        epOut: eps.bulkOut,
                    })
                }
            }
        }
    }
    return candidates
}

function bulkInOut(alt: USBAlternateInterface): { bulkIn: number; bulkOut: number } | null {
    let bulkIn = -1
    let bulkOut = -1
    for (let ei = 0; ei < alt.endpoints.length; ei++) {
        const ep = alt.endpoints[ei]
        if (ep.type === 'bulk' && ep.direction === 'in') bulkIn = ep.endpointNumber
        if (ep.type === 'bulk' && ep.direction === 'out') bulkOut = ep.endpointNumber
    }
    if (bulkIn >= 0 && bulkOut >= 0) return { bulkIn, bulkOut }
    return null
}

function describeUsbLayout(device: USBDevice): string {
    const parts: string[] = [`configs=${device.configurations.length}`]
    for (let ci = 0; ci < device.configurations.length; ci++) {
        const config = device.configurations[ci]
        for (let ii = 0; ii < config.interfaces.length; ii++) {
            const iface = config.interfaces[ii]
            for (let ai = 0; ai < iface.alternates.length; ai++) {
                const alt = iface.alternates[ai]
                const eps: string[] = []
                for (let ei = 0; ei < alt.endpoints.length; ei++) {
                    const ep = alt.endpoints[ei]
                    eps.push(`${ep.direction}:${ep.type}:ep${ep.endpointNumber}`)
                }
                parts.push(
                    `cfg${config.configurationValue} if${iface.interfaceNumber}` +
                    ` alt${alt.alternateSetting} class=${alt.interfaceClass}/${alt.interfaceSubclass}/${alt.interfaceProtocol}` +
                    ` eps=[${eps.join(',')}]`,
                )
            }
        }
    }
    return parts.join('; ')
}

function formatInData(result: USBInTransferResult): string {
    if (!result.data || result.data.byteLength === 0) return `${result.status} (empty)`
    const u = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
    const bytes: string[] = []
    for (let i = 0; i < u.length; i++) bytes.push(String(u[i]))
    return `${result.status} [${bytes.join(':')}]`
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal && signal.aborted) throw new Error('Pairing aborted')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (signal) signal.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        const onAbort = () => {
            clearTimeout(timer)
            reject(new Error('Pairing aborted'))
        }
        if (signal) {
            if (signal.aborted) {
                clearTimeout(timer)
                reject(new Error('Pairing aborted'))
                return
            }
            signal.addEventListener('abort', onAbort, { once: true })
        }
    })
}

async function ensureConfigured(device: USBDevice, log: (msg: string) => void): Promise<void> {
    if (device.configuration) return
    if (device.configurations.length === 0) {
        throw new Error('USB device has no configurations')
    }
    const value = device.configurations[0].configurationValue
    log(`Selecting configuration ${value} for Apple vendor control transfers`)
    await device.selectConfiguration(value)
}

async function vendorIn(
    device: USBDevice,
    request: number,
    index: number,
    length: number,
): Promise<USBInTransferResult> {
    return device.controlTransferIn({
        requestType: 'vendor',
        recipient: 'device',
        request,
        value: 0,
        index,
    }, length)
}

function looksLikeDisconnect(msg: string): boolean {
    return /disconnect|InvalidState|NetworkError|device not found|The device is no longer|The device was disconnected/i.test(msg)
}

function isOsHeldUsbClass(cls: number): boolean {
    // PTP/still image (6), HID (3), audio (1), mass storage (8), hub (9), video (14)
    return cls === 1 || cls === 3 || cls === 6 || cls === 8 || cls === 9 || cls === 14
}

function vendorClaimTargets(device: USBDevice): number[] {
    const cfg = device.configuration
    if (!cfg) return []
    const mux: number[] = []
    const vendor: number[] = []
    for (let i = 0; i < cfg.interfaces.length; i++) {
        const iface = cfg.interfaces[i]
        const alt = iface.alternates[0]
        if (!alt || isOsHeldUsbClass(alt.interfaceClass)) continue
        if (alt.interfaceClass === 255 && alt.interfaceSubclass === 254) {
            mux.push(iface.interfaceNumber)
        } else if (alt.interfaceClass === 255) {
            vendor.push(iface.interfaceNumber)
        }
    }
    return mux.concat(vendor)
}

function configValuesHighestFirst(device: USBDevice): number[] {
    const values: number[] = []
    for (let i = 0; i < device.configurations.length; i++) {
        values.push(device.configurations[i].configurationValue)
    }
    values.sort((a, b) => b - a)
    return values
}

async function getAppleMode(device: USBDevice, log: (msg: string) => void): Promise<boolean> {
    try {
        const mode = await vendorIn(device, APPLE_GET_MODE, 0, 4)
        log(`Apple GET_MODE: ${formatInData(mode)}`)
        return true
    } catch (e: any) {
        log(`Apple GET_MODE failed: ${e.message}`)
        return false
    }
}

async function setAppleMode(
    device: USBDevice,
    mode: number,
    log: (msg: string) => void,
): Promise<'ok' | 'disconnected' | 'failed'> {
    try {
        const set = await vendorIn(device, APPLE_SET_MODE, mode, 1)
        log(`Apple SET_MODE(${mode}): ${formatInData(set)}`)
        return 'ok'
    } catch (e: any) {
        const msg = e && e.message ? e.message : String(e)
        if (looksLikeDisconnect(msg)) {
            log(`Apple SET_MODE(${mode}): ${msg} (re-enumerate expected)`)
            return 'disconnected'
        }
        log(`Apple SET_MODE(${mode}) failed: ${msg}`)
        return 'failed'
    }
}

async function setAppleNcmMode(device: USBDevice, log: (msg: string) => void): Promise<'ok' | 'disconnected' | 'failed'> {
    return setAppleMode(device, APPLE_NCM_MODE, log)
}

async function tryAppleModeSwitch(device: USBDevice, log: (msg: string) => void): Promise<boolean> {
    const gotMode = await getAppleMode(device, log)
    const setResult = await setAppleNcmMode(device, log)
    if (setResult === 'ok' || setResult === 'disconnected') return true
    // GET_MODE can succeed on a mode that already exposes NCM after a previous switch.
    return gotMode
}

async function tryModeSwitchOnCurrentConfig(
    device: USBDevice,
    log: (msg: string) => void,
): Promise<boolean> {
    const active = device.configuration ? device.configuration.configurationValue : -1
    log(`Trying Apple NCM mode switch on config=${active} (no claim)`)
    if (await tryAppleModeSwitch(device, log)) return true

    const targets = vendorClaimTargets(device)
    for (let i = 0; i < targets.length; i++) {
        const ifaceNum = targets[i]
        try {
            log(`Claiming vendor iface ${ifaceNum} to retry Apple NCM mode switch`)
            await device.claimInterface(ifaceNum)
        } catch (e: any) {
            log(`claimInterface(${ifaceNum}) failed: ${e.message}`)
            continue
        }
        try {
            if (await tryAppleModeSwitch(device, log)) return true
        } finally {
            try { await device.releaseInterface(ifaceNum) } catch { /* ok */ }
        }
    }
    return false
}

async function enableAppleNcmMode(
    device: USBDevice,
    log: (msg: string) => void,
): Promise<void> {
    await ensureConfigured(device, log)

    const configs = configValuesHighestFirst(device)
    for (let i = 0; i < configs.length; i++) {
        const cfg = configs[i]
        const active = device.configuration ? device.configuration.configurationValue : -1
        if (active !== cfg) {
            try {
                await device.selectConfiguration(cfg)
                log(`Selected config ${cfg} for Apple NCM mode switch`)
            } catch (e: any) {
                log(`selectConfiguration(${cfg}) failed: ${e.message}`)
                if (!device.configuration || device.configuration.configurationValue !== cfg) continue
            }
        }
        if (await tryModeSwitchOnCurrentConfig(device, log)) return
    }

    throw new Error(
        'Apple GET_MODE/SET_MODE(3) failed. Windows is holding PTP/mux interfaces. ' +
        'Close iTunes and Apple Mobile Device Service, then unplug/replug the phone.',
    )
}

function isSameAppleDevice(device: USBDevice, previous: USBDevice): boolean {
    if (device.vendorId !== APPLE_VID) return false
    if (previous.serialNumber && device.serialNumber && device.serialNumber !== previous.serialNumber) {
        return false
    }
    return true
}

function pickReenumeratedDevice(devices: USBDevice[], previous: USBDevice): USBDevice | null {
    for (let i = 0; i < devices.length; i++) {
        const d = devices[i]
        if (!isSameAppleDevice(d, previous)) continue
        if (findNcmCandidates(d).length > 0) return d
    }
    return null
}

function isUsbOpenDenied(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false
    const name = (err as Error).name || ''
    const msg = (err as Error).message || ''
    return name === 'SecurityError'
        || name === 'NotAllowedError'
        || /not allowed|security error|access denied/i.test(msg)
}

async function tryOpenNcmDevice(
    device: USBDevice,
    previous: USBDevice,
    log: (msg: string) => void,
    fromConnect = false,
): Promise<USBDevice | null> {
    if (!isSameAppleDevice(device, previous)) return null
    const hasNcm = findNcmCandidates(device).length > 0
    const manyConfigs = device.configurations.length >= 5
    if (!hasNcm && !(fromConnect && manyConfigs)) {
        if (fromConnect) {
            log(`Re-enumerated device has no CDC-NCM yet (configs=${device.configurations.length}), waiting`)
        }
        return null
    }
    try {
        if (!device.opened) await device.open()
    } catch (e: any) {
        if (isUsbOpenDenied(e)) {
            throw new UsbReselectRequiredError()
        }
        log(`USB open after re-enumerate failed: ${e && e.message ? e.message : String(e)}`)
        return null
    }
    if (!hasNcm) {
        log(`Re-enumerated device has no CDC-NCM yet (configs=${device.configurations.length}), waiting`)
        return null
    }
    log(`Re-enumerated NCM device open OK: ${device.productName} (${device.serialNumber})`)
    return device
}

async function tryOpenAppleDevice(
    device: USBDevice,
    previous: USBDevice,
    log: (msg: string) => void,
): Promise<USBDevice | null> {
    if (!isSameAppleDevice(device, previous)) return null
    try {
        if (!device.opened) await device.open()
    } catch (e: any) {
        if (isUsbOpenDenied(e)) throw new UsbReselectRequiredError()
        log(`USB open after re-enumerate failed: ${e && e.message ? e.message : String(e)}`)
        return null
    }
    log(
        `Re-enumerated device open OK: ${device.productName} (${device.serialNumber}) ` +
        `configs=${device.configurations.length}`,
    )
    return device
}

async function waitForReenumeratedAppleDevice(
    previous: USBDevice,
    log: (msg: string) => void,
    signal?: AbortSignal,
): Promise<USBDevice> {
    try { await previous.close() } catch { /* already gone */ }

    const deadline = Date.now() + REENUMERATE_TIMEOUT_MS

    return new Promise<USBDevice>((resolve, reject) => {
        let settled = false

        const finish = (value: USBDevice | Error) => {
            if (settled) return
            settled = true
            navigator.usb.removeEventListener('connect', onConnect)
            if (signal) signal.removeEventListener('abort', onAbort)
            if (value instanceof Error) reject(value)
            else resolve(value)
        }

        const onAbort = () => finish(new Error('Pairing aborted'))

        const consider = (device: USBDevice) => {
            return tryOpenAppleDevice(device, previous, log).then(accepted => {
                if (accepted) finish(accepted)
            }).catch(e => {
                finish(e instanceof Error ? e : new Error(String(e)))
            })
        }

        const onConnect = (ev: Event) => {
            const device = (ev as USBConnectionEvent).device
            if (!isSameAppleDevice(device, previous)) return
            log(`Device reconnected configs=${device.configurations.length}`)
            void consider(device)
        }

        const poll = async () => {
            while (!settled && Date.now() < deadline) {
                try {
                    throwIfAborted(signal)
                    const devices = await navigator.usb.getDevices()
                    for (let i = 0; i < devices.length; i++) {
                        const d = devices[i]
                        if (!isSameAppleDevice(d, previous)) continue
                        log(`Found re-enumerated device via getDevices() configs=${d.configurations.length}`)
                        await consider(d)
                        if (settled) return
                    }
                    await sleep(400, signal)
                } catch (e: any) {
                    finish(e instanceof Error ? e : new Error(String(e)))
                    return
                }
            }
            if (!settled) {
                finish(new Error('iPhone disconnected. Plug it in and tap ADD DEVICE.'))
            }
        }

        if (signal) {
            if (signal.aborted) {
                finish(new Error('Pairing aborted'))
                return
            }
            signal.addEventListener('abort', onAbort)
        }
        navigator.usb.addEventListener('connect', onConnect)
        void poll()
    })
}

async function recycleAppleUsbForNcmClaim(
    device: USBDevice,
    log: (msg: string) => void,
    signal?: AbortSignal,
    onReenumerateWait?: () => void,
): Promise<USBDevice> {
    log('Recycling USB mode: SET_MODE(1) mux reset, then SET_MODE(3) NCM')
    await ensureConfigured(device, log)
    let current = device
    const muxResult = await setAppleMode(current, APPLE_MUX_MODE, log)
    if (muxResult === 'failed') {
        throw new Error('Apple SET_MODE(1) failed while recycling USB mode')
    }
    try { await current.close() } catch { /* ok */ }
    onReenumerateWait?.()
    await sleep(800, signal)
    current = await waitForReenumeratedAppleDevice(current, log, signal)
    await enableAppleNcmMode(current, log)
    onReenumerateWait?.()
    try { await current.close() } catch { /* ok */ }
    current = await waitForReenumeratedDevice(current, log, signal)
    if (!current.opened) {
        try {
            await current.open()
        } catch (e: any) {
            if (isUsbOpenDenied(e)) throw new UsbReselectRequiredError()
            throw e
        }
    }
    log(`After USB recycle: ${current.productName} (${current.serialNumber})`)
    log(`USB layout: ${describeUsbLayout(current)}`)
    return current
}

async function waitForReenumeratedDevice(
    previous: USBDevice,
    log: (msg: string) => void,
    signal?: AbortSignal,
): Promise<USBDevice> {
    try { await previous.close() } catch { /* already gone after SET_MODE */ }

    const deadline = Date.now() + REENUMERATE_TIMEOUT_MS

    return new Promise<USBDevice>((resolve, reject) => {
        let settled = false
        let openedHold: USBDevice | null = null

        const finish = (value: USBDevice | Error) => {
            if (settled) return
            settled = true
            navigator.usb.removeEventListener('connect', onConnect)
            if (signal) signal.removeEventListener('abort', onAbort)
            if (value instanceof Error) {
                if (openedHold && openedHold.opened) {
                    void openedHold.close().catch(() => {})
                }
                reject(value)
            } else {
                if (openedHold && openedHold !== value && openedHold.opened) {
                    void openedHold.close().catch(() => {})
                }
                resolve(value)
            }
        }

        const onAbort = () => finish(new Error('Pairing aborted'))

        const consider = (device: USBDevice, fromConnect: boolean) => {
            return tryOpenNcmDevice(device, previous, log, fromConnect).then(accepted => {
                if (accepted) {
                    finish(accepted)
                    return
                }
                if (device.opened) openedHold = device
            }).catch(e => {
                finish(e instanceof Error ? e : new Error(String(e)))
            })
        }

        const onConnect = (ev: Event) => {
            const device = (ev as USBConnectionEvent).device
            if (!isSameAppleDevice(device, previous)) return
            log(`Device reconnected after NCM mode switch configs=${device.configurations.length}`)
            void consider(device, true)
        }

        const poll = async () => {
            while (!settled && Date.now() < deadline) {
                try {
                    throwIfAborted(signal)
                    const found = pickReenumeratedDevice(await navigator.usb.getDevices(), previous)
                    if (found) {
                        log(`Found re-enumerated device via getDevices() configs=${found.configurations.length}`)
                        await consider(found, false)
                        if (settled) return
                    }
                    await sleep(400, signal)
                } catch (e: any) {
                    finish(e instanceof Error ? e : new Error(String(e)))
                    return
                }
            }
            if (!settled) {
                finish(new Error(
                    'iPhone disconnected. Plug it in and tap ADD DEVICE.',
                ))
            }
        }

        if (signal) {
            if (signal.aborted) {
                finish(new Error('Pairing aborted'))
                return
            }
            signal.addEventListener('abort', onAbort)
        }
        navigator.usb.addEventListener('connect', onConnect)
        void poll()
    })
}

async function tryClaimCandidate(
    device: USBDevice,
    cand: NcmCandidate,
    log: (msg: string) => void,
): Promise<ClaimedNcmInterface | null> {
    const active = device.configuration ? device.configuration.configurationValue : -1
    log(`Trying CDC-NCM config=${cand.configValue} iface=${cand.ifaceNum} alt=${cand.altSetting} (active=${active})`)

    // Windows WinUSB often forbids SET_CONFIGURATION on an already-configured
    // composite device. Do not bounce through other configs; that unbinds us.
    if (active !== cand.configValue) {
        try {
            await device.selectConfiguration(cand.configValue)
        } catch (e: any) {
            log(`selectConfiguration(${cand.configValue}) failed: ${e.message}`)
            return null
        }
    }

    let lastErr = ''
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            await device.claimInterface(cand.ifaceNum)
            if (cand.altSetting > 0) {
                await device.selectAlternateInterface(cand.ifaceNum, cand.altSetting)
            }
            log(`CDC-NCM claimed: EP${cand.epIn} in / EP${cand.epOut} out (config ${cand.configValue})`)
            return {
                device,
                epIn: cand.epIn,
                epOut: cand.epOut,
                claimedIface: cand.ifaceNum,
                fallbackConfig: false,
            }
        } catch (e: any) {
            lastErr = e && e.message ? e.message : String(e)
            if (attempt === 0 || attempt === 5 || attempt === 19) {
                log(`claimInterface(${cand.ifaceNum}) attempt ${attempt + 1}: ${lastErr}`)
            }
        }
    }
    log(`Gave up claiming iface ${cand.ifaceNum}: ${lastErr}`)
    return null
}

function highestNcmConfigValue(candidates: NcmCandidate[]): number {
    let max = 0
    for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].configValue > max) max = candidates[i].configValue
    }
    return max
}

async function claimFromCandidates(
    device: USBDevice,
    candidates: NcmCandidate[],
    log: (msg: string) => void,
): Promise<ClaimedNcmInterface | null> {
    const activeVal = device.configuration ? device.configuration.configurationValue : -1
    const ordered: NcmCandidate[] = []
    for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].configValue === activeVal) ordered.push(candidates[i])
    }
    for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].configValue !== activeVal) ordered.push(candidates[i])
    }
    for (let i = 0; i < ordered.length; i++) {
        const claimed = await tryClaimCandidate(device, ordered[i], log)
        if (claimed) return claimed
    }
    return null
}

export async function claimCdcNcmInterface(
    device: USBDevice,
    log: (msg: string) => void = () => {},
    signal?: AbortSignal,
    onReenumerateWait?: () => void,
): Promise<ClaimedNcmInterface> {
    throwIfAborted(signal)
    log(`USB layout: ${describeUsbLayout(device)}`)

    let current = device
    try {
        let candidates = findNcmCandidates(current)

        if (candidates.length === 0) {
            log(
                `No CDC-NCM data interface yet (${current.configurations.length} USB configs). ` +
                `Enabling Apple NCM mode (vendor GET_MODE/SET_MODE 3), as go-ios does when configs != 5.`,
            )
            try {
                await enableAppleNcmMode(current, log)
            } catch (e: any) {
                throw new Error(
                    `No CDC-NCM data interface found, and Apple NCM mode switch failed: ${e.message}`,
                )
            }
            onReenumerateWait?.()
            current = await waitForReenumeratedDevice(current, log, signal)
            if (!current.opened) {
                try {
                    await current.open()
                } catch (e: any) {
                    if (isUsbOpenDenied(e)) throw new UsbReselectRequiredError()
                    throw e
                }
            }
            log(`After re-enumerate: ${current.productName} (${current.serialNumber})`)
            log(`USB layout: ${describeUsbLayout(current)}`)
            candidates = findNcmCandidates(current)
        }

        if (candidates.length === 0) {
            throw new Error(
                `No CDC-NCM data interface found on this device (${describeUsbLayout(current)})`,
            )
        }

        // Phone already in NCM mode (5+ configs): only claim NCM on the highest
        // config. Falling back to an older config (e.g. cfg5 while active=cfg6)
        // opens a stale handle that receives mDNS noise but never completes
        // _remoted._tcp -> 45s "Discovering..." hang.
        const maxNcmConfig = highestNcmConfigValue(candidates)
        const ncmMode = current.configurations.length >= 5
        const liveCandidates = ncmMode
            ? candidates.filter(c => c.configValue === maxNcmConfig)
            : candidates
        if (ncmMode) {
            log(
                `NCM mode (${current.configurations.length} configs): only trying CDC-NCM on config ${maxNcmConfig}`,
            )
        }

        let claimed = await claimFromCandidates(current, liveCandidates, log)
        if (claimed) return claimed

        if (ncmMode) {
            log('Could not claim live NCM interface; trying USB mode recycle')
            current = await recycleAppleUsbForNcmClaim(current, log, signal, onReenumerateWait)
            candidates = findNcmCandidates(current)
            const maxAfterRecycle = highestNcmConfigValue(candidates)
            const liveAfterRecycle = candidates.filter(c => c.configValue === maxAfterRecycle)
            claimed = await claimFromCandidates(current, liveAfterRecycle, log)
            if (claimed) return claimed

            const fallbackCandidates = candidates.filter(c => c.configValue < maxAfterRecycle)
            if (fallbackCandidates.length > 0) {
                const cfgList = fallbackCandidates.map(c => String(c.configValue)).join(',')
                log(
                    `macOS may be holding config ${maxAfterRecycle}; trying fallback CDC-NCM on config(s) ${cfgList}`,
                )
                claimed = await claimFromCandidates(current, fallbackCandidates, log)
                if (claimed) {
                    claimed.fallbackConfig = true
                    return claimed
                }
            }

            throw new Error(USB_CLAIM_FAILED_MSG)
        }

        const active = current.configuration ? current.configuration.configurationValue : -1
        const needed = candidates.map(c => String(c.configValue)).join(',')
        throw new Error(
            `Could not claim CDC-NCM (active USB config=${active}, NCM is on config ${needed}). ` +
            `On Windows, Chrome cannot switch USB configuration if Apple Mobile Device / UsbNcm already owns the device. ` +
            `Close iTunes and Apple Mobile Device Service, then unplug/replug the phone.`,
        )
    } catch (e) {
        if (current.opened) {
            try { await current.close() } catch { /* ok */ }
        }
        throw e
    }
}

export async function releaseCdcNcmInterface(device: USBDevice, claimedIface: number): Promise<void> {
    if (claimedIface >= 0) {
        await device.releaseInterface(claimedIface).catch(() => {})
    }
    await device.close().catch(() => {})
}

export async function requestAppleUsbDevice(): Promise<USBDevice> {
    return navigator.usb.requestDevice({ filters: [{ vendorId: APPLE_VID }] })
}

export async function getAuthorizedAppleDevice(): Promise<USBDevice | null> {
    const devices = await navigator.usb.getDevices()
    const apple = devices.filter(d => d.vendorId === APPLE_VID)
    for (let i = 0; i < apple.length; i++) {
        if (findNcmCandidates(apple[i]).length > 0) return apple[i]
    }
    // Do not fall back to mux-only grants: after SET_MODE the USB identity changes and
    // a stale mux handle can open/claim yet never deliver NCM traffic (discovering hang).
    return null
}
