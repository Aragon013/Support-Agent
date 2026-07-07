import { randomUUID } from "node:crypto";

export const SIGNAL_MESSAGE_TYPES = [
  "signal.offer",
  "signal.answer",
  "signal.ice-candidate",
  "control.input",
  "clipboard.sync",
  "screen.frame.stub",
  "screen.frame.data",
] as const;

export type SessionSignalMessageType = (typeof SIGNAL_MESSAGE_TYPES)[number];
export type SessionSignalSenderType = "controller" | "host";

export type SessionSignalMessage = {
  id: string;
  seq: number;
  sessionId: string;
  tenantId: string;
  senderType: SessionSignalSenderType;
  messageType: SessionSignalMessageType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type AppendSignalInput = {
  sessionId: string;
  tenantId: string;
  senderType: SessionSignalSenderType;
  messageType: SessionSignalMessageType;
  payload: Record<string, unknown>;
};

export class InMemorySessionSignalStore {
  private readonly bySession = new Map<string, SessionSignalMessage[]>();
  private seq = 0;

  append(input: AppendSignalInput): SessionSignalMessage {
    this.seq += 1;
    const msg: SessionSignalMessage = {
      id: randomUUID(),
      seq: this.seq,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      senderType: input.senderType,
      messageType: input.messageType,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };

    const list = this.bySession.get(input.sessionId);
    if (!list) {
      this.bySession.set(input.sessionId, [msg]);
    } else {
      list.push(msg);
    }

    return msg;
  }

  list(sessionId: string, afterSeq = 0): SessionSignalMessage[] {
    const list = this.bySession.get(sessionId) ?? [];
    return list.filter((x) => x.seq > afterSeq).sort((a, b) => a.seq - b.seq);
  }
}
