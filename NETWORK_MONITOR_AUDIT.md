# ScriptFlow Pro — Connection Monitor / Speed Test Audit

## Implemented
- One singleton `networkMonitor` owns all connection probes, bandwidth tests, browser online/offline listeners, visibility lifecycle, and reconnect counting.
- Probe cadence: approximately every 5 seconds while the page is visible.
- Browser offline events immediately force 0 bars / Connection Lost.
- Two consecutive failed probes confirm loss; the first successful probe after confirmed loss increments the session reconnect counter.
- Jitter is calculated from measured round-trip probe variation and is the primary quality signal; RTT and packet loss refine the bar classification.
- No bandwidth is inferred from connection type, signal strength, or latency.
- Bandwidth tests use same-origin endpoints and actual bytes transferred / elapsed test duration. They run approximately every 60 seconds and are skipped while active audio/video media is detected or while the tab is hidden.
- Failed bandwidth tests show Unavailable and do not mark the connection lost.
- Monitoring resumes automatically after reconnection and when the tab becomes visible.
- Timers/listeners are owned by the singleton and are not recreated when application tabs change.
- The sidebar Tools & Settings section contains the live four-bar indicator and hover/click metrics.
- A separate Speed Test tab embeds Fast.com lazily and provides an Open Fast.com fallback if embedding is blocked or does not load.
- The server provides lightweight same-origin ping/download/upload endpoints.
- CSP permits the Fast.com frame.

## Files changed
- `src/services/NetworkMonitor.ts` — new centralized monitor.
- `src/components/ConnectionIndicator.tsx` — new sidebar indicator and metrics popover.
- `src/components/SpeedTest.tsx` — new Speed Test tab.
- `src/components/Sidebar.tsx` — indicator and Speed Test navigation integration.
- `src/App.tsx` — Speed Test tab integration.
- `src/index.css` — responsive indicator and Speed Test styling.
- `server.js` — same-origin measurement endpoints and Fast.com frame CSP allowance.

## File-count constraint
The final project contains 98 files, below the requested 100-file maximum.

## Verification
- `node --check server.js` — PASS.
- `node --check public/js/app.js` — PASS.
- Project file count — 98.
- Source references for the singleton, lifecycle, endpoints, sidebar integration, and Speed Test tab verified.
- A full TypeScript/Vite production build could not be completed in this sandbox because the dependency installation environment has no usable npm package cache/registry access. Render should run the final `npm ci && npm run build` in its network-enabled environment.

## Important measurement note
The monitor's jitter value is measured timing variation between repeated same-origin network probes. It is not RTP audio jitter from a specific live-call peer connection. If a future live-call provider exposes WebRTC `RTCStatsReport`, its RTP jitter can be added as a higher-priority source without changing the centralized UI contract.
