# Render Deployment — ScriptFlow Pro

## Service type
Use **Static Site**. The frontend is Vite-built and does not require `server.js` or an Express runtime in production.

## Settings
- Name: `scriptflow-pro`
- Branch: `main`
- Root Directory: blank when `package.json` is at repository root
- Runtime: **Static Site**
- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`
- Auto-Deploy: Yes
- Pull Request Previews: Optional

The existing `render.yaml` is already configured for the static deployment and SPA rewrite.

## Environment variables
No new environment variable is required for the connection speed-test workflow. Download and upload are measured directly in the browser against Cloudflare's public speed-test endpoints.

Keep the existing Firebase/Vite variables required by the application. Do not add `VITE_NETWORK_UPLOAD_URL`; the previous custom-upload fallback is no longer required.

## Speed-test behavior
- One automatic speed test runs when the app session starts.
- The normal target is approximately 10–16 seconds.
- Unstable connections may continue toward 30 seconds.
- Very slow connections may continue toward 30–45 seconds.
- Continuous speed monitoring is opt-in from the connection indicator and remains off by default.
- Tests pause during active WebRTC calls and low-network mode.
