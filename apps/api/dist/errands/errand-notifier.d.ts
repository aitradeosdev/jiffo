import { type CountrySettings, type ErrandEvent } from '@jiffo/shared';
import { ChatService } from '../chat/chat.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { ErrandRow } from './errand-view';
export interface TransitionResult {
    before: ErrandRow;
    after: ErrandRow;
    event: ErrandEvent;
    record: Record<string, unknown>;
    settings: CountrySettings;
}
/** After an errand changes: updates open screens, opens and closes the chat, writes chat notes, sends pushes. */
export declare class ErrandNotifier {
    private readonly realtime;
    private readonly chat;
    private readonly push;
    private readonly logger;
    constructor(realtime: RealtimeGateway, chat: ChatService, push: PushService);
    transitioned(r: TransitionResult): Promise<void>;
    private run;
}
