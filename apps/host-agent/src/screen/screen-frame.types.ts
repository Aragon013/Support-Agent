/**
 * Screen frame types and schema for remote screen sharing.
 */

export type FrameEncodingQuality = 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100;

/**
 * Payload sent from host to controller via screen.frame.data message.
 * The JPEG data is base64-encoded for JSON transport.
 */
export interface ScreenFrameDataPayload {
  // Base64-encoded JPEG frame data
  frameData: string;

  // Frame sequence number (for detecting loss/reordering)
  frameId: number;

  // Timestamp when frame was captured (milliseconds since epoch)
  capturedAt: number;

  // Image metadata
  width: number;
  height: number;

  // Encoding metadata
  encodingQuality: FrameEncodingQuality;
  encodingFormat: "jpeg"; // Future: "h264", "vp8", etc.

  // Latency tracking (ms from capture to send)
  captureDurationMs: number;
  encodeDurationMs: number;
}

/**
 * Configuration for screen frame producer.
 */
export interface ScreenFrameProducerConfig {
  // Capture interval in milliseconds (affects FPS: 1000ms = 1 FPS, 100ms = 10 FPS)
  intervalMs: number;

  // JPEG encoding quality (0-100, default 70 = good balance)
  encodingQuality: FrameEncodingQuality;

  // Max width/height to capture (larger than this will be downscaled)
  maxWidth: number;
  maxHeight: number;

  // Enable detailed timing logs for debugging
  debugTiming: boolean;
}

/**
 * Default configuration: 1 FPS, quality 70, 1080p max.
 */
export const DEFAULT_SCREEN_FRAME_CONFIG: ScreenFrameProducerConfig = {
  intervalMs: 1000,
  encodingQuality: 70,
  maxWidth: 1920,
  maxHeight: 1080,
  debugTiming: false,
};

/**
 * Validates that a screen frame payload is properly formed.
 * Used by control-plane to validate incoming screen.frame.data messages.
 */
export function validateScreenFramePayload(payload: unknown): payload is ScreenFrameDataPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const p = payload as Record<string, unknown>;

  // Check required fields
  if (typeof p.frameData !== "string") return false;
  if (typeof p.frameId !== "number") return false;
  if (typeof p.capturedAt !== "number") return false;
  if (typeof p.width !== "number") return false;
  if (typeof p.height !== "number") return false;
  if (typeof p.captureDurationMs !== "number") return false;
  if (typeof p.encodeDurationMs !== "number") return false;

  // Check optional but expected fields
  if (p.encodingQuality !== undefined && typeof p.encodingQuality !== "number") return false;
  if (p.encodingFormat !== "jpeg") return false; // Currently only JPEG

  // Check bounds
  if (p.frameId < 0) return false;
  if (p.width <= 0 || p.height <= 0) return false;
  if (p.captureDurationMs < 0 || p.encodeDurationMs < 0) return false;

  // Base64 validation (basic check - valid base64 length is multiple of 4)
  if (p.frameData.length % 4 !== 0) {
    // Base64 padding may have been stripped, try re-adding
    const withPadding = p.frameData.padEnd(((p.frameData.length + 3) / 4) * 4, "=");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(withPadding)) return false;
  }

  return true;
}

/**
 * Gets a human-readable description of a frame.
 */
export function describeFrame(payload: ScreenFrameDataPayload): string {
  const sizeKb = Math.round(payload.frameData.length / 1024);
  const totalMs = payload.captureDurationMs + payload.encodeDurationMs;
  return `Frame #${payload.frameId}: ${payload.width}x${payload.height} @ Q${payload.encodingQuality}, ${sizeKb}KB, ${totalMs}ms total`;
}
