import { describe, it, expect } from "vitest";
import { validateScreenFramePayload, describeFrame } from "./screen-frame.types.js";
import type { ScreenFrameDataPayload } from "./screen-frame.types.js";

describe("Screen Frame Types", () => {
  describe("validateScreenFramePayload", () => {
    const validPayload: ScreenFrameDataPayload = {
      frameData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      frameId: 1,
      capturedAt: Date.now(),
      width: 1920,
      height: 1080,
      encodingQuality: 70,
      encodingFormat: "jpeg",
      captureDurationMs: 10,
      encodeDurationMs: 20,
    };

    it("accepts valid payload", () => {
      expect(validateScreenFramePayload(validPayload)).toBe(true);
    });

    it("rejects null or non-object", () => {
      expect(validateScreenFramePayload(null)).toBe(false);
      expect(validateScreenFramePayload(undefined)).toBe(false);
      expect(validateScreenFramePayload("string")).toBe(false);
    });

    it("rejects missing required fields", () => {
      const missing = { ...validPayload };
      delete (missing as any).frameData;
      expect(validateScreenFramePayload(missing)).toBe(false);
    });

    it("rejects invalid field types", () => {
      expect(validateScreenFramePayload({ ...validPayload, frameId: "1" })).toBe(false);
      expect(validateScreenFramePayload({ ...validPayload, width: "1920" })).toBe(false);
    });

    it("rejects invalid dimensions", () => {
      expect(validateScreenFramePayload({ ...validPayload, width: 0 })).toBe(false);
      expect(validateScreenFramePayload({ ...validPayload, height: -1 })).toBe(false);
    });

    it("rejects negative timings", () => {
      expect(validateScreenFramePayload({ ...validPayload, captureDurationMs: -1 })).toBe(false);
    });

    it("rejects invalid encoding format", () => {
      expect(validateScreenFramePayload({ ...validPayload, encodingFormat: "h264" as any })).toBe(
        false,
      );
    });

    it("rejects invalid base64", () => {
      expect(validateScreenFramePayload({ ...validPayload, frameData: "!!invalid!!" })).toBe(false);
    });
  });

  describe("describeFrame", () => {
    it("produces readable description", () => {
      const payload: ScreenFrameDataPayload = {
        frameData: "A".repeat(1024 * 100), // ~100KB
        frameId: 42,
        capturedAt: Date.now(),
        width: 1920,
        height: 1080,
        encodingQuality: 70,
        encodingFormat: "jpeg",
        captureDurationMs: 15,
        encodeDurationMs: 25,
      };

      const desc = describeFrame(payload);
      expect(desc).toContain("Frame #42");
      expect(desc).toContain("1920x1080");
      expect(desc).toContain("Q70");
      expect(desc).toContain("40ms"); // 15 + 25
    });
  });
});
