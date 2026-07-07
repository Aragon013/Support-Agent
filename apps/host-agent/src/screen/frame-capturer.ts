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

function captureWithScreenshotDesktop(platformLabel: string): Promise<Buffer> {
  return screenshotDesktop({ format: "png" })
    .then((frame) => {
      if (!Buffer.isBuffer(frame)) {
        throw new Error("invalid_buffer_format");
      }
      return frame;
    })
    .catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`${platformLabel}_capture_failed: ${msg}`);
    });
}

/**
 * Windows frame capturer using screenshot-desktop.
 */
export class WindowsFrameCapturer implements IFrameCapturer {
  async capture(): Promise<Buffer> {
    return captureWithScreenshotDesktop("windows");
  }
}

/**
 * Linux frame capturer using screenshot-desktop.
 */
export class LinuxFrameCapturer implements IFrameCapturer {
  async capture(): Promise<Buffer> {
    return captureWithScreenshotDesktop("linux");
  }
}

/**
 * macOS frame capturer using screenshot-desktop.
 */
export class MacFrameCapturer implements IFrameCapturer {
  async capture(): Promise<Buffer> {
    return captureWithScreenshotDesktop("macos");
  }
}

/**
 * Factory to create platform-specific capturer.
 * Uses screenshot-desktop for Windows, Linux, and macOS.
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
