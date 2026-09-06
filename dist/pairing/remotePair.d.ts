import { ControlChannel } from './channel';
import { SelfIdentity } from './record';
export interface RemotePairResult {
    udid: string;
    hostKey: string;
    selfIdentity: SelfIdentity;
}
export declare function setupNewPairingGetHostKey(connOrChannel: ControlChannel | {
    sendDict: Function;
    waitForDict: Function;
}, selfId: SelfIdentity, onStatus?: (msg: string) => void): Promise<string>;
//# sourceMappingURL=remotePair.d.ts.map