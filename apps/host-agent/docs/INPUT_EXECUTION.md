# Input Execution - Host Agent

## Overview

The host-agent now supports executing remote input commands (mouse and keyboard) received from the controller via WebSocket signaling. This enables operators to control the remote host's mouse and keyboard in real-time during support sessions.

## Architecture

### Flow

```
Controller → POST /api/v1/sessions/{id}/signal (control.input message)
    ↓
Control-Plane → Validate sender/direction + session state
    ↓
Signal WebSocket Hub → Broadcast to host-agent
    ↓
Host-Agent WS Handler → handleSignal()
    ↓
Policy Evaluation → evaluateControlInputPolicy()
    ↓
Input Executor → handleRemoteInput() → executeInput(validated payload)
    ↓
RobotJS (platform-specific) → Mouse/keyboard control
    ↓
Response → POST /api/v1/sessions/{id}/signal (control.input result)
    ↓
Control-Plane → Signal WS Hub → Broadcast to controller
```

### Security Model

**Policy Layers:**

1. **Control-Plane (Signaling):**
   - Validates sender: only "controller" can send control.input
   - Validates session state: requires "connected_p2p", "connected_relay", or "reconnecting"

2. **Host-Agent (Execution):**
   - Requires `allowRemoteInput` config flag enabled
   - Requires session status != "ended" and != "failed"
   - Requires access mode = "control" (not "view")
   - Requires "input" capability in session.requestedCapabilities

3. **Input Executor (Whitelist):**
   - Only allows specific input actions (see whitelist below)
   - Validates payload structure and bounds
   - Out-of-bounds coordinate rejection

**Allowed Actions Whitelist:**

```typescript
export const ALLOWED_ACTIONS = new Set([
  "mouse.move",      // Move cursor to (x, y)
  "mouse.click",     // Click mouse button
  "mouse.doubleClick", // Double-click
  "mouse.scroll",    // Scroll wheel
  "keyboard.press",  // Press single key
  "keyboard.hotkey", // Multi-key combination (Ctrl+C, etc.)
]);
```

**Explicitly Disallowed:**

- `keyboard.type` - Intentionally excluded to prevent keylogging patterns
- Any system commands or script execution
- File operations
- Registry modifications

## Implementation Details

### Modules

- **[input-executor.ts](src/input/input-executor.ts)**: Core input validation and execution
  - `validateInputPayload()`: Validates and type-checks payload
  - `executeInput()`: Executes validated action via RobotJS
  - `handleRemoteInput()`: High-level entry point with error handling
  - `isCoordinateInBounds()`: Validates mouse coordinates against screen size

- **[session-signal-client.ts](src/ws/session-signal-client.ts)**: WS handler integration
  - Updated `handleSignal()` to execute input after policy check
  - New deny codes: execution_failed, out_of_bounds, platform_error

- **[input-executor.test.ts](src/input/input-executor.test.ts)**: Unit tests
  - 38 test cases covering whitelist, validation, bounds checking

- **[session-signal-client.integration.test.ts](src/ws/session-signal-client.integration.test.ts)**: Integration tests
  - Tests for policy evaluation, URL building, result payload construction

### Payload Examples

**Mouse Move:**
```json
{
  "action": "mouse.move",
  "x": 1024,
  "y": 768
}
```

**Mouse Click:**
```json
{
  "action": "mouse.click",
  "button": "left",
  "x": 500,
  "y": 300
}
```

**Keyboard Hotkey (Ctrl+C):**
```json
{
  "action": "keyboard.hotkey",
  "keys": ["ctrl", "c"]
}
```

**Mouse Scroll:**
```json
{
  "action": "mouse.scroll",
  "direction": "down",
  "amount": 5
}
```

### Response Structure

```typescript
{
  "result": "accepted" | "denied",
  "action": "mouse.move",                    // Echo of requested action
  "sessionStatus": "connected_p2p",
  "handledAt": "2024-01-15T10:30:00.000Z",
  "denyCode": "out_of_bounds"                // If denied
}
```

**Possible Deny Codes:**

- Policy layer: `feature_disabled`, `session_not_control_mode`, `input_capability_missing`, `session_not_active`, `sender_not_controller`
- Validation layer: `invalid_payload`, `invalid_action`
- Execution layer: `execution_failed`, `out_of_bounds`, `platform_error`

## Configuration

**Environment Variables:**

```bash
# Enable/disable remote input execution (default: false)
ALLOW_REMOTE_INPUT=true
```

**Config File (if using config-based setup):**

```json
{
  "allowRemoteInput": true
}
```

## Platform Support

Powered by [RobotJS](https://github.com/octalmage/robotjs):

- **Windows**: Native Win32 API (via @simonkagel/robotjs fork)
- **macOS**: Native Objective-C bindings
- **Linux**: Native X11/Wayland support

### Native Dependencies

RobotJS requires compilation of native extensions. Ensure you have:

- **Windows**: Visual Studio Build Tools (C++ toolchain)
- **macOS**: Xcode Command Line Tools
- **Linux**: Build essentials + X11 development files

```bash
# Install globally (one-time)
npm install -g node-gyp

# RobotJS will auto-compile during npm install
```

## Testing

### Run All Tests

```bash
cd apps/host-agent
npm test
```

### Run Input Executor Tests Only

```bash
npm test -- src/input/input-executor.test.ts
```

### Test Coverage

- 38 unit tests for input executor (whitelist, validation, bounds)
- 24 integration tests for signal handling + policy
- 93 total tests, all passing

## Known Limitations

1. **No Rate Limiting**: Multiple rapid input requests may overwhelm the system. Consider implementing request rate limiting if needed.
2. **No Macro Recording**: Input executor executes one action at a time. Complex sequences require multiple requests.
3. **No Screen Scaling**: Coordinates must match the actual host screen resolution.
4. **No Relative Positioning**: All coordinates are absolute screen positions.

## Future Enhancements

1. **Rate Limiting**: Add configurable throttling for input requests per second
2. **Macro Recording**: Record and replay sequences of input actions
3. **Screen-Aware Scaling**: Auto-scale mouse coordinates based on different screen resolutions
4. **Input Filtering**: Support custom regex-based action filtering
5. **Audit Logging**: Detailed logging of all input actions (already integrated with session audit)

## Security Considerations

- **Whitelist-First Design**: Only explicitly allowed actions can be executed
- **Capability-Based Access**: Requires explicit "input" capability in session setup
- **Access Mode Verification**: Separate "view-only" vs "control" modes
- **Bounds Checking**: Screen coordinate validation prevents edge-case attacks
- **Policy Layering**: Multiple independent policy checks (control-plane → host → executor)
- **Audit Trail**: All input execution logged to session audit trail (via denyCode + accepted flag)

## Troubleshooting

### "platform_error: robotjs not available"

**Cause**: RobotJS failed to load or wasn't installed.

**Solution:**
```bash
cd apps/host-agent
npm install --no-save robotjs
npm run build
```

### "out_of_bounds" deny code

**Cause**: Mouse coordinates exceed screen dimensions.

**Solution**: Ensure x and y are within [0, screenWidth) and [0, screenHeight).

### "execution_failed" deny code

**Cause**: RobotJS execution error (e.g., invalid key name for keyboard.press).

**Solution**: Verify key names match RobotJS key naming convention (e.g., "a", "return", "escape").

### Tests failing with "robotjs not available"

**Cause**: RobotJS not installed in test environment.

**Solution**: Tests mock out actual execution, so this shouldn't happen. If it does, reinstall:
```bash
npm install
npm run build
npm test
```

## References

- [RobotJS Documentation](https://github.com/octalmage/robotjs)
- [Control-Plane Signaling API](../control-plane/docs/signaling.md)
- [Session Capabilities](../control-plane/docs/sessions.md)
