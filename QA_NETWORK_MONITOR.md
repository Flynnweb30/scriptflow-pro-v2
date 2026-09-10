# ScriptFlow Pro — Static Network Monitor QA

## Implemented
- One singleton browser-side `NetworkMonitor` source of truth.
- Jitter sampled approximately every 5 seconds from measured probe response timing; jitter is the primary bar signal.
- Bars: 4 = 70–180ms (and better-than-threshold values remain 4), 3 = 181–290ms, 2 = 291–400ms, 1 = 401ms+, 0 = confirmed offline.
- Initial state is Checking connection… until a measurement or browser offline event is observed.
- Browser online/offline events are handled immediately.
- Reconnects count only after confirmed loss followed by confirmed recovery.
- Packet loss and stability are derived only from observed probe outcomes.
- A real browser speed test runs automatically once when the app session starts.
- Speed-test flow is adaptive: latency → download → upload → calculation, normally about 10–16 seconds; unstable connections can extend toward 30 seconds and very slow links can extend toward 30–45 seconds.
- Download and upload are measured from actual transferred bytes and elapsed time against Cloudflare's public speed-test edge endpoints. No upload value is inferred from download traffic.
- A manual **Test now** action is available in the connection popover.
- Continuous speed monitoring is OFF by default and is only scheduled when the user explicitly enables it.
- Continuous monitoring uses the existing 60-second cadence and is suppressed during active WebRTC calls or low-network mode.
- Duplicate probes/tests are prevented.
- Hidden tabs pause timers and resume with a fresh probe when visible.
- AbortControllers/timeouts are cleaned up per request.
- WebRTC audio jitter and packet/audio loss are read only from actually registered RTCPeerConnection objects.
- Jitter Stabilizer remains call-safe and does not claim to change ISP/Wi-Fi jitter.

## Static-site speed-test architecture
The Render frontend remains a pure static deployment. Download and upload speed measurements use the browser directly against Cloudflare's public speed-test endpoints:
- `https://speed.cloudflare.com/__down`
- `https://speed.cloudflare.com/__up`

No Express upload endpoint, Firebase Function, tracking endpoint, ad script, or custom backend was added. The existing `/network-probe.bin` asset remains only for lightweight same-origin connectivity/jitter probing.

## Validation
- Network monitor source syntax/transpile check: PASS
- Connection indicator source syntax/transpile check: PASS
- `server.js` syntax check: PASS
- Static speed-test asset present: PASS
- Archive integrity: PASS
- Full `npm ci && npm run build`: BLOCKED in this environment because npm registry access timed out; the production build must be run by Render's build environment.
