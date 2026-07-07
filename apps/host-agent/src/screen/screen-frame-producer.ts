/**
 * Screen frame producer: orchestrates capture → encode → send pipeline.
 */

import type { IFrameCapturer } from "./frame-capturer.js";
import { FrameEncoder } from "./frame-encoder.js";
import type { ScreenFrameDataPayload, ScreenFrameProducerConfig } from "./screen-frame.types.js";
import { DEFAULT_SCREEN_FRAME_CONFIG, describeFrame } from "./screen-frame.types.js";

export interface FrameSendCallback {
  (sessionId: string, payload: ScreenFrameDataPayload): Promise<void>;
}

/**
 * Produces screen frames by periodically capturing, encoding, and sending.
 */
export class ScreenFrameProducer {
  private sessions = new Map<
    string,
    {
      timer: NodeJS.Timeout;
      encoder: FrameEncoder;
      lastErrorTime: number;
      consecutiveErrors: number;
      backoffMultiplier: number;
    }
  >();

  private errorBackoffMs = 1000; // Start with 1s
  private maxConsecutiveErrors = 5; // After 5 errors, give up

  constructor(
    private readonly capturer: IFrameCapturer,
    private readonly sendFrame: FrameSendCallback,
    private readonly config: ScreenFrameProducerConfig = DEFAULT_SCREEN_FRAME_CONFIG,
    private readonly log: (msg: string) => void = console.log,
  ) {}

  /**
   * Starts frame capture for a session.
   * Runs at configured interval (e.g., 1000ms = 1 FPS).
   */
  startSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.log(`[screen] frame producer already running for ${sessionId}`);
      return;
    }

    const encoder = new FrameEncoder({
      quality: this.config.encodingQuality,
      maxWidth: this.config.maxWidth,
      maxHeight: this.config.maxHeight,
    });

    let backoffMultiplier = 1;

    const timer = setInterval(async () => {
      await this.captureAndSend(sessionId, encoder, backoffMultiplier);
    }, this.config.intervalMs);

    this.sessions.set(sessionId, {
      timer,
      encoder,
      lastErrorTime: 0,
      consecutiveErrors: 0,
      backoffMultiplier,
    });

    this.log(`[screen] frame producer started for ${sessionId} at ${this.config.intervalMs}ms interval`);
  }

  /**
   * Stops frame capture for a session.
   */
  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    clearInterval(session.timer);
    this.sessions.delete(sessionId);
    this.log(`[screen] frame producer stopped for ${sessionId}`);
  }

  /**
   * Stops all active sessions.
   */
  stopAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.stopSession(sessionId);
    }
  }

  /**
   * Private: captures, encodes, and sends a single frame.
   * Handles errors with exponential backoff.
   */
  private async captureAndSend(
    sessionId: string,
    encoder: FrameEncoder,
    backoffMultiplier: number,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const startMs = Date.now();

      // Capture
      const rawBuffer = await this.capturer.capture();
      const captureEndMs = Date.now();
      const captureDurationMs = captureEndMs - startMs;

      // Encode
      const payload = await encoder.encode(rawBuffer);
      payload.captureDurationMs = captureDurationMs;

      // Send
      await this.sendFrame(sessionId, payload);

      // Success: reset error counter
      session.consecutiveErrors = 0;
      session.backoffMultiplier = 1;

      if (this.config.debugTiming) {
        this.log(`[screen] ${describeFrame(payload)}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      session.consecutiveErrors++;
      session.lastErrorTime = Date.now();

      this.log(
        `[screen] capture error for ${sessionId} (${session.consecutiveErrors}/${this.maxConsecutiveErrors}): ${msg}`,
      );

      if (session.consecutiveErrors >= this.maxConsecutiveErrors) {
        this.log(`[screen] giving up on ${sessionId} after ${this.maxConsecutiveErrors} errors`);
        this.stopSession(sessionId);
      }
    }
  }

  /**
   * Gets statistics about active sessions (for monitoring).
   */
  getStats(): {
    activeCount: number;
    sessionIds: string[];
  } {
    return {
      activeCount: this.sessions.size,
      sessionIds: [...this.sessions.keys()],
    };
  }
}
