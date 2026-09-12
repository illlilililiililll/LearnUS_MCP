# Local MCP Host setup

Build with Node.js 22.19 or later and install the project's Playwright Chromium runtime.
Configure the Host to launch `node` with `<path-to-repo>/dist/index.js` as its argument.
Use an absolute repository path on the local machine; do not commit personal paths.

Supply LEARNUS_ID and LEARNUS_PASSWORD through the Host environment or supported secret mechanism.
Credentials do not belong in Tool arguments or committed configuration. The server does not load .env automatically.

stdout is reserved for MCP. Data Tools authenticate automatically; auth_status is diagnostic only.
Verify discovery with `npm run test:inspector`. Weekly coursework uses weekly_tasks, broad configurable summaries use overview, and details use individual Tools.
Generic personal planning without academic context should not select LearnUs. The server cannot force Host routing.
Remote MCP, tunnels and Custom App configuration are outside this release.
