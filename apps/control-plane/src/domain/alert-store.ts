import { randomUUID } from "node:crypto";

export type AlertChannelType = "slack" | "teams" | "webhook" | "email";

export type AlertChannel = {
  id: string;
  name: string;
  type: AlertChannelType;
  target: string;
  auth?: {
    headerName: string;
    token: string;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertEvent = {
  id: string;
  category: "drift" | "test" | "system";
  severity: AlertSeverity;
  title: string;
  message: string;
  context?: Record<string, unknown>;
  createdAt: string;
  deliveries: Array<{
    channelId: string;
    status: "sent" | "failed";
    detail?: string;
    sentAt: string;
  }>;
};

type CreateChannelInput = {
  name: string;
  type: AlertChannelType;
  target: string;
  auth?: {
    headerName: string;
    token: string;
  };
  enabled?: boolean;
};

export class InMemoryAlertStore {
  private readonly channels = new Map<string, AlertChannel>();
  private readonly events: AlertEvent[] = [];

  createChannel(input: CreateChannelInput): AlertChannel {
    const now = new Date().toISOString();
    const channel: AlertChannel = {
      id: `alert_ch_${randomUUID()}`,
      name: input.name,
      type: input.type,
      target: input.target,
      ...(input.auth !== undefined ? { auth: input.auth } : {}),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.channels.set(channel.id, channel);
    return channel;
  }

  listChannels(): AlertChannel[] {
    return Array.from(this.channels.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getChannelById(id: string): AlertChannel | undefined {
    return this.channels.get(id);
  }

  updateChannel(
    id: string,
    patch: {
      name?: string;
      target?: string;
      enabled?: boolean;
      auth?: {
        headerName: string;
        token: string;
      } | null;
    },
  ): AlertChannel | undefined {
    const found = this.channels.get(id);
    if (!found) return undefined;
    const base: AlertChannel = {
      ...found,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.target !== undefined ? { target: patch.target } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      updatedAt: new Date().toISOString(),
    };
    const next: AlertChannel = patch.auth === null
      ? (() => {
        const { auth: _auth, ...rest } = base;
        return rest;
      })()
      : patch.auth !== undefined
        ? { ...base, auth: patch.auth }
        : base;
    this.channels.set(id, next);
    return next;
  }

  enabledChannels(): AlertChannel[] {
    return this.listChannels().filter((c) => c.enabled);
  }

  addEvent(event: Omit<AlertEvent, "id" | "createdAt">): AlertEvent {
    const full: AlertEvent = {
      id: `alert_evt_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      ...event,
    };
    this.events.unshift(full);
    if (this.events.length > 200) this.events.length = 200;
    return full;
  }

  listEvents(): AlertEvent[] {
    return [...this.events];
  }
}
