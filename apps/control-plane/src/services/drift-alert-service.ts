/**
 * Drift Alert Service
 * Sends notifications to Slack, Teams, and Email when critical drifts occur
 */

import { DriftEvent, RiskScoreReport } from "../domain/secaudit-drift-store.js";

export interface SlackAlertConfig {
  enabled: boolean;
  webhookUrl: string;
  channel?: string;
  mentionOnCritical?: string[]; // user IDs to @mention
}

export interface TeamsAlertConfig {
  enabled: boolean;
  webhookUrl: string;
}

export interface EmailAlertConfig {
  enabled: boolean;
  smtpUrl: string;
  fromAddress: string;
  recipients: string[];
  recipientsOnCritical?: string[];
}

export interface DriftAlertConfig {
  slack?: SlackAlertConfig;
  teams?: TeamsAlertConfig;
  email?: EmailAlertConfig;
}

export interface AlertPayload {
  planId: string;
  tenantId: string;
  score: number;
  scoreChange: number;
  criticalDrifts: DriftEvent[];
  recommendations: string[];
  severity: "critical" | "high" | "medium" | "low";
  timestamp: string;
}

/**
 * Slack alert message builder
 */
function buildSlackAlert(payload: AlertPayload): object {
  const color =
    payload.severity === "critical"
      ? "#d11a2a"
      : payload.severity === "high"
        ? "#ff7f50"
        : "#ffb020";

  return {
    attachments: [
      {
        color,
        title: `🚨 SecAudit Risk Alert - ${payload.severity.toUpperCase()}`,
        fields: [
          {
            title: "Plan ID",
            value: payload.planId,
            short: true,
          },
          {
            title: "Current Score",
            value: `${payload.score}/100`,
            short: true,
          },
          {
            title: "Score Change",
            value: `${payload.scoreChange > 0 ? "↑" : "↓"} ${Math.abs(payload.scoreChange).toFixed(1)}`,
            short: true,
          },
          {
            title: "Critical Drifts",
            value: payload.criticalDrifts.length.toString(),
            short: true,
          },
          {
            title: "Affected Controls",
            value: payload.criticalDrifts.map((d) => `• ${d.controlId}`).join("\n") || "None",
            short: false,
          },
          {
            title: "Recommendations",
            value: payload.recommendations.map((r) => `• ${r}`).join("\n"),
            short: false,
          },
        ],
        ts: Math.floor(new Date(payload.timestamp).getTime() / 1000),
      },
    ],
  };
}

/**
 * Teams alert message builder (Adaptive Cards)
 */
function buildTeamsAlert(payload: AlertPayload): object {
  const accentColor =
    payload.severity === "critical"
      ? "attention"
      : payload.severity === "high"
        ? "warning"
        : "good";

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "Container",
              style: accentColor,
              items: [
                {
                  type: "TextBlock",
                  text: `🚨 SecAudit Risk Alert - ${payload.severity.toUpperCase()}`,
                  weight: "bolder",
                  size: "large",
                },
              ],
            },
            {
              type: "Container",
              items: [
                {
                  type: "FactSet",
                  facts: [
                    {
                      name: "Plan ID:",
                      value: payload.planId,
                    },
                    {
                      name: "Current Score:",
                      value: `${payload.score}/100`,
                    },
                    {
                      name: "Score Change:",
                      value: `${payload.scoreChange > 0 ? "↑" : "↓"} ${Math.abs(payload.scoreChange).toFixed(1)}`,
                    },
                    {
                      name: "Critical Drifts:",
                      value: payload.criticalDrifts.length.toString(),
                    },
                  ],
                },
              ],
            },
            {
              type: "Container",
              items: [
                {
                  type: "TextBlock",
                  text: "Affected Controls",
                  weight: "bolder",
                  size: "medium",
                },
                {
                  type: "TextBlock",
                  text: payload.criticalDrifts.map((d) => `• ${d.controlId}`).join("\n") || "None",
                  wrap: true,
                  spacing: "small",
                },
              ],
            },
            {
              type: "Container",
              items: [
                {
                  type: "TextBlock",
                  text: "Recommendations",
                  weight: "bolder",
                  size: "medium",
                },
                {
                  type: "TextBlock",
                  text: payload.recommendations.map((r) => `• ${r}`).join("\n"),
                  wrap: true,
                  spacing: "small",
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

/**
 * Email alert message builder
 */
function buildEmailAlert(
  payload: AlertPayload,
): { subject: string; htmlBody: string } {
  return {
    subject: `[${payload.severity.toUpperCase()}] SecAudit Risk Alert - Plan ${payload.planId}`,
    htmlBody: `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>🚨 SecAudit Risk Alert - ${payload.severity.toUpperCase()}</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background-color: #f5f5f5;">
            <td style="padding: 10px; font-weight: bold;">Plan ID</td>
            <td style="padding: 10px;">${payload.planId}</td>
          </tr>
          <tr>
            <td style="padding: 10px; font-weight: bold;">Current Score</td>
            <td style="padding: 10px;">${payload.score}/100</td>
          </tr>
          <tr style="background-color: #f5f5f5;">
            <td style="padding: 10px; font-weight: bold;">Score Change</td>
            <td style="padding: 10px;">${payload.scoreChange > 0 ? "↑" : "↓"} ${Math.abs(payload.scoreChange).toFixed(1)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; font-weight: bold;">Critical Drifts</td>
            <td style="padding: 10px;">${payload.criticalDrifts.length}</td>
          </tr>
        </table>

        <h3>Affected Controls</h3>
        <ul>
          ${payload.criticalDrifts.map((d) => `<li>${d.controlId}: ${d.previous.status} → ${d.current.status}</li>`).join("")}
        </ul>

        <h3>Recommendations</h3>
        <ul>
          ${payload.recommendations.map((r) => `<li>${r}</li>`).join("")}
        </ul>

        <p style="color: #999; font-size: 12px;">
          Timestamp: ${new Date(payload.timestamp).toISOString()}
        </p>
      </body>
    </html>
    `,
  };
}

/**
 * Drift Alert Service
 * Multi-channel alert dispatcher
 */
export class DriftAlertService {
  constructor(
    private config: DriftAlertConfig,
    private deps?: {
      httpClient?: { post: (url: string, data: object) => Promise<void> };
      emailClient?: undefined | { send: (to: string[], subject: string, html: string) => Promise<void> };
    },
  ) {}

  /**
   * Send alert to all configured channels
   */
  async sendAlert(payload: AlertPayload): Promise<void> {
    const errors: Array<{ channel: string; error: string }> = [];

    // Slack
    if (this.config.slack?.enabled) {
      try {
        await this.sendSlackAlert(payload);
      } catch (err) {
        errors.push({
          channel: "slack",
          error: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    // Teams
    if (this.config.teams?.enabled) {
      try {
        await this.sendTeamsAlert(payload);
      } catch (err) {
        errors.push({
          channel: "teams",
          error: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    // Email
    if (this.config.email?.enabled) {
      try {
        await this.sendEmailAlert(payload);
      } catch (err) {
        errors.push({
          channel: "email",
          error: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    if (errors.length > 0) {
      console.warn("drift_alert_errors:", errors);
    }
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(payload: AlertPayload): Promise<void> {
    if (!this.config.slack?.webhookUrl || !this.deps?.httpClient) {
      throw new Error("Slack webhook URL or HTTP client not configured");
    }

    const message = buildSlackAlert(payload);
    await this.deps.httpClient.post(this.config.slack.webhookUrl, message);
  }

  /**
   * Send Teams alert
   */
  private async sendTeamsAlert(payload: AlertPayload): Promise<void> {
    if (!this.config.teams?.webhookUrl || !this.deps?.httpClient) {
      throw new Error("Teams webhook URL or HTTP client not configured");
    }

    const message = buildTeamsAlert(payload);
    await this.deps.httpClient.post(this.config.teams.webhookUrl, message);
  }

  /**
   * Send Email alert
   */
  private async sendEmailAlert(payload: AlertPayload): Promise<void> {
    if (!this.config.email?.smtpUrl || !this.deps?.emailClient) {
      throw new Error("Email config or email client not configured");
    }

    const { subject, htmlBody } = buildEmailAlert(payload);

    // Determine recipients
    const recipients =
      payload.severity === "critical" && this.config.email.recipientsOnCritical
        ? this.config.email.recipientsOnCritical
        : this.config.email.recipients;

    if (!recipients.length) {
      throw new Error("No email recipients configured");
    }

    await this.deps.emailClient.send(recipients, subject, htmlBody);
  }

  /**
   * Severity level for a given score
   */
  static severityForScore(score: number): "critical" | "high" | "medium" | "low" {
    if (score >= 75) return "critical";
    if (score >= 60) return "high";
    if (score >= 40) return "medium";
    return "low";
  }
}
