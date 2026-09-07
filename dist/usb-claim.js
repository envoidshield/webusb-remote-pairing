// Apple vendor-specific USB mode switch (same as go-ios ncm/usb.go and usbmuxd).
// GET_MODE 0x45 / SET_MODE 0x52. Mode 3 exposes configuration 5 with CDC-NCM.
const APPLE_VID = 0x05ac;
const APPLE_GET_MODE = 69;
const APPLE_SET_MODE = 82;
const APPLE_NCM_MODE = 3;
const REENUMERATE_TIMEOUT_MS = 15000;
export function findNcmCandidates(device) {
    const candidates = [];
    for (let ci = 0; ci < device.configurations.length; ci++) {
        const config = device.configurations[ci];
        for (let ii = 0; ii < config.interfaces.length; ii++) {
            const iface = config.interfaces[ii];
            for (let ai = 0; ai < iface.alternates.length; ai++) {
                const alt = iface.alternates[ai];
                const eps = bulkInOut(alt);
                // go-ios: class 10 (CDC-Data), subclass 0, two endpoints. Do not require protocol 1;
                // Apple's private NCM data iface sometimes reports protocol 0.
                if (alt.interfaceClass === 10 && alt.interfaceSubclass === 0 && eps) {
                    candidates.push({
                        configValue: config.configurationValue,
                        ifaceNum: iface.interfaceNumber,
                        altSetting: alt.alternateSetting,
                        epIn: eps.bulkIn,
                        epOut: eps.bulkOut,
                    });
                }
            }
        }
    }
    return candidates;
}
function bulkInOut(alt) {
    let bulkIn = -1;
    let bulkOut = -1;
    for (let ei = 0; ei < alt.endpoints.length; ei++) {
        const ep = alt.endpoints[ei];
        if (ep.type === 'bulk' && ep.direction === 'in')
            bulkIn = ep.endpointNumber;
        if (ep.type === 'bulk' && ep.direction === 'out')
            bulkOut = ep.endpointNumber;
    }
    if (bulkIn >= 0 && bulkOut >= 0)
        return { bulkIn, bulkOut };
    return null;
}
function describeUsbLayout(device) {
    const parts = [`configs=${device.configurations.length}`];
    for (let ci = 0; ci < device.configurations.length; ci++) {
        const config = device.configurations[ci];
        for (let ii = 0; ii < config.interfaces.length; ii++) {
            const iface = config.interfaces[ii];
            for (let ai = 0; ai < iface.alternates.length; ai++) {
                const alt = iface.alternates[ai];
                const eps = [];
                for (let ei = 0; ei < alt.endpoints.length; ei++) {
                    const ep = alt.endpoints[ei];
                    eps.push(`${ep.direction}:${ep.type}:ep${ep.endpointNumber}`);
                }
                parts.push(`cfg${config.configurationValue} if${iface.interfaceNumber}` +
                    ` alt${alt.alternateSetting} class=${alt.interfaceClass}/${alt.interfaceSubclass}/${alt.interfaceProtocol}` +
                    ` eps=[${eps.join(',')}]`);
            }
        }
    }
    return parts.join('; ');
}
function formatInData(result) {
    if (!result.data || result.data.byteLength === 0)
        return `${result.status} (empty)`;
    const u = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
    const bytes = [];
    for (let i = 0; i < u.length; i++)
        bytes.push(String(u[i]));
    return `${result.status} [${bytes.join(':')}]`;
}
function throwIfAborted(signal) {
    if (signal && signal.aborted)
        throw new Error('Pairing aborted');
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (signal)
                signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Pairing aborted'));
        };
        if (signal) {
            if (signal.aborted) {
                clearTimeout(timer);
                reject(new Error('Pairing aborted'));
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}
async function ensureConfigured(device, log) {
    if (device.configuration)
        return;
    if (device.configurations.length === 0) {
        throw new Error('USB device has no configurations');
    }
    const value = device.configurations[0].configurationValue;
    log(`Selecting configuration ${value} for Apple vendor control transfers`);
    await device.selectConfiguration(value);
}
async function vendorIn(device, request, index, length) {
    return device.controlTransferIn({
        requestType: 'vendor',
        recipient: 'device',
        request,
        value: 0,
        index,
    }, length);
}
async function setAppleNcmMode(device, log) {
    try {
        const set = await vendorIn(device, APPLE_SET_MODE, APPLE_NCM_MODE, 1);
        log(`Apple SET_MODE(${APPLE_NCM_MODE}): ${formatInData(set)}`);
    }
    catch (e) {
        // Device typically disconnects immediately after a successful SET_MODE.
        log(`Apple SET_MODE(${APPLE_NCM_MODE}): ${e.message} (disconnect after switch is expected)`);
    }
}
async function getAppleMode(device, log) {
    try {
        const mode = await vendorIn(device, APPLE_GET_MODE, 0, 4);
        log(`Apple GET_MODE: ${formatInData(mode)}`);
        return true;
    }
    catch (e) {
        log(`Apple GET_MODE failed: ${e.message}`);
        return false;
    }
}
async function enableAppleNcmMode(device, log) {
    await ensureConfigured(device, log);
    let gotMode = await getAppleMode(device, log);
    if (!gotMode) {
        // Windows WinUSB: some bindings reject device-recipient vendor requests until an interface is claimed.
        const ifaceNum = device.configuration && device.configuration.interfaces.length > 0
            ? device.configuration.interfaces[0].interfaceNumber
            : -1;
        if (ifaceNum < 0) {
            throw new Error('Could not enable CDC-NCM: Apple USB mode switch failed and no interface is available to claim. ' +
                'On Windows, close iTunes / Apple Mobile Device Service if they hold the device.');
        }
        log(`Claiming iface ${ifaceNum} to retry Apple NCM mode switch`);
        await device.claimInterface(ifaceNum);
        try {
            gotMode = await getAppleMode(device, log);
            if (gotMode)
                await setAppleNcmMode(device, log);
        }
        finally {
            try {
                await device.releaseInterface(ifaceNum);
            }
            catch { /* ok */ }
        }
        if (!gotMode) {
            throw new Error('Apple USB GET_MODE failed. On Windows, close iTunes / Apple Mobile Device Service, ' +
                'or bind WinUSB to the iPhone if Chrome cannot send vendor control transfers.');
        }
        return;
    }
    await setAppleNcmMode(device, log);
}
function isSameAppleDevice(device, previous) {
    if (device.vendorId !== APPLE_VID)
        return false;
    if (previous.serialNumber && device.serialNumber && device.serialNumber !== previous.serialNumber) {
        return false;
    }
    return true;
}
function pickReenumeratedDevice(devices, previous) {
    const matches = [];
    for (let i = 0; i < devices.length; i++) {
        if (isSameAppleDevice(devices[i], previous))
            matches.push(devices[i]);
    }
    for (let i = 0; i < matches.length; i++) {
        if (findNcmCandidates(matches[i]).length > 0)
            return matches[i];
    }
    for (let i = 0; i < matches.length; i++) {
        if (matches[i].configurations.length >= 5)
            return matches[i];
    }
    return null;
}
async function waitForReenumeratedDevice(previous, log, signal) {
    try {
        await previous.close();
    }
    catch { /* already gone after SET_MODE */ }
    const deadline = Date.now() + REENUMERATE_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            navigator.usb.removeEventListener('connect', onConnect);
            if (signal)
                signal.removeEventListener('abort', onAbort);
            if (value instanceof Error)
                reject(value);
            else
                resolve(value);
        };
        const onAbort = () => finish(new Error('Pairing aborted'));
        const onConnect = (ev) => {
            const device = ev.device;
            if (!isSameAppleDevice(device, previous))
                return;
            log(`Device reconnected after NCM mode switch configs=${device.configurations.length}`);
            if (findNcmCandidates(device).length > 0 || device.configurations.length >= 5) {
                finish(device);
            }
        };
        const poll = async () => {
            while (!settled && Date.now() < deadline) {
                try {
                    throwIfAborted(signal);
                    const found = pickReenumeratedDevice(await navigator.usb.getDevices(), previous);
                    if (found) {
                        log(`Found re-enumerated device via getDevices() configs=${found.configurations.length}`);
                        finish(found);
                        return;
                    }
                    await sleep(400, signal);
                }
                catch (e) {
                    finish(e instanceof Error ? e : new Error(String(e)));
                    return;
                }
            }
            if (!settled) {
                void navigator.usb.getDevices().then(list => {
                    const fallback = list.filter(d => isSameAppleDevice(d, previous))[0];
                    if (fallback) {
                        log('Re-enumerate wait timed out; using current Apple USB handle');
                        finish(fallback);
                        return;
                    }
                    finish(new Error('Timed out waiting for iPhone to re-enumerate after NCM mode switch. Unplug/replug USB and retry.'));
                }).catch(e => finish(e instanceof Error ? e : new Error(String(e))));
            }
        };
        if (signal) {
            if (signal.aborted) {
                finish(new Error('Pairing aborted'));
                return;
            }
            signal.addEventListener('abort', onAbort);
        }
        navigator.usb.addEventListener('connect', onConnect);
        void poll();
    });
}
async function tryClaimCandidate(device, cand, allConfigValues, log) {
    log(`Trying CDC-NCM config=${cand.configValue} iface=${cand.ifaceNum}`);
    for (let rci = 0; rci < allConfigValues.length; rci++) {
        if (allConfigValues[rci] !== cand.configValue) {
            try {
                await device.selectConfiguration(allConfigValues[rci]);
            }
            catch { /* ok */ }
        }
    }
    try {
        await device.selectConfiguration(cand.configValue);
    }
    catch (e) {
        log(`selectConfiguration(${cand.configValue}) failed: ${e.message}`);
        return null;
    }
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            await device.claimInterface(cand.ifaceNum);
            if (cand.altSetting > 0) {
                await device.selectAlternateInterface(cand.ifaceNum, cand.altSetting);
            }
            log(`CDC-NCM claimed: EP${cand.epIn} in / EP${cand.epOut} out`);
            return { device, epIn: cand.epIn, epOut: cand.epOut, claimedIface: cand.ifaceNum };
        }
        catch {
            if (attempt === 5 || attempt === 10 || attempt === 15) {
                try {
                    await device.selectConfiguration(allConfigValues[0]);
                    await device.selectConfiguration(cand.configValue);
                }
                catch { /* ok */ }
            }
        }
    }
    return null;
}
async function claimFromCandidates(device, candidates, log) {
    const allConfigValues = device.configurations.map(c => c.configurationValue);
    for (let cIdx = candidates.length - 1; cIdx >= 0; cIdx--) {
        const claimed = await tryClaimCandidate(device, candidates[cIdx], allConfigValues, log);
        if (claimed)
            return claimed;
    }
    return null;
}
export async function claimCdcNcmInterface(device, log = () => { }, signal) {
    throwIfAborted(signal);
    log(`USB layout: ${describeUsbLayout(device)}`);
    let current = device;
    let candidates = findNcmCandidates(current);
    if (candidates.length === 0) {
        log(`No CDC-NCM data interface yet (${current.configurations.length} USB configs). ` +
            `Enabling Apple NCM mode (vendor GET_MODE/SET_MODE 3), as go-ios does when configs != 5.`);
        try {
            await enableAppleNcmMode(current, log);
        }
        catch (e) {
            throw new Error(`No CDC-NCM data interface found, and Apple NCM mode switch failed: ${e.message}`);
        }
        current = await waitForReenumeratedDevice(current, log, signal);
        if (!current.opened) {
            await current.open();
        }
        log(`After re-enumerate: ${current.productName} (${current.serialNumber})`);
        log(`USB layout: ${describeUsbLayout(current)}`);
        candidates = findNcmCandidates(current);
    }
    if (candidates.length === 0) {
        throw new Error(`No CDC-NCM data interface found on this device (${describeUsbLayout(current)})`);
    }
    const claimed = await claimFromCandidates(current, candidates, log);
    if (claimed)
        return claimed;
    throw new Error('Could not claim CDC-NCM interface (kernel driver may be holding it)');
}
export async function releaseCdcNcmInterface(device, claimedIface) {
    if (claimedIface >= 0) {
        await device.releaseInterface(claimedIface).catch(() => { });
    }
    await device.close().catch(() => { });
}
export async function requestAppleUsbDevice() {
    return navigator.usb.requestDevice({ filters: [{ vendorId: APPLE_VID }] });
}
export async function getAuthorizedAppleDevice() {
    const devices = await navigator.usb.getDevices();
    const apple = devices.filter(d => d.vendorId === APPLE_VID);
    return apple.length > 0 ? apple[0] : null;
}
//# sourceMappingURL=usb-claim.js.map