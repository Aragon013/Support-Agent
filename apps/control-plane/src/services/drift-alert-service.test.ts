import { describe, it, expect, beforeEach, vi } from "vitest";
import { DriftAlertService, AlertPayload } from "./drift-alert-service.js";
import { DriftEvent } from "../domain/secaudit-drift-store.js";

describe("DriftAlertService", () => {
  let mockHttpClient: any;
  let mockEmailClient: any;
  let service: DriftAlertService;

  const mockDrift: DriftEvent = {
    id: "drift-1",
    planId: "plan-1",
    tenantId: "tenant-1",
    controlId: "control-1",
    moduleId: "module-1",
    changeType: "status_changed",
    severity: "critical",
    previous: {
      status: "passed",
      timestamp: new Date().toISOString(),
    },
    current: {
      status: "failed",
      timestamp: new Date().toISOString(),
    },
    detectedAt: new Date().toISOString(),
  };

  const mockPayload: AlertPayload = {
    planId: "plan-1",
    tenantId: "tenant-1",
    score: 78,
    scoreChange: 15,
    criticalDrifts: [mockDrift],
    recommendations: ["URGENT: Risk score critical.", "1 control(s) have degraded."],
    severity: "critical",
    timestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    mockHttpClient = {
      post: vi.fn(),
    };
    mockEmailClient = {
      send: vi.fn(),
    };
  });

  describe("Slack alerts", () => {
    it("should send Slack alert when enabled", async () => {
      service = new DriftAlertService(
        {
          slack: {
            enabled: true,
            webhookUrl: "https://hooks.slack.com/services/test",
          },
        },
        { httpClient: mockHttpClient },
      );

      await service.sendAlert(mockPayload);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/test",
        expect.objectContaining({
          attachments: expect.any(Array),
        }),
      );
    });

    it("should include critical drifts in Slack message", async () => {
      service = new DriftAlertService(
        {
          slack: {
            enabled: true,
            webhookUrl: "https://hooks.slack.com/services/test",
          },
        },
        { httpClient: mockHttpClient },
      );

      await service.sendAlert(mockPayload);

      const call = mockHttpClient.post.mock.calls[0];
      const message = call[1] as object;
      const messageStr = JSON.stringify(message);

      expect(messageStr).toContain("control-1");
      expect(messageStr).toContain("CRITICAL");
    });

    it("should skip Slack if not enabled", async () => {
      service = new DriftAlertService(
        {
          slack: { enabled: false, webhookUrl: "" },
        },
        { httpClient: mockHttpClient },
      );

      await service.sendAlert(mockPayload);

      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });

    it("should handle missing Slack webhook gracefully (no throw)", async () => {
      service = new DriftAlertService(
        {
          slack: {
            enabled: true,
            webhookUrl: "",
          },
        },
        { httpClient: mockHttpClient },
      );

      // Should not throw, but should log error
      await service.sendAlert(mockPayload);

      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });
  });

  describe("Teams alerts", () => {
    it("should send Teams alert when enabled", async () => {
      service = new DriftAlertService(
        {
          teams: {
            enabled: true,
            webhookUrl: "https://outlook.webhook.office.com/webhookb2/test",
          },
        },
        { httpClient: mockHttpClient },
      );

      await service.sendAlert(mockPayload);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "https://outlook.webhook.office.com/webhookb2/test",
        expect.objectContaining({
          type: "message",
          attachments: expect.any(Array),
        }),
      );
    });

    it("should format Teams Adaptive Card", async () => {
      service = new DriftAlertService(
        {
          teams: {
            enabled: true,
            webhookUrl: "https://outlook.webhook.office.com/webhookb2/test",
          },
        },
        { httpClient: mockHttpClient },
      );

      await service.sendAlert(mockPayload);

      const call = mockHttpClient.post.mock.calls[0];
      const message = call[1] as object;
      const messageStr = JSON.stringify(message);

      expect(messageStr).toContain("AdaptiveCard");
      expect(messageStr).toContain("plan-1");
    });

    it("should skip Teams if not enabled", async () => {
      service = new DriftAlertService(
        {
          teams: { enabled: false, webhookUrl: "" },
        },
        { httpClient: mockHttpClient },
      );

      await service.sendAlert(mockPayload);

      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });
  });

  describe("Email alerts", () => {
    it("should send email alert when enabled", async () => {
      service = new DriftAlertService(
        {
          email: {
            enabled: true,
            smtpUrl: "smtp://mail.example.com:587",
            fromAddress: "alerts@example.com",
            recipients: ["security-team@example.com"],
          },
        },
        { emailClient: mockEmailClient },
      );

      await service.sendAlert(mockPayload);

      expect(mockEmailClient.send).toHaveBeenCalledWith(
        ["security-team@example.com"],
        expect.stringContaining("[CRITICAL]"),
        expect.stringContaining("plan-1"),
      );
    });

    it("should use critical recipients when severity is critical", async () => {
      service = new DriftAlertService(
        {
          email: {
            enabled: true,
            smtpUrl: "smtp://mail.example.com:587",
            fromAddress: "alerts@example.com",
            recipients: ["default@example.com"],
            recipientsOnCritical: ["critical-team@example.com"],
          },
        },
        { emailClient: mockEmailClient },
      );

      await service.sendAlert(mockPayload);

      const call = mockEmailClient.send.mock.calls[0];
      const recipients = call[0] as string[];

      expect(recipients).toEqual(["critical-team@example.com"]);
    });

    it("should use default recipients for non-critical severity", async () => {
      const lowPayload = { ...mockPayload, severity: "low" as const };

      service = new DriftAlertService(
        {
          email: {
            enabled: true,
            smtpUrl: "smtp://mail.example.com:587",
            fromAddress: "alerts@example.com",
            recipients: ["default@example.com"],
            recipientsOnCritical: ["critical-team@example.com"],
          },
        },
        { emailClient: mockEmailClient },
      );

      await service.sendAlert(lowPayload);

      const call = mockEmailClient.send.mock.calls[0];
      const recipients = call[0] as string[];

      expect(recipients).toEqual(["default@example.com"]);
    });

    it("should skip email if not enabled", async () => {
      service = new DriftAlertService(
        {
          email: {
            enabled: false,
            smtpUrl: "",
            fromAddress: "",
            recipients: [],
          },
        },
        { emailClient: mockEmailClient },
      );

      await service.sendAlert(mockPayload);

      expect(mockEmailClient.send).not.toHaveBeenCalled();
    });

    it("should include control details in email", async () => {
      service = new DriftAlertService(
        {
          email: {
            enabled: true,
            smtpUrl: "smtp://mail.example.com:587",
            fromAddress: "alerts@example.com",
            recipients: ["security-team@example.com"],
          },
        },
        { emailClient: mockEmailClient },
      );

      await service.sendAlert(mockPayload);

      const call = mockEmailClient.send.mock.calls[0];
      const htmlBody = call[2] as string;

      expect(htmlBody).toContain("control-1");
      expect(htmlBody).toContain("passed");
      expect(htmlBody).toContain("failed");
    });
  });

  describe("Multi-channel alerts", () => {
    it("should send to all enabled channels", async () => {
      service = new DriftAlertService(
        {
          slack: {
            enabled: true,
            webhookUrl: "https://hooks.slack.com/services/test",
          },
          teams: {
            enabled: true,
            webhookUrl: "https://outlook.webhook.office.com/webhookb2/test",
          },
          email: {
            enabled: true,
            smtpUrl: "smtp://mail.example.com:587",
            fromAddress: "alerts@example.com",
            recipients: ["security-team@example.com"],
          },
        },
        { httpClient: mockHttpClient, emailClient: mockEmailClient },
      );

      await service.sendAlert(mockPayload);

      expect(mockHttpClient.post).toHaveBeenCalledTimes(2); // Slack + Teams
      expect(mockEmailClient.send).toHaveBeenCalledTimes(1);
    });

    it("should continue if one channel fails", async () => {
      mockHttpClient.post = vi.fn().mockRejectedValueOnce(new Error("Slack down"));

      service = new DriftAlertService(
        {
          slack: {
            enabled: true,
            webhookUrl: "https://hooks.slack.com/services/test",
          },
          email: {
            enabled: true,
            smtpUrl: "smtp://mail.example.com:587",
            fromAddress: "alerts@example.com",
            recipients: ["security-team@example.com"],
          },
        },
        { httpClient: mockHttpClient, emailClient: mockEmailClient },
      );

      // Should not throw
      await service.sendAlert(mockPayload);

      // Email should still be sent
      expect(mockEmailClient.send).toHaveBeenCalled();
    });
  });

  describe("Severity classification", () => {
    it("should classify score 75+ as critical", () => {
      expect(DriftAlertService.severityForScore(75)).toBe("critical");
      expect(DriftAlertService.severityForScore(100)).toBe("critical");
    });

    it("should classify score 60-74 as high", () => {
      expect(DriftAlertService.severityForScore(60)).toBe("high");
      expect(DriftAlertService.severityForScore(74)).toBe("high");
    });

    it("should classify score 40-59 as medium", () => {
      expect(DriftAlertService.severityForScore(40)).toBe("medium");
      expect(DriftAlertService.severityForScore(59)).toBe("medium");
    });

    it("should classify score <40 as low", () => {
      expect(DriftAlertService.severityForScore(0)).toBe("low");
      expect(DriftAlertService.severityForScore(39)).toBe("low");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty critical drifts list", async () => {
      const payloadNoDrifts = { ...mockPayload, criticalDrifts: [] };

      service = new DriftAlertService(
        {
          slack: {
            enabled: true,
            webhookUrl: "https://hooks.slack.com/services/test",
          },
        },
        { httpClient: mockHttpClient },
      );

      await service.sendAlert(payloadNoDrifts);

      expect(mockHttpClient.post).toHaveBeenCalled();
    });

    it("should handle empty recommendations list", async () => {
      const payloadNoRecs = { ...mockPayload, recommendations: [] };

      service = new DriftAlertService(
        {
          email: {
            enabled: true,
            smtpUrl: "smtp://mail.example.com:587",
            fromAddress: "alerts@example.com",
            recipients: ["security-team@example.com"],
          },
        },
        { emailClient: mockEmailClient },
      );

      await service.sendAlert(payloadNoRecs);

      expect(mockEmailClient.send).toHaveBeenCalled();
    });

    it("should handle no email recipients gracefully (no throw)", async () => {
      service = new DriftAlertService(
        {
          email: {
            enabled: true,
            smtpUrl: "smtp://mail.example.com:587",
            fromAddress: "alerts@example.com",
            recipients: [],
          },
        },
        { emailClient: mockEmailClient },
      );

      // Should not throw, but should log error
      await service.sendAlert(mockPayload);

      expect(mockEmailClient.send).not.toHaveBeenCalled();
    });

    it("should handle high severity alert formatting", async () => {
      const highPayload = { ...mockPayload, severity: "high" as const, score: 65 };

      service = new DriftAlertService(
        {
          teams: {
            enabled: true,
            webhookUrl: "https://outlook.webhook.office.com/webhookb2/test",
          },
        },
        { httpClient: mockHttpClient },
      );

      await service.sendAlert(highPayload);

      const call = mockHttpClient.post.mock.calls[0];
      const messageStr = JSON.stringify(call[1]);

      expect(messageStr).toContain("warning");
    });
  });
});
