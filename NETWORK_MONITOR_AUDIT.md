# ScriptFlow Pro — Network Monitor / Speed Test Audit

## Implemented

- One singleton `NetworkMonitor` is the source of truth for connection state and metrics.
- Live monitoring starts from the app lifecycle through `useNetworkMonitor` and stops when the final subscriber unmounts.
- Visible-tab jitter/connectivity probes run approximately every 5 seconds; hidden tabs reduce probes to approximately every 30 seconds.
- Browser `online` / `offline` events are handled immediately.
- Jitter is calculated from actual successive same-origin round-trip measurements, or from registered WebRTC inbound audio `jitter` statistics when an active peer connection is registered.
- Bar thresholds are strict and classification never changes the raw metric shown in the hover panel:
  - 70 to <181 ms: 4 bars
  - 181 to <291 ms: 3 bars
  - 291 to <401 ms: 2 bars
  - >=401 ms: 1 bar
  - confirmed offline: 0 bars / Connection Lost
  - <70 ms or no valid jitter: no quality bar is asserted; the state is unavailable/checking rather than fabricated.
- Raw latest jitter is never smoothed or fabricated.
- Reconnects count only after confirmed availability, confirmed loss, then confirmed recovery. Initial offline recovery is not counted.
- Packet loss and stability use the rolling probe result window.
- WebRTC audio packet-loss statistics are used for live-call audio loss only when an active WebRTC peer is registered; otherwise audio loss is N/A.
- Download/upload measurements use real byte transfers and the required Mbps formula against lightweight same-origin endpoints.
- Bandwidth tests run about every 60 seconds, are paused in hidden tabs, while Speed Test is open, and when an active registered WebRTC call exists.
- Fast.com is embedded only when the Speed Test tab is opened. A direct external fallback is available and a timeout fallback covers browsers that refuse the frame without surfacing a reliable iframe error event.
- The Tools & Settings header contains the compact 1–4 bar indicator. Hover/focus exposes all requested metrics.
- Existing application data/auth/Firebase workflows are not used by the network monitor and are not restructured.

## Server support

`server.js` adds three lightweight same-origin endpoints:

- `GET /api/network/ping`
- `GET /api/network/download`
- `POST /api/network/upload`

They are independent of Firebase and application records.

## Validation performed

- Parsed all 63 TS/TSX files with the installed TypeScript parser: PASS.
- Relative-import existence audit across all TS/TSX files: PASS.
- `server.js` syntax check with Node: PASS.
- Required network monitor, threshold, lifecycle, bandwidth, reconnect, WebRTC, sidebar, and Speed Test source assertions: PASS.
- Package contains the existing Render Node Web Service architecture and no new npm dependency.

## Environment limitation

A full `npm ci` / production Vite build could not be completed in this sandbox because the available npm cache is incomplete and registry access is unavailable. The existing `node_modules` directory is also incomplete. Render should run the authoritative network-backed build:

`npm ci && npm run build`

and then start with:

`npm start`
