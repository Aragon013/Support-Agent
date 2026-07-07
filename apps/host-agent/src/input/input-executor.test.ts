import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ValidatedPayload } from "./input-executor.js";
import {
  validateInputPayload,
  isCoordinateInBounds,
  ALLOWED_ACTIONS,
  handleRemoteInput,
} from "./input-executor.js";

describe("Input Executor", () => {
  describe("validateInputPayload", () => {
    it("rejects null or non-object payloads", () => {
      expect(validateInputPayload(null)).toBeNull();
      expect(validateInputPayload(undefined)).toBeNull();
      expect(validateInputPayload("string")).toBeNull();
      expect(validateInputPayload(123)).toBeNull();
    });

    it("rejects payloads without action", () => {
      expect(validateInputPayload({})).toBeNull();
      expect(validateInputPayload({ x: 10, y: 20 })).toBeNull();
    });

    it("rejects payloads with non-string action", () => {
      expect(validateInputPayload({ action: 123 })).toBeNull();
      expect(validateInputPayload({ action: null })).toBeNull();
    });

    it("rejects payloads with empty string action", () => {
      expect(validateInputPayload({ action: "" })).toBeNull();
      expect(validateInputPayload({ action: "   " })).toBeNull();
    });

    it("rejects actions not in whitelist", () => {
      expect(validateInputPayload({ action: "keyboard.type" })).toBeNull();
      expect(validateInputPayload({ action: "system.reboot" })).toBeNull();
      expect(validateInputPayload({ action: "rm -rf /" })).toBeNull();
    });

    describe("mouse.move validation", () => {
      it("accepts valid mouse.move payload", () => {
        const result = validateInputPayload({
          action: "mouse.move",
          x: 100,
          y: 200,
        });
        expect(result).not.toBeNull();
        expect(result?.action).toBe("mouse.move");
      });

      it("rejects mouse.move without x or y", () => {
        expect(validateInputPayload({ action: "mouse.move", x: 100 })).toBeNull();
        expect(validateInputPayload({ action: "mouse.move", y: 200 })).toBeNull();
      });

      it("rejects mouse.move with non-numeric coordinates", () => {
        expect(validateInputPayload({ action: "mouse.move", x: "100", y: 200 })).toBeNull();
        expect(validateInputPayload({ action: "mouse.move", x: 100, y: "200" })).toBeNull();
      });

      it("accepts negative coordinates (handled by bounds check separately)", () => {
        const result = validateInputPayload({
          action: "mouse.move",
          x: -10,
          y: -20,
        });
        expect(result).not.toBeNull();
      });
    });

    describe("mouse.click validation", () => {
      it("accepts valid mouse.click payload with all parameters", () => {
        const result = validateInputPayload({
          action: "mouse.click",
          button: "left",
          x: 100,
          y: 200,
        });
        expect(result).not.toBeNull();
        expect(result?.action).toBe("mouse.click");
      });

      it("accepts mouse.click with only action (button defaults to left)", () => {
        const result = validateInputPayload({ action: "mouse.click" });
        expect(result).not.toBeNull();
      });

      it("accepts mouse.click with valid button values", () => {
        expect(validateInputPayload({ action: "mouse.click", button: "left" })).not.toBeNull();
        expect(validateInputPayload({ action: "mouse.click", button: "right" })).not.toBeNull();
        expect(validateInputPayload({ action: "mouse.click", button: "middle" })).not.toBeNull();
      });

      it("rejects mouse.click with invalid button", () => {
        expect(validateInputPayload({ action: "mouse.click", button: "double" })).toBeNull();
        expect(validateInputPayload({ action: "mouse.click", button: "scroll" })).toBeNull();
      });
    });

    describe("mouse.scroll validation", () => {
      it("accepts valid mouse.scroll payload", () => {
        const result = validateInputPayload({
          action: "mouse.scroll",
          direction: "up",
          amount: 3,
        });
        expect(result).not.toBeNull();
        expect(result?.action).toBe("mouse.scroll");
      });

      it("rejects mouse.scroll without direction", () => {
        expect(validateInputPayload({ action: "mouse.scroll", amount: 3 })).toBeNull();
      });

      it("rejects mouse.scroll with invalid direction", () => {
        expect(validateInputPayload({ action: "mouse.scroll", direction: "diagonal" })).toBeNull();
      });

      it("accepts mouse.scroll with all valid directions", () => {
        expect(
          validateInputPayload({ action: "mouse.scroll", direction: "up" }),
        ).not.toBeNull();
        expect(
          validateInputPayload({ action: "mouse.scroll", direction: "down" }),
        ).not.toBeNull();
        expect(
          validateInputPayload({ action: "mouse.scroll", direction: "left" }),
        ).not.toBeNull();
        expect(
          validateInputPayload({ action: "mouse.scroll", direction: "right" }),
        ).not.toBeNull();
      });
    });

    describe("keyboard.press validation", () => {
      it("accepts valid keyboard.press payload", () => {
        const result = validateInputPayload({
          action: "keyboard.press",
          key: "a",
        });
        expect(result).not.toBeNull();
        expect(result?.action).toBe("keyboard.press");
      });

      it("rejects keyboard.press without key", () => {
        expect(validateInputPayload({ action: "keyboard.press" })).toBeNull();
      });

      it("rejects keyboard.press with non-string key", () => {
        expect(validateInputPayload({ action: "keyboard.press", key: 123 })).toBeNull();
      });

      it("rejects keyboard.press with empty key", () => {
        expect(validateInputPayload({ action: "keyboard.press", key: "" })).toBeNull();
      });

      it("accepts keyboard.press with special keys", () => {
        expect(
          validateInputPayload({ action: "keyboard.press", key: "enter" }),
        ).not.toBeNull();
        expect(
          validateInputPayload({ action: "keyboard.press", key: "escape" }),
        ).not.toBeNull();
      });
    });

    describe("keyboard.hotkey validation", () => {
      it("accepts valid keyboard.hotkey payload", () => {
        const result = validateInputPayload({
          action: "keyboard.hotkey",
          keys: ["ctrl", "c"],
        });
        expect(result).not.toBeNull();
        expect(result?.action).toBe("keyboard.hotkey");
      });

      it("rejects keyboard.hotkey without keys", () => {
        expect(validateInputPayload({ action: "keyboard.hotkey" })).toBeNull();
      });

      it("rejects keyboard.hotkey with non-array keys", () => {
        expect(validateInputPayload({ action: "keyboard.hotkey", keys: "ctrl+c" })).toBeNull();
      });

      it("rejects keyboard.hotkey with empty array", () => {
        expect(validateInputPayload({ action: "keyboard.hotkey", keys: [] })).toBeNull();
      });

      it("rejects keyboard.hotkey with non-string keys", () => {
        expect(
          validateInputPayload({ action: "keyboard.hotkey", keys: ["ctrl", 123] }),
        ).toBeNull();
      });

      it("rejects keyboard.hotkey with empty string keys", () => {
        expect(
          validateInputPayload({ action: "keyboard.hotkey", keys: ["ctrl", ""] }),
        ).toBeNull();
      });

      it("accepts keyboard.hotkey with multiple keys", () => {
        const result = validateInputPayload({
          action: "keyboard.hotkey",
          keys: ["ctrl", "alt", "delete"],
        });
        expect(result).not.toBeNull();
      });
    });
  });

  describe("isCoordinateInBounds", () => {
    it("accepts coordinates within bounds", () => {
      expect(isCoordinateInBounds(0, 0)).toBe(true);
      expect(isCoordinateInBounds(960, 540)).toBe(true);
      expect(isCoordinateInBounds(1920, 1080)).toBe(true);
    });

    it("rejects coordinates outside bounds", () => {
      expect(isCoordinateInBounds(-1, 0)).toBe(false);
      expect(isCoordinateInBounds(0, -1)).toBe(false);
      expect(isCoordinateInBounds(1921, 1080)).toBe(false);
      expect(isCoordinateInBounds(1920, 1081)).toBe(false);
    });

    it("rejects far out of bounds coordinates", () => {
      expect(isCoordinateInBounds(-100, -100)).toBe(false);
      expect(isCoordinateInBounds(5000, 5000)).toBe(false);
    });
  });

  describe("ALLOWED_ACTIONS whitelist", () => {
    it("contains exactly the intended actions", () => {
      const expected = [
        "mouse.move",
        "mouse.click",
        "mouse.doubleClick",
        "mouse.scroll",
        "keyboard.press",
        "keyboard.hotkey",
      ];
      expect(ALLOWED_ACTIONS.size).toBe(expected.length);
      for (const action of expected) {
        expect(ALLOWED_ACTIONS.has(action as any)).toBe(true);
      }
    });

    it("does NOT include keyboard.type", () => {
      expect(ALLOWED_ACTIONS.has("keyboard.type" as any)).toBe(false);
    });

    it("does NOT include any system commands", () => {
      const forbidden = [
        "system.reboot",
        "system.shutdown",
        "file.delete",
        "registry.modify",
      ];
      for (const action of forbidden) {
        expect(ALLOWED_ACTIONS.has(action as any)).toBe(false);
      }
    });
  });

  describe("handleRemoteInput", () => {
    it("returns success=false for invalid payload", async () => {
      const result = await handleRemoteInput({ action: "keyboard.type", text: "hack" });
      expect(result.success).toBe(false);
      expect((result as any).error).toBe("invalid_payload");
    });

    it("returns success=false for null payload", async () => {
      const result = await handleRemoteInput(null);
      expect(result.success).toBe(false);
    });

    it("returns success=false for unknown action", async () => {
      const result = await handleRemoteInput({ action: "unknown.action" });
      expect(result.success).toBe(false);
      expect((result as any).error).toBe("invalid_payload");
    });

    // Note: actual execution tests would require mocking robotjs
    // which may not be available in the test environment
  });
});
