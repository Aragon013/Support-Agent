# Screen Frame Pipeline - Implementation Plan

## Current State
- ✅ Control-plane accepts screen.frame.stub messages (no validation)
- ❌ Host-agent silently ignores screen.frame.stub
- ❌ No frame capture logic
- ❌ No frame encoding (compression)
- ❌ No validation of screen capability

## Architecture

```
Host-Agent (Producer)          Signal Bridge              Controller (Consumer)
─────────────────────────────────────────────────────────────────────────────

ScreenFrameProducer
  ├─ FrameCapturer (screenshot)
  │  └─ platform-specific (Windows: screenshot-desktop, Linux: scrot, macOS: screencapture)
  │
  ├─ FrameEncoder (compress)
  │  └─ sharp (JPEG quality=70 for balance speed/quality)
  │
  └─ FrameSender (WebSocket)
     └─ session-signal-client.postScreenFrame()
        └─ POST /api/v1/sessions/{id}/signal (screen.frame.data)

Signal Store & WS Hub (already exists)
  └─ Broadcast to all controller participants

Controller (listen only)
  └─ Future: WebSocket handler to receive screen.frame.data
```

## Tasks

### 1. Types & Schema
- **File**: `apps/host-agent/src/screen/screen-frame.types.ts`
- Exports:
  - `ScreenFrameDataPayload` (jpeg base64, metadata)
  - `FrameEncodingQuality` enum (0-100)
  - Validation function

### 2. Frame Capturer
- **File**: `apps/host-agent/src/screen/frame-capturer.ts`
- Abstract interface: `IFrameCapturer`
  - `captureFrame(): Promise<Buffer>`
- Platform adapters:
  - Windows: `windows-capturer.ts` (screenshot-desktop npm)
  - Linux: `linux-capturer.ts` (node-native or scrot CLI)
  - macOS: `macos-capturer.ts` (child_process screencapture)
- Factory: `createFrameCapturer(platform)` → platform-specific instance

### 3. Frame Encoder
- **File**: `apps/host-agent/src/screen/frame-encoder.ts`
- `FrameEncoder` class:
  - Input: raw screenshot Buffer (PNG/BMP)
  - Output: JPEG base64 + metadata (width, height, timestamp)
  - Options: quality (default 70), maxWidth (default 1920)
  - Use: `sharp` library for image processing

### 4. Screen Frame Producer
- **File**: `apps/host-agent/src/screen/screen-frame-producer.ts`
- `ScreenFrameProducer` class:
  - Dependency inject: `capturer`, `encoder`, `signalClient`
  - `start(sessionId, intervalMs=1000)` → begins periodic capture
  - `stop(sessionId)`
  - Per-frame latency tracking
  - Error handling + backoff (if capture fails, wait longer)
  - Config: fps limit, quality, max resolution

### 5. Integration in Session Signal Client
- **File**: `apps/host-agent/src/ws/session-signal-client.ts`
- New method: `postScreenFrame(sessionId, payload)`
  - Similar to `postInputResult()` but for screen.frame.data
  - Sends: `{ senderType: "host", messageType: "screen.frame.data", payload }`
- Lifecycle hooks:
  - `startSession()` → producer.start(sessionId)
  - `stopSession()` → producer.stop(sessionId)

### 6. Control-Plane Enhancements
- **File**: `apps/control-plane/src/domain/session-signal-store.ts`
- Add: `screen.frame.data` to SIGNAL_MESSAGE_TYPES
- New type: `ScreenFrameDataPayload`

### 7. Validation in Control-Plane
- **File**: `apps/control-plane/src/api/session-routes.ts`
- Check: session has "screen" in requestedCapabilities
- Validate: payload structure (base64, metadata)
- Only allow: host → controller direction

### 8. Tests
- Unit tests: Capturer, Encoder, Producer
- Integration tests: Full pipeline (capture → encode → send)
- Mock screenshots for reproducible tests

## Priority Implementation Order

1. **Types** (5 min)
2. **Frame Encoder** (10 min) - easiest, no platform dependencies
3. **Frame Capturer** (20 min) - create Windows version first, others later
4. **Screen Frame Producer** (15 min) - glue it together
5. **Session Signal Client Integration** (10 min) - wire up lifecycle
6. **Control-Plane Types** (5 min) - add message type
7. **Tests** (30 min)

**Total: ~95 min end-to-end**

## Known Decisions

- **Capture Rate**: Default 1 FPS (1000ms interval), configurable
- **Encoding**: JPEG (lossy but small), quality 70 (balance)
- **Size Limit**: Max 1920x1080 downscale to fit network
- **Error Recovery**: On failure, backoff exponentially then retry
- **No Validation in Agent**: Control-plane validates capability (simpler separation of concerns)

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Screenshot performance drain | Configurable FPS, quality, resolution limits |
| Encoding lag (slow CPU) | Async encoding, queue frames if behind |
| Memory bloat (base64 strings) | GC friendly, don't cache old frames |
| Platform-specific failures | Graceful degradation, log errors |

## Follow-up (After this block)

- Controller WebSocket handler for screen.frame.data
- Rendering screen in controller UI (canvas, WebGL)
- Adaptive quality based on network latency
- H.264 codec (future optimization)
