// Fresh remote pairing: handshake + SRP-3072 + Ed25519 + ChaCha (go-ios setupNewPairingGetHostKey).
// Does not implement pair-verify reconnect or createListener / TUN.
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { ed25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha512';
import { ControlChannel, getChildMap, readSetupPairingData } from './channel';
import { buildHostDeviceInfo } from './opack';
import { newSrpClient } from './srp';
import { PAIR_STATE_EXCHANGE_REQUEST, PAIR_STATE_VERIFY_REQUEST, TLV_ENCRYPTED_DATA, TLV_IDENTIFIER, TLV_INFO, TLV_METHOD, TLV_PROOF, TLV_PUBLIC_KEY, TLV_SALT, TLV_SIGNATURE, TLV_STATE, TlvBuffer, tlvReadCoalesced, } from './tlv';
const te = new TextEncoder();
function nonceWithTag(tag) {
    const n = new Uint8Array(12);
    const t = te.encode(tag);
    n.set(t, 4);
    return n;
}
function hkdfSha512(ikm, salt, info, length) {
    return hkdf(sha512, ikm, salt, te.encode(info), length);
}
export async function setupNewPairingGetHostKey(connOrChannel, selfId, onStatus) {
    const ch = connOrChannel instanceof ControlChannel
        ? connOrChannel
        : new ControlChannel(connOrChannel);
    onStatus && onStatus('Sending control-channel handshake (attemptPairVerify=false)');
    ch.writeRequest({
        handshake: {
            _0: {
                hostOptions: { attemptPairVerify: false },
                wireProtocolVersion: 19,
            },
        },
    });
    await ch.read();
    onStatus && onStatus('Waiting for Trust on iPhone…');
    const start = new TlvBuffer();
    start.writeByte(TLV_METHOD, 0x00);
    start.writeByte(TLV_STATE, 0x01);
    ch.writePairingEvent({
        data: start.bytes(),
        kind: 'setupManualPairing',
        sendingHost: 'EnVoid',
        startNewSession: true,
    });
    const deviceEvent = await readSetupPairingData(ch, onStatus);
    const devicePublic = tlvReadCoalesced(deviceEvent.data, TLV_PUBLIC_KEY);
    const salt = tlvReadCoalesced(deviceEvent.data, TLV_SALT);
    if (!devicePublic.length || !salt.length) {
        throw new Error('setupSessionKey: missing device public key or salt');
    }
    onStatus && onStatus('SRP-3072 session key');
    const srp = newSrpClient(salt, devicePublic);
    const proofTlv = new TlvBuffer();
    proofTlv.writeByte(TLV_STATE, PAIR_STATE_VERIFY_REQUEST);
    proofTlv.writeData(TLV_PUBLIC_KEY, srp.clientPublic);
    proofTlv.writeData(TLV_PROOF, srp.clientProof);
    ch.writePairingEvent({
        data: proofTlv.bytes(),
        kind: 'setupManualPairing',
    });
    const proofReply = await ch.readPairingEvent();
    const serverProof = tlvReadCoalesced(proofReply.data, TLV_PROOF);
    if (!srp.verifyServerProof(serverProof)) {
        throw new Error('setupSessionKey: could not verify server proof');
    }
    onStatus && onStatus('Exchanging device info (Ed25519 + OPack)');
    await exchangeDeviceInfo(ch, srp.sessionKey, selfId);
    onStatus && onStatus('Setting up session ciphers');
    const ciphers = setupCiphers(srp.sessionKey);
    onStatus && onStatus('createRemoteUnlockKey');
    const hostKey = await createUnlockKey(ch, ciphers);
    return hostKey;
}
async function exchangeDeviceInfo(ch, sessionKey, selfId) {
    const signInfo = hkdfSha512(sessionKey, te.encode('Pair-Setup-Controller-Sign-Salt'), 'Pair-Setup-Controller-Sign-Info', 32);
    const toSign = new Uint8Array(signInfo.length + selfId.identifier.length + selfId.publicKey.length);
    toSign.set(signInfo, 0);
    toSign.set(te.encode(selfId.identifier), signInfo.length);
    toSign.set(selfId.publicKey, signInfo.length + selfId.identifier.length);
    const signature = ed25519.sign(toSign, selfId.privateKey);
    const deviceInfo = buildHostDeviceInfo(selfId.identifier);
    const infoTlv = new TlvBuffer();
    infoTlv.writeData(TLV_SIGNATURE, signature);
    infoTlv.writeData(TLV_PUBLIC_KEY, selfId.publicKey);
    infoTlv.writeData(TLV_IDENTIFIER, te.encode(selfId.identifier));
    infoTlv.writeData(TLV_INFO, deviceInfo);
    const setupKey = hkdfSha512(sessionKey, te.encode('Pair-Setup-Encrypt-Salt'), 'Pair-Setup-Encrypt-Info', 32);
    const enc = chacha20poly1305(setupKey, nonceWithTag('PS-Msg05')).encrypt(infoTlv.bytes());
    const encTlv = new TlvBuffer();
    encTlv.writeByte(TLV_STATE, PAIR_STATE_EXCHANGE_REQUEST);
    encTlv.writeData(TLV_ENCRYPTED_DATA, enc);
    ch.writePairingEvent({
        data: encTlv.bytes(),
        kind: 'setupManualPairing',
        sendingHost: 'SL-1876',
    });
    const encRes = await ch.readPairingEvent();
    const encrData = tlvReadCoalesced(encRes.data, TLV_ENCRYPTED_DATA);
    chacha20poly1305(setupKey, nonceWithTag('PS-Msg06')).decrypt(encrData);
}
function setupCiphers(sessionKey) {
    return {
        clientKey: hkdfSha512(sessionKey, undefined, 'ClientEncrypt-main', 32),
        serverKey: hkdfSha512(sessionKey, undefined, 'ServerEncrypt-main', 32),
        nonce: new Uint8Array(12),
        sequence: 0,
    };
}
function updateNonce(c) {
    const view = new DataView(c.nonce.buffer);
    view.setUint32(0, c.sequence >>> 0, true);
    view.setUint32(4, 0, true);
}
async function createUnlockKey(ch, c) {
    const req = {
        request: {
            _0: {
                createRemoteUnlockKey: {},
            },
        },
    };
    updateNonce(c);
    const plain = new TextEncoder().encode(JSON.stringify(req));
    const encrypted = chacha20poly1305(c.clientKey, new Uint8Array(c.nonce)).encrypt(plain);
    c.sequence += 1;
    ch.writeEncrypted(encrypted);
    const m = await ch.read();
    const streamEncr = getChildMap(m, 'streamEncrypted');
    let cip = null;
    const raw = streamEncr['_0'];
    if (raw instanceof Uint8Array)
        cip = raw;
    else if (typeof raw === 'string') {
        const bin = atob(raw);
        cip = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++)
            cip[i] = bin.charCodeAt(i);
    }
    if (!cip)
        throw new Error('createUnlockKey: missing encrypted payload');
    const decrypted = chacha20poly1305(c.serverKey, new Uint8Array(c.nonce)).decrypt(cip);
    const res = JSON.parse(new TextDecoder().decode(decrypted));
    const hostKey = res && res.response && res.response._1 && res.response._1.createRemoteUnlockKey
        && res.response._1.createRemoteUnlockKey.hostKey;
    if (typeof hostKey !== 'string')
        throw new Error('createUnlockKey: missing hostKey');
    return hostKey;
}
//# sourceMappingURL=remotePair.js.map