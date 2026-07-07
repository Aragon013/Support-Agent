/**
 * Frame encoder: converts raw screenshots (PNG/Buffer) to JPEG base64 with quality control.
 */

import sharp from "sharp";
import type { FrameEncodingQuality, ScreenFrameDataPayload } from "./screen-frame.types.js";

export interface EncoderOptions {
  quality: FrameEncodingQuality;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Encodes a raw screenshot buffer to JPEG base64.
 * Uses sharp for fast image processing (native bindings).
 *
 * Input: PNG/BMP buffer (e.g., from screenshot-desktop)
 * Output: Base64-encoded JPEG
 */
export async function encodeScreenFrameToJpeg(
  rawBuffer: Buffer,
  options: EncoderOptions,
): Promise<{
  base64: string;
  width: number;
  height: number;
  durationMs: number;
}> {
  const startMs = Date.now();

  try {
    // Parse the image, optionally resize
    let pipeline = sharp(rawBuffer);

    // Get metadata to check size
    const metadata = await pipeline.metadata();
    let width = metadata.width ?? 1920;
    let height = metadata.height ?? 1080;

    // Resize if needed (aspect ratio preserved)
    if (options.maxWidth && width > options.maxWidth) {
      pipeline = pipeline.resize(options.maxWidth, options.maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // Encode to JPEG
    const jpegBuffer = await pipeline.jpeg({ quality: options.quality }).toBuffer();

    const durationMs = Date.now() - startMs;

    return {
      base64: jpegBuffer.toString("base64"),
      width,
      height,
      durationMs,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`encoding_failed: ${msg}`);
  }
}

/**
 * Simpler encoder that takes already-JPEG data and just base64 encodes it
 * (useful if screenshot library returns JPEG directly).
 */
export function encodeJpegToBase64(
  jpegBuffer: Buffer,
  width: number,
  height: number,
): {
  base64: string;
  width: number;
  height: number;
} {
  return {
    base64: jpegBuffer.toString("base64"),
    width,
    height,
  };
}

/**
 * High-level encoder that handles full pipeline.
 */
export class FrameEncoder {
  private frameIdCounter = 0;

  constructor(private readonly options: EncoderOptions) {}

  /**
   * Encodes a raw screenshot to a ScreenFrameDataPayload.
   * Automatically assigns frame ID and tracks timing.
   */
  async encode(rawBuffer: Buffer): Promise<ScreenFrameDataPayload> {
    const captureStartMs = Date.now();

    const result = await encodeScreenFrameToJpeg(rawBuffer, this.options);

    const encodeDurationMs = result.durationMs;
    const captureDurationMs = 0; // Not tracked by encoder (capturer responsibility)

    return {
      frameData: result.base64,
      frameId: this.frameIdCounter++,
      capturedAt: Date.now(),
      width: result.width,
      height: result.height,
      encodingQuality: this.options.quality,
      encodingFormat: "jpeg",
      captureDurationMs,
      encodeDurationMs,
    };
  }

  /**
   * Resets frame ID counter (useful on new session).
   */
  resetFrameId(): void {
    this.frameIdCounter = 0;
  }

  /**
   * Gets current frame ID (for monitoring).
   */
  getCurrentFrameId(): number {
    return this.frameIdCounter;
  }
}
