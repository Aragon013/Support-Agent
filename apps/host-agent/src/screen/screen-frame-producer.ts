/**
 * Screen frame producer: orchestrates capture → encode → send pipeline.
 */

import type { IFrameCapturer } from "./frame-capturer.js";
import { FrameEncoder } from "./frame-encoder.js";
import type {
  FrameEncodingQuality,
  ScreenFrameDataPayload,
  ScreenFrameFeedbackPayload,
  ScreenFrameProducerConfig,
} from "./screen-frame.types.js";
import { DEFAULT_SCREEN_FRAME_CONFIG, describeFrame } from "./screen-frame.types.js";

export interface FrameSendCallback {
  (sessionId: string, payload: ScreenFrameDataPayload): Promise<void>;
}

/**
 * Produces screen frames by periodically capturing, encoding, and sending.
 */
export class ScreenFrameProducer {
  private readonly mergedConfig: ScreenFrameProducerConfig;
  private sessions = new Map<
    string,
    {
      timer: NodeJS.Timeout | null;
      encoder: FrameEncoder;
      lastErrorTime: number;
      consecutiveErrors: number;
      inFlight: boolean;
      currentIntervalMs: number;
      targetIntervalMs: number;
      currentQuality: FrameEncodingQuality;
      targetQuality: FrameEncodingQuality;
      emaPipelineMs: number;
      emaSendMs: number;
      measuredRttMs: number | null;
      maxInFlight: number;
    }
  >();

  private maxConsecutiveErrors = 5; // After 5 errors, give up

  constructor(
    private readonly capturer: IFrameCapturer,
    private readonly sendFrame: FrameSendCallback,
    config: ScreenFrameProducerConfig = DEFAULT_SCREEN_FRAME_CONFIG,
    private readonly log: (msg: string) => void = console.log,
  ) {
    this.mergedConfig = {
      ...DEFAULT_SCREEN_FRAME_CONFIG,
      ...config,
    };
  }

  /**
   * Starts frame capture for a session.
   * Runs at configured interval (e.g., 1000ms = 1 FPS).
   */
  startSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.log(`[screen] frame producer already running for ${sessionId}`);
      return;
    }

    const clampedQuality = this.clampQuality(this.mergedConfig.encodingQuality);
    const clampedInterval = this.clampInterval(this.mergedConfig.intervalMs);

    const encoder = new FrameEncoder({
      quality: clampedQuality,
      maxWidth: this.mergedConfig.maxWidth,
      maxHeight: this.mergedConfig.maxHeight,
    });

    this.sessions.set(sessionId, {
      timer: null,
      encoder,
      lastErrorTime: 0,
      consecutiveErrors: 0,
      inFlight: false,
      currentIntervalMs: clampedInterval,
      targetIntervalMs: clampedInterval,
      currentQuality: clampedQuality,
      targetQuality: clampedQuality,
      emaPipelineMs: clampedInterval,
      emaSendMs: clampedInterval,
      measuredRttMs: null,
      maxInFlight: 1,
    });

    this.scheduleNext(sessionId, 0);

    this.log(
      `[screen] frame producer started for ${sessionId} at ${clampedInterval}ms interval (q${clampedQuality})`,
    );
  }

  updateSessionTarget(sessionId: string, feedback: ScreenFrameFeedbackPayload): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (typeof feedback.targetFps === "number" && Number.isFinite(feedback.targetFps) && feedback.targetFps > 0) {
      const targetIntervalMs = this.clampInterval(Math.round(1000 / feedback.targetFps));
      session.targetIntervalMs = targetIntervalMs;
      session.currentIntervalMs = Math.max(session.currentIntervalMs, targetIntervalMs);
    }

    if (typeof feedback.targetQuality === "number" && Number.isFinite(feedback.targetQuality)) {
      const targetQuality = this.clampQuality(feedback.targetQuality);
      session.targetQuality = targetQuality;
      session.currentQuality = this.clampQuality(Math.min(session.currentQuality, targetQuality));
    }

    if (typeof feedback.maxInFlight === "number" && Number.isFinite(feedback.maxInFlight)) {
      session.maxInFlight = Math.max(1, Math.min(2, Math.floor(feedback.maxInFlight)));
    }

    if (typeof feedback.measuredRttMs === "number" && Number.isFinite(feedback.measuredRttMs)) {
      session.measuredRttMs = Math.max(0, feedback.measuredRttMs);
    }

    this.log(
      `[screen] updated target for ${sessionId}: ${Math.round(1000 / session.targetIntervalMs)}fps q${session.targetQuality}`,
    );
  }

  /**
   * Stops frame capture for a session.
   */
  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.timer) {
      clearTimeout(session.timer);
    }
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
  private async captureAndSend(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.inFlight && session.maxInFlight <= 1) {
      this.scheduleNext(sessionId, session.currentIntervalMs);
      return;
    }

    session.inFlight = true;

    try {
      const startMs = Date.now();

      session.encoder = this.createEncoder(session.currentQuality);

      // Capture
      const rawBuffer = await this.capturer.capture();
      const captureEndMs = Date.now();
      const captureDurationMs = captureEndMs - startMs;

      // Encode
      const payload = await session.encoder.encode(rawBuffer);
      payload.captureDurationMs = captureDurationMs;

      // Send
      const sendStartMs = Date.now();
      await this.sendFrame(sessionId, payload);
      const sendDurationMs = Date.now() - sendStartMs;
      const pipelineDurationMs = Date.now() - startMs;

      // Success: reset error counter
      session.consecutiveErrors = 0;
      session.emaPipelineMs = this.nextEma(session.emaPipelineMs, pipelineDurationMs, 0.2);
      session.emaSendMs = this.nextEma(session.emaSendMs, sendDurationMs, 0.2);

      if (this.mergedConfig.adaptiveEnabled !== false) {
        this.adaptSession(session);
      }

      if (this.mergedConfig.debugTiming) {
        this.log(`[screen] ${describeFrame(payload)}`);
      }

      this.scheduleNext(sessionId, session.currentIntervalMs);
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
      } else {
        const backoffMs = Math.min(
          this.clampInterval(session.currentIntervalMs * 2),
          this.mergedConfig.maxIntervalMs ?? DEFAULT_SCREEN_FRAME_CONFIG.maxIntervalMs ?? 2000,
        );
        this.scheduleNext(sessionId, backoffMs);
      }
    } finally {
      const current = this.sessions.get(sessionId);
      if (current) {
        current.inFlight = false;
      }
    }
  }

  private createEncoder(quality: FrameEncodingQuality): FrameEncoder {
    return new FrameEncoder({
      quality,
      maxWidth: this.mergedConfig.maxWidth,
      maxHeight: this.mergedConfig.maxHeight,
    });
  }

  private scheduleNext(sessionId: string, delayMs: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.timer) {
      clearTimeout(session.timer);
    }

    const safeDelay = Math.max(0, Math.floor(delayMs));
    session.timer = setTimeout(() => {
      void this.captureAndSend(sessionId);
    }, safeDelay);
  }

  private adaptSession(session: {
    currentIntervalMs: number;
    targetIntervalMs: number;
    currentQuality: FrameEncodingQuality;
    targetQuality: FrameEncodingQuality;
    emaPipelineMs: number;
    emaSendMs: number;
    measuredRttMs: number | null;
  }): void {
    const targetIntervalMs = session.targetIntervalMs;
    const measuredRttMs = session.measuredRttMs ?? 0;
    const tooSlow =
      session.emaPipelineMs > targetIntervalMs * 1.15 ||
      session.emaSendMs > targetIntervalMs * 0.75 ||
      measuredRttMs > targetIntervalMs * 2.5;
    const hasHeadroom =
      session.emaPipelineMs < targetIntervalMs * 0.65 &&
      session.emaSendMs < targetIntervalMs * 0.45 &&
      measuredRttMs > 0 &&
      measuredRttMs < targetIntervalMs * 1.35;

    if (tooSlow) {
      const slowerInterval = this.clampInterval(Math.round(session.currentIntervalMs * 1.15));
      session.currentIntervalMs = Math.max(slowerInterval, targetIntervalMs);
      session.currentQuality = this.clampQuality(session.currentQuality - 10);
      return;
    }

    if (!hasHeadroom) {
      return;
    }

    const fasterInterval = this.clampInterval(Math.round(session.currentIntervalMs * 0.92));
    session.currentIntervalMs = Math.max(targetIntervalMs, fasterInterval);

    if (session.currentQuality < session.targetQuality) {
      session.currentQuality = this.clampQuality(session.currentQuality + 10);
    }
  }

  private clampInterval(value: number): number {
    const minMs = this.mergedConfig.minIntervalMs ?? DEFAULT_SCREEN_FRAME_CONFIG.minIntervalMs ?? 120;
    const maxMs = this.mergedConfig.maxIntervalMs ?? DEFAULT_SCREEN_FRAME_CONFIG.maxIntervalMs ?? 2000;
    return Math.max(minMs, Math.min(maxMs, Math.floor(value)));
  }

  private clampQuality(value: number): FrameEncodingQuality {
    const minQuality = this.mergedConfig.minEncodingQuality ?? DEFAULT_SCREEN_FRAME_CONFIG.minEncodingQuality ?? 30;
    const maxQuality = this.mergedConfig.maxEncodingQuality ?? DEFAULT_SCREEN_FRAME_CONFIG.maxEncodingQuality ?? 90;
    const clamped = Math.max(minQuality, Math.min(maxQuality, Math.round(value / 10) * 10));
    return clamped as FrameEncodingQuality;
  }

  private nextEma(current: number, sample: number, alpha: number): number {
    return current + alpha * (sample - current);
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
