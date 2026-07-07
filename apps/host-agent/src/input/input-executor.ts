/**
 * Input Executor: Handles safe execution of remote input actions (mouse, keyboard)
 * with strict whitelist enforcement and platform abstraction.
 */

export type InputActionType =
  | "mouse.move"
  | "mouse.click"
  | "mouse.doubleClick"
  | "mouse.scroll"
  | "keyboard.press"
  | "keyboard.type"
  | "keyboard.hotkey";

export type InputExecutionError =
  | "invalid_action"
  | "invalid_payload"
  | "out_of_bounds"
  | "execution_failed"
  | "platform_error";

/**
 * Whitelist of allowed input actions.
 * This is intentionally strict to prevent abuse (e.g., keylogging, malware).
 */
export const ALLOWED_ACTIONS: Set<InputActionType> = new Set([
  "mouse.move",
  "mouse.click",
  "mouse.doubleClick",
  "mouse.scroll",
  "keyboard.press",
  "keyboard.hotkey",
  // "keyboard.type" intentionally omitted - typing is higher risk
] as const);

export interface InputPayload {
  action: string;
  [key: string]: unknown;
}

export interface MouseMovePayload extends InputPayload {
  action: "mouse.move";
  x: number;
  y: number;
}

export interface MouseClickPayload extends InputPayload {
  action: "mouse.click";
  button?: "left" | "right" | "middle";
  x?: number;
  y?: number;
}

export interface MouseDoubleClickPayload extends InputPayload {
  action: "mouse.doubleClick";
  button?: "left" | "right" | "middle";
  x?: number;
  y?: number;
}

export interface MouseScrollPayload extends InputPayload {
  action: "mouse.scroll";
  x?: number;
  y?: number;
  direction: "up" | "down" | "left" | "right";
  amount?: number;
}

export interface KeyboardPressPayload extends InputPayload {
  action: "keyboard.press";
  key: string;
}

export interface KeyboardHotkeyPayload extends InputPayload {
  action: "keyboard.hotkey";
  keys: string[];
}

export type ValidatedPayload =
  | MouseMovePayload
  | MouseClickPayload
  | MouseDoubleClickPayload
  | MouseScrollPayload
  | KeyboardPressPayload
  | KeyboardHotkeyPayload;

/**
 * Validates that an input payload is properly formed and permitted.
 */
export function validateInputPayload(payload: unknown): ValidatedPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const obj = payload as Record<string, unknown>;

  const action = obj.action;
  if (typeof action !== "string" || action.trim().length === 0) {
    return null;
  }

  if (!ALLOWED_ACTIONS.has(action as InputActionType)) {
    return null;
  }

  // Type-specific validation
  if (action === "mouse.move") {
    if (typeof obj.x !== "number" || typeof obj.y !== "number") {
      return null;
    }
    return obj as MouseMovePayload;
  }

  if (action === "mouse.click" || action === "mouse.doubleClick") {
    const button = obj.button ?? "left";
    if (!["left", "right", "middle"].includes(button as string)) {
      return null;
    }
    return obj as MouseClickPayload | MouseDoubleClickPayload;
  }

  if (action === "mouse.scroll") {
    const direction = obj.direction;
    if (!["up", "down", "left", "right"].includes(direction as string)) {
      return null;
    }
    return obj as MouseScrollPayload;
  }

  if (action === "keyboard.press") {
    if (typeof obj.key !== "string" || obj.key.trim().length === 0) {
      return null;
    }
    return obj as KeyboardPressPayload;
  }

  if (action === "keyboard.hotkey") {
    if (!Array.isArray(obj.keys) || obj.keys.length === 0) {
      return null;
    }
    if (!obj.keys.every((k) => typeof k === "string" && k.trim().length > 0)) {
      return null;
    }
    return obj as KeyboardHotkeyPayload;
  }

  return null;
}

/**
 * Get screen dimensions (platform-specific).
 * Needed for bounds checking.
 */
export function getScreenDimensions(): {
  width: number;
  height: number;
} {
  // This will be implemented based on platform in a real scenario
  // For now, return common desktop resolution as fallback
  if (typeof window !== "undefined" && window.screen) {
    return {
      width: window.screen.width,
      height: window.screen.height,
    };
  }

  // Node.js environment: try to get from display server (platform-specific)
  // Windows: GetSystemMetrics(0) / (1) via native module
  // Linux: xdpyinfo or DISPLAY env var parsing
  // macOS: NSScreen primary screen size

  // Fallback for headless/server environments
  return {
    width: 1920,
    height: 1080,
  };
}

/**
 * Checks if coordinates are within screen bounds (with margin for safety).
 */
export function isCoordinateInBounds(x: number, y: number): boolean {
  const dims = getScreenDimensions();
  const margin = 0;
  return x >= margin && x <= dims.width - margin && y >= margin && y <= dims.height - margin;
}

/**
 * Executes a validated input action on the local system.
 * This is the main entry point for executing remote input.
 *
 * Platform-specific: Uses RobotJS library for cross-platform support.
 * - Windows: native mouse/keyboard via win32 APIs
 * - macOS: native mouse/keyboard via objc bindings
 * - Linux: native mouse/keyboard via X11 or Wayland
 */
export async function executeInput(payload: ValidatedPayload): Promise<void> {
  // Dynamic import of robotjs to avoid hard dependency at module load time
  let robot: typeof import("robotjs");
  try {
    robot = await import("robotjs");
  } catch {
    throw new Error("platform_error: robotjs not available");
  }

  const action = payload.action;

  try {
    if (action === "mouse.move") {
      const p = payload as MouseMovePayload;
      if (!isCoordinateInBounds(p.x, p.y)) {
        throw new Error("out_of_bounds");
      }
      robot.moveMouse(p.x, p.y);
      return;
    }

    if (action === "mouse.click") {
      const p = payload as MouseClickPayload;
      const button = p.button ?? "left";

      if (p.x !== undefined && p.y !== undefined) {
        if (!isCoordinateInBounds(p.x, p.y)) {
          throw new Error("out_of_bounds");
        }
        robot.moveMouse(p.x, p.y);
      }

      // robotjs click() expects button: 'left' | 'right' | 'middle'
      robot.click(button);
      return;
    }

    if (action === "mouse.doubleClick") {
      const p = payload as MouseDoubleClickPayload;
      const button = p.button ?? "left";

      if (p.x !== undefined && p.y !== undefined) {
        if (!isCoordinateInBounds(p.x, p.y)) {
          throw new Error("out_of_bounds");
        }
        robot.moveMouse(p.x, p.y);
      }

      robot.click(button);
      robot.click(button);
      return;
    }

    if (action === "mouse.scroll") {
      const p = payload as MouseScrollPayload;
      const amount = p.amount ?? 3;

      if (p.x !== undefined && p.y !== undefined) {
        if (!isCoordinateInBounds(p.x, p.y)) {
          throw new Error("out_of_bounds");
        }
        robot.moveMouse(p.x, p.y);
      }

      // robotjs scroll() does not natively support all directions uniformly
      // We use keyboard wheel events instead for cross-platform reliability
      if (p.direction === "up") {
        robot.scroll(0, amount);
      } else if (p.direction === "down") {
        robot.scroll(0, -amount);
      } else if (p.direction === "left") {
        robot.scroll(amount, 0);
      } else if (p.direction === "right") {
        robot.scroll(-amount, 0);
      }
      return;
    }

    if (action === "keyboard.press") {
      const p = payload as KeyboardPressPayload;
      robot.keyTap(p.key);
      return;
    }

    if (action === "keyboard.hotkey") {
      const p = payload as KeyboardHotkeyPayload;
      // robotjs hotkey() takes modifiers + key: hotkey('ctrl', 'c')
      if (p.keys.length === 1) {
        const key = p.keys[0];
        if (key) robot.keyTap(key);
      } else {
        // Multiple keys: treat first N-1 as modifiers
        const modifiers = p.keys.slice(0, -1) as string[];
        const key = p.keys[p.keys.length - 1];
        if (key) robot.hotkey(...modifiers, key);
      }
      return;
    }

    throw new Error("invalid_action");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg === "out_of_bounds") {
      throw new Error("out_of_bounds");
    }
    if (msg.startsWith("platform_error")) {
      throw error;
    }

    throw new Error(`execution_failed: ${msg}`);
  }
}

/**
 * High-level entry point: validates payload and executes.
 * Returns true on success, false on validation error.
 * Throws on execution errors (which should be handled by caller).
 */
export async function handleRemoteInput(
  payload: unknown,
): Promise<{ success: true } | { success: false; error: InputExecutionError }> {
  const validated = validateInputPayload(payload);
  if (!validated) {
    return { success: false, error: "invalid_payload" };
  }

  try {
    await executeInput(validated);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg === "out_of_bounds") {
      return { success: false, error: "out_of_bounds" };
    }
    if (msg.startsWith("platform_error")) {
      return { success: false, error: "platform_error" };
    }
    if (msg.startsWith("execution_failed")) {
      return { success: false, error: "execution_failed" };
    }

    return { success: false, error: "execution_failed" };
  }
}
