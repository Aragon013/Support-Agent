/**
 * Frame capturer: takes screenshots of the host system.
 * Platform-specific implementations.
 */

import screenshotDesktop from "screenshot-desktop";

export interface IFrameCapturer {
  /**
   * Captures a screenshot of the primary display.
   * Returns raw image buffer (typically PNG format).
   */
  capture(): Promise<Buffer>;
}

/**
 * Windows frame capturer using screenshot-desktop.
 */
export class WindowsFrameCapturer implements IFrameCapturer {
  async capture(): Promise<Buffer> {
    try {
      const frame = await screenshotDesktop({ format: "png" });
      if (!Buffer.isBuffer(frame)) {
        throw new Error("invalid_buffer_format");
      }
      return frame;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`windows_capture_failed: ${msg}`);
    }
  }
}

/**
 * Linux frame capturer using gnome-screenshot or fallback.
 * (Placeholder for MVP - can use child_process + scrot if available)
 */
export class LinuxFrameCapturer implements IFrameCapturer {
  async capture(): Promise<Buffer> {
    throw new Error("linux_capture_not_yet_implemented");
  }
}

/**
 * macOS frame capturer using screencapture command.
 * (Placeholder for MVP)
 */
export class MacFrameCapturer implements IFrameCapturer {
  async capture(): Promise<Buffer> {
    throw new Error("macos_capture_not_yet_implemented");
  }
}

/**
 * Factory to create platform-specific capturer.
 * Defaults to Windows (common in RDP scenarios).
 */
export function createFrameCapturer(platform?: string): IFrameCapturer {
  const os = platform ?? process.platform;

  switch (os) {
    case "win32":
      return new WindowsFrameCapturer();
    case "linux":
      return new LinuxFrameCapturer();
    case "darwin":
      return new MacFrameCapturer();
    default:
      throw new Error(`unsupported_platform: ${os}`);
  }
}
