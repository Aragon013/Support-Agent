import type { AlertChannel, AlertEvent, AlertSeverity } from "../domain/alert-store.js";
import { InMemoryAlertStore } from "../domain/alert-store.js";

type DispatchInput = {
  category: AlertEvent["category"];
  severity: AlertSeverity;
  title: string;
  message: string;
  context?: Record<string, unknown>;
};

const TEAMS_COLOR: Record<AlertSeverity, string> = {
  info: "2B6CB0",
  warning: "B7791F",
  critical: "C53030",
};

export class AlertDispatcher {
  constructor(private readonly store: InMemoryAlertStore) {}

  private buildPayload(channel: AlertChannel, input: DispatchInput, sentAt: string): Record<string, unknown> {
    const context = input.context ?? {};
    const contextFacts = Object.entries(context).slice(0, 12).map(([k, v]) => ({
      name: k,
      value: typeof v === "string" ? v : JSON.stringify(v),
    }));

    if (channel.type === "slack") {
      const details = contextFacts.map((f) => `• *${f.name}:* ${f.value}`).join("\n");
      return {
        text: `[${input.severity.toUpperCase()}] ${input.title}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `[${input.severity.toUpperCase()}] ${input.title}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: input.message,
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Category*\n${input.category}` },
              { type: "mrkdwn", text: `*Sent At*\n${sentAt}` },
            ],
          },
          ...(details ? [{ type: "section", text: { type: "mrkdwn", text: `*Context*\n${details}` } }] : []),
        ],
      };
    }

    if (channel.type === "teams") {
      return {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        summary: input.title,
        themeColor: TEAMS_COLOR[input.severity],
        title: `[${input.severity.toUpperCase()}] ${input.title}`,
        text: input.message,
        sections: [
          {
            facts: [
              { name: "Category", value: input.category },
              { name: "Sent At", value: sentAt },
              ...contextFacts,
            ],
          },
        ],
      };
    }

    return {
      type: "secaudit_alert",
      category: input.category,
      severity: input.severity,
      title: input.title,
      message: input.message,
      context,
      sentAt,
    };
  }

  private async sendToChannel(channel: AlertChannel, input: DispatchInput, sentAt: string): Promise<{ status: "sent" | "failed"; detail?: string }> {
    if (channel.type === "email") {
      // Placeholder until SMTP/provider integration is implemented.
      return { status: "sent", detail: "email_simulated" };
    }

    const payload = this.buildPayload(channel, input, sentAt);

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
    const sentAt = new Date().toISOString();

    for (const ch of channels) {
      const result = await this.sendToChannel(ch, input, sentAt);
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
