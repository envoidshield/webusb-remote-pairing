export function findNcmCandidates(device) {
    const candidates = [];
    for (let ci = 0; ci < device.configurations.length; ci++) {
        const config = device.configurations[ci];
        for (let ii = 0; ii < config.interfaces.length; ii++) {
            const iface = config.interfaces[ii];
            for (let ai = 0; ai < iface.alternates.length; ai++) {
                const alt = iface.alternates[ai];
                if (alt.interfaceClass === 10 && alt.interfaceSubclass === 0 && alt.interfaceProtocol === 1) {
                    let bulkIn = -1;
                    let bulkOut = -1;
                    for (let ei = 0; ei < alt.endpoints.length; ei++) {
                        const ep = alt.endpoints[ei];
                        if (ep.type === 'bulk' && ep.direction === 'in')
                            bulkIn = ep.endpointNumber;
                        if (ep.type === 'bulk' && ep.direction === 'out')
                            bulkOut = ep.endpointNumber;
                    }
                    if (bulkIn >= 0 && bulkOut >= 0) {
                        candidates.push({
                            configValue: config.configurationValue,
                            ifaceNum: iface.interfaceNumber,
                            altSetting: alt.alternateSetting,
                            epIn: bulkIn,
                            epOut: bulkOut,
                        });
                    }
                }
            }
        }
    }
    return candidates;
}
export async function claimCdcNcmInterface(device, log = () => { }) {
    const candidates = findNcmCandidates(device);
    if (candidates.length === 0) {
        throw new Error('No CDC-NCM data interface found on this device');
    }
    const allConfigValues = device.configurations.map(c => c.configurationValue);
    for (let cIdx = candidates.length - 1; cIdx >= 0; cIdx--) {
        const cand = candidates[cIdx];
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
            continue;
        }
        for (let attempt = 0; attempt < 20; attempt++) {
            try {
                await device.claimInterface(cand.ifaceNum);
                if (cand.altSetting > 0) {
                    await device.selectAlternateInterface(cand.ifaceNum, cand.altSetting);
                }
                log(`CDC-NCM claimed: EP${cand.epIn} in / EP${cand.epOut} out`);
                return { epIn: cand.epIn, epOut: cand.epOut, claimedIface: cand.ifaceNum };
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
    }
    throw new Error('Could not claim CDC-NCM interface (kernel driver may be holding it)');
}
export async function releaseCdcNcmInterface(device, claimedIface) {
    if (claimedIface >= 0) {
        await device.releaseInterface(claimedIface).catch(() => { });
    }
    await device.close().catch(() => { });
}
export async function requestAppleUsbDevice() {
    return navigator.usb.requestDevice({ filters: [{ vendorId: 0x05ac }] });
}
export async function getAuthorizedAppleDevice() {
    const devices = await navigator.usb.getDevices();
    const apple = devices.filter(d => d.vendorId === 0x05ac);
    return apple.length > 0 ? apple[0] : null;
}
//# sourceMappingURL=usb-claim.js.map