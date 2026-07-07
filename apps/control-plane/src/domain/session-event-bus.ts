import type { SessionRecord, } from "./session-store.js";

export type SessionEvent = {
  id: string;
  seq: number;
  name: string;
  sessionId: string;
  tenantId: string;
  endpointId: string;
  operatorId: string;
  status: string;
  createdAt: string;
  details?: Record<string, unknown>;
};

export class InMemorySessionEventBus {
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private seq = 0;

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(name: string, session: SessionRecord, details?: Record<string, unknown>): SessionEvent {
    this.seq += 1;
    const event: SessionEvent = {
      id: `${session.id}:${this.seq}`,
      seq: this.seq,
      name,
      sessionId: session.id,
      tenantId: session.tenantId,
      endpointId: session.endpointId,
      operatorId: session.operatorId,
      status: session.status,
      createdAt: new Date().toISOString(),
      ...(details ? { details } : {}),
    };

    for (const listener of this.listeners) {
      listener(event);
    }

    return event;
  }
}
