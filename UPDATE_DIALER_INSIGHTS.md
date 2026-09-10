# ScriptFlow Pro — Dialer + My Insights Update

## Changes
- Moved the pooled Dialer icon next to the Calling Scripts search field in the sidebar.
- Added a My Insights icon beside the Dialer icon.
- Both links open in a new browser tab with `target="_blank"` and `rel="noopener noreferrer"`.
- Removed the previous TopBar Dialer button to avoid duplicate functionality.
- No Firebase/Firestore, authentication, Activities, Calendar/List, Calling Scripts, Closer, or network-monitor architecture was changed.
- Removed three unused Vite starter assets so the delivered archive contains fewer than 100 files.

## Validation
- Sidebar.tsx parsed successfully with Babel TypeScript/JSX parser.
- TopBar.tsx parsed successfully with Babel TypeScript/JSX parser.
- index.css brace balance check passed.
- Final archive contains 97 files excluding build artifacts and node_modules.
- A production `npm run build` could not be executed in this environment because the npm dependency installation did not complete; Render must perform the real build.

## Render Static Site
- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`
- No new environment variables required for this update.
