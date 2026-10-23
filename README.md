# OpenChamber Canvas

A project gallery for agent-generated artifacts. Each artifact opens in OpenChamber's browser panel, keeps its versions, refreshes in place, and can send user feedback back to the agent.

Status: Phase 5 built, Phase 6 in progress. The artifact store, viewer, runtime, MCP server, service, gallery panel, and Work Status section are implemented. The extension is installed. The MCP is bundled as a file but must be registered separately in Settings → MCP.

- Plan and feature document: [docs/features/FEAT-001-openchamber-canvas.md](docs/features/FEAT-001-openchamber-canvas.md)
- Platform research: [docs/research/openchamber-extension-platform.md](docs/research/openchamber-extension-platform.md)
- Product research: [docs/research/artifact-product-landscape.md](docs/research/artifact-product-landscape.md)
- Project conventions for agents: [AGENTS.md](AGENTS.md)

## What exists

- Strict TypeScript project with Bun scripts.
- Artifact store: create, replace, merge, exact edits, restore, read, list, archive, favorite, pin, trash, untrash, prune, feedback, runtime state.
- View policy: sandboxed CSP, loopback CORS, per-artifact HMAC view tokens, safe path resolution.
- Viewer server: `/health`, `/mint`, `/notify`, `/view`, `/events`, `/api`, `/libraries`, port file, idle exit.
- Runtime: `window.canvas` with storage, feedback, data, refresh, theme, and live update.
- Pinned libraries: Chart.js, D3, and Mermaid, copied by the build with a SHA-256 manifest.
- MCP server: `publish`, `update`, `list`, `read`, `archive`, and `result`, with `filePath` and `directoryPath` sources, an external-reference scan, and a heartbeat.
- Extension service: `/health`, `/list`, `/artifact`, `/versions`, `/view-url`, `/feedback`, `/export`, `/mcp-status`, `/archive`, `/favorite`, `/restore`, `/trash`, `/untrash`.
- Gallery panel: project, all, archived, and trash scopes; search; tags; sort; list and grid; detail; versions; restore; archive; delete; favorite; refine; attach; export; setup; remote warning.
- Work Status section: artifact count, latest title, and MCP heartbeat dot.
- Extension manifest: panel, page, status section, service, and Canvas tool card.
- 60 tests covering storage, update modes, conflicts, traversal, locking, policy, feedback, state, viewer routes, SSE, bundle assets, MCP tools, file and folder sources, service routes, export, and trash.

Run:

```bash
bun install
bun run typecheck
bun test
bun run build
```

`bun run build` builds `panel/main.js`, `status/main.js`, `service/main.js`, `mcp/server.js`, `viewer/server.js`, `viewer/runtime/canvas.js`, and copies the pinned libraries into `viewer/libraries/`.

`opencode.json` is managed by OpenChamber and is not tracked. The extension bundles `mcp/server.js`, but an extension cannot register an MCP server. Add it in Settings → MCP. The setup page in the gallery shows the exact JSON for this install, and `docs/mcp.example.json` is a template.

## Install

1. Run `bun run build`.
2. Open Settings → Extensions → Add.
3. Paste `/home/parth/Production/openchamber-canvas`.
4. Approve the `service` permission.
5. Open **Canvas** on the right rail.
6. Open **Canvas → Setup** and copy the MCP config. Add it in Settings → MCP, or paste it into an OpenCode config.

The MCP is a separate process. Without it the gallery can browse, open, export, and show feedback, but the agent cannot publish or update artifacts. `canvas_*` tools appear only after the MCP is registered.

## Verification

The Phase 0 probes pass. The store, viewer, MCP, and service suites pass. The gallery, status section, setup page, and tool card need the installed extension; the manual acceptance run is the remaining check.

## What it will be

Four parts share one store at `~/.config/openchamber/artifacts`:

- An extension panel that lists artifacts by project and opens them.
- An extension service that reads the store, mints view URLs, and handles export and feedback.
- A detached viewer daemon that serves artifact HTML, the runtime API, and live updates on loopback.
- An MCP server the agent calls to publish, read, update, list, archive, and collect feedback.

The browser panel does the rendering, so artifacts keep full JavaScript and gain annotation and DevTools. Artifacts use a pinned local library set, so they work without a CDN. The viewer blocks the open network and the OpenChamber API.

## How OpenChamber sees it

The gallery and the service are one extension, installed in Settings, Extensions. The agent tools are an MCP server, installed in Settings, MCP. OpenChamber renders the MCP calls through `contributes.tools`, but it does not host the tools. An extension cannot register an agent tool, and an MCP server cannot draw a rail panel. The two are separate installs with separate permissions.

The setup page in the gallery shows the exact MCP JSON for the installed folder and checks the service and MCP heartbeat.

## Requirements

- OpenChamber desktop or web, tested against 2.5.1
- Bun 1.4 or newer for building and tests
- Node 24 for the bundled MCP server, service, and viewer
