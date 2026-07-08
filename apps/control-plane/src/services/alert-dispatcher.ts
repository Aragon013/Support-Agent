import type { AlertChannel, AlertEvent, AlertSeverity } from "../domain/alert-store.js";
import { InMemoryAlertStore } from "../domain/alert-store.js";

type DispatchInput = {
  category: AlertEvent["category"];
  severity: AlertSeverity;
  title: string;
  message: string;
  context?: Record<string, unknown>;
};

export class AlertDispatcher {
  constructor(private readonly store: InMemoryAlertStore) {}

  private async sendToChannel(channel: AlertChannel, payload: Record<string, unknown>): Promise<{ status: "sent" | "failed"; detail?: string }> {
    if (channel.type === "email") {
      // Placeholder until SMTP/provider integration is implemented.
      return { status: "sent", detail: "email_simulated" };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(channel.target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        return { status: "failed", detail: `http_${res.status}` };
      }
      return { status: "sent" };
    } catch (error) {
      return { status: "failed", detail: error instanceof Error ? error.message : "network_error" };
    }
  }

  async dispatch(input: DispatchInput): Promise<AlertEvent> {
    const channels = this.store.enabledChannels();
    const deliveries: AlertEvent["deliveries"] = [];

    const payload = {
      type: "secaudit_alert",
      category: input.category,
      severity: input.severity,
      title: input.title,
      message: input.message,
      context: input.context ?? {},
      sentAt: new Date().toISOString(),
    };

    for (const ch of channels) {
      const result = await this.sendToChannel(ch, payload);
      deliveries.push({
        channelId: ch.id,
        status: result.status,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
        sentAt: new Date().toISOString(),
      });
    }

    return this.store.addEvent({
      category: input.category,
      severity: input.severity,
      title: input.title,
      message: input.message,
      ...(input.context !== undefined ? { context: input.context } : {}),
      deliveries,
    });
  }
}
