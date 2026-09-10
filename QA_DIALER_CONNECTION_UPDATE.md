# ScriptFlow Pro — Dialer + Connection Indicator Update

## Changes
- Added a compact phone-icon-only button below the TopBar performance stats.
- Button navigates directly to the configured Regen Digital pooled dialer URL.
- Connection diagnostics popover is positioned above the indicator on desktop and above the fixed bottom offset on mobile.
- Reduced popover width and spacing while preserving all existing metrics.
- No Firebase, Firestore, authentication, Activities, Calendar/List, Calling Scripts, Closers, or network-monitor logic was restructured.

## Validation
- Confirmed only the intended TopBar and connection-indicator styling paths were modified.
- Confirmed no duplicate Vite dependency exists in package.json.
- Full `npm ci && npm run build` could not complete in the execution environment because npm dependency installation timed out; no successful production build is claimed.

## Render Static Site
Build Command: `npm ci && npm run build`
Publish Directory: `dist`
