# ScriptFlow Pro — Static Network Monitor QA

## Implemented
- One singleton browser-side NetworkMonitor source of truth.
- Jitter sampled approximately every 5 seconds from measured probe response timing; jitter is the primary bar signal.
- Bars: 4 = 70–180ms (and better-than-threshold values remain 4), 3 = 181–290ms, 2 = 291–400ms, 1 = 401ms+, 0 = confirmed offline.
- Initial state is Checking connection… until a measurement or browser offline event is observed.
- Browser online/offline events are handled immediately.
- Reconnects count only after confirmed loss followed by confirmed recovery.
- Packet loss and stability are derived only from observed probe outcomes.
- Download bandwidth is measured from actual transferred bytes and elapsed time about every 60 seconds.
- Bandwidth tests are suppressed during active WebRTC calls and optional low-network mode.
- Duplicate probes/tests are prevented.
- Hidden tabs pause timers and resume with a fresh probe when visible.
- AbortControllers/timeouts are cleaned up per request.
- WebRTC audio jitter and packet/audio loss are read only from actually registered RTCPeerConnection objects.
- Speed Test remains separate and lazy-loads Fast.com only when its tab is opened.
- Jitter Stabilizer tab exposes lightweight call-safe mode; it does not claim to change ISP/Wi-Fi jitter.

## Static-site constraint
A Render Static Site cannot receive arbitrary POST uploads. Therefore general upload Mbps is **N/A** unless `VITE_NETWORK_UPLOAD_URL` is configured to a real, CORS-enabled upload probe. No upload value is fabricated or inferred from download traffic. This is intentional and required for measurement integrity.

## Validation
- `server.js` syntax check: PASS
- JSON manifests parse: PASS
- Static asset present: PASS
- Network monitor source checks: PASS
- Jitter thresholds and offline/reconnect logic: PASS by source audit
- Lazy Fast.com iframe: PASS by source audit
- No backend dependency added to the frontend: PASS

A full `npm ci && npm run build` could not be completed in this environment because npm registry access timed out. Render should run the production build with its network access.
