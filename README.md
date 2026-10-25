# OpenChamber Canvas

A project gallery for agent-generated artifacts. Each artifact opens in OpenChamber's browser panel, keeps its versions, refreshes in place, and can send user feedback back to the agent.

Status: 0.2.0 security and revision hardening built; installed acceptance pending. The gallery, setup view, and Work Status section use the public `@openchamber/sdk/ui` controls. Custom CSS composes layouts without restyling those controls.

- Plan and feature document: [docs/features/FEAT-001-openchamber-canvas.md](docs/features/FEAT-001-openchamber-canvas.md)
- Product truth: [PRODUCT.md](PRODUCT.md)
- Gallery design direction: [docs/design/canvas-gallery.md](docs/design/canvas-gallery.md)
- Platform research: [docs/research/openchamber-extension-platform.md](docs/research/openchamber-extension-platform.md)
- Product research: [docs/research/artifact-product-landscape.md](docs/research/artifact-product-landscape.md)
- Project conventions for agents: [AGENTS.md](AGENTS.md)

## What exists

- Strict TypeScript project with Bun scripts.
- Artifact store: guarded content updates, metadata-only updates, restore, complete paginated search, archive, favorites, trash, feedback delivery tracking, and runtime state.
- View policy: sandboxed CSP, loopback CORS, per-artifact HMAC view tokens, safe path resolution.
- Viewer server: sandboxed entry and secondary documents, fixed or following views, content-addressed rendering snapshots, authenticated shutdown, protocol/build compatibility, and idle exit.
- Runtime: `window.canvas` with storage, feedback, data, refresh, theme, and live update.
- Pinned libraries: Chart.js, D3, and Mermaid, copied by the build with a SHA-256 manifest.
- MCP server: `publish`, `update`, `list`, `read`, `archive`, and `result`, with `filePath` and `directoryPath` sources, an external-reference scan, and a heartbeat.
- Extension service: `/health`, `/list`, `/artifact`, `/versions`, `/view-url`, `/feedback`, `/export`, `/mcp-status`, `/mcp-registration`, `/archive`, `/favorite`, `/restore`, `/trash`, `/untrash`.
- Gallery panel: a master-detail artifact shelf built from the OpenChamber SDK UI kit, with project, all, archived, and trash scopes; search; tags; sort; list and grid; a persistent inspector on the full-screen page and on wide panels; version actions; restore; archive; delete; favorite; refine; attach; export; setup; remote warning; and an MCP setup CTA that reads the OpenCode config registration.
- Work Status section: artifact count, latest title, and a native MCP state badge.
- Extension manifest: panel, page, status section, service, and Canvas tool card.
- Unit/integration tests cover storage, guarded mutations, traversal, policy, feedback pagination, rendering snapshots, daemon lifecycle, MCP, service routes, setup registration, and trash.
- The inspector preserves revision drafts per artifact, exposes feedback for review and addition to chat, and initially shows three recent versions.
- [Authoring examples](examples/README.md) for a chart, a focused data-flow diagram, and an interactive interface mockup.

Run:

```bash
bun install
bun run typecheck
bun run lint
bun test
bun run test:browser
bun run build
```

`bun run test:browser` builds the distribution, tests the actual panel/status entries in an opaque mock host, then launches the bundled viewer with Node and tests its real runtime and the authoring examples. Chrome at `/usr/bin/google-chrome` exercises isolation, fixed/following views, feedback, drafts, complete search, setup, six resolved themes, and rail/page layouts. Temporary stores and screenshots stay under `/tmp/opencode`.

`bun run build` builds `panel/main.js`, `status/main.js`, `service/main.js`, `mcp/server.js`, `viewer/server.js`, `viewer/runtime/canvas.js`, copies libraries into `viewer/libraries/`, and writes `viewer/build.json` with the viewer/runtime/library build identity. These distribution files are committed for Git URL installation.

`opencode.json` is managed by OpenChamber and is not tracked. The extension bundles `mcp/server.js`, but an extension cannot register an MCP server. The Setup page shows a one-command registration with the exact path:

```bash
opencode mcp add canvas --global -- node '/absolute/path/to/openchamber-canvas/mcp/server.js'
```

It needs the OpenCode CLI on the PATH of the machine running OpenChamber. Settings → MCP accepts the same entry as JSON; `docs/mcp.example.json` is a template.

## Install

1. Run `bun run build`.
2. Open Settings → Extensions → Add.
3. Paste `/home/parth/Production/openchamber-canvas`.
4. Approve the `service` permission.
5. Open **Canvas** on the right rail.
6. Open **Canvas → Setup**. Run the shown `opencode mcp add` command on the OpenChamber server, or copy the JSON into Settings → MCP.

The MCP is a separate process. Without it the gallery can browse, open, export, and show feedback, but the agent cannot publish or update artifacts. `canvas_*` tools appear only after the MCP is registered.

## Verification

The automated suites cover the source and built distribution. The installed extension, host routing, setup, and tool card still need the manual acceptance run. Browser fixtures do not replace installed-app verification.

## Updating to 0.2.0

- `baseVersion` is required for every update, including full replacements and changed-content dedupe publishing. Read the current version before retrying a conflict.
- To change only a title or tags, pass `id`, `baseVersion`, and the metadata. No HTML or new content version is needed.
- `canvas.list` defaults to its working directory. Pass `allProjects: true` for cross-project listing. Search/filter/sort precede pagination.
- New versions pin runtime and library bytes. Existing versions remain readable with an explicit legacy/unpinned warning; their original dependencies cannot be reconstructed.
- An explicit version opens as a fixed snapshot. Opening without a version follows new revisions and restores.
- Feedback marked Added to chat is in the composer, not necessarily sent or read. Only pending feedback contributes to the gallery badge.
- Known incompatible daemons restart through authenticated control. Legacy daemons have no shutdown protocol and are not killed automatically. Close their Canvas views and stop the old Canvas viewer process manually, or wait for its 30-minute idle exit. Reopen from the gallery afterward; old view URLs expire on restart.

## Architecture

Four parts share one store at `~/.config/openchamber/artifacts`:

- An extension panel that lists artifacts by project and opens them.
- An extension service that reads the store, mints view URLs, and handles export and feedback.
- A detached viewer daemon that serves artifact HTML, the runtime API, and live updates on loopback.
- An MCP server the agent calls to publish, read, update, list, archive, and collect feedback.

The browser panel renders sandboxed JavaScript artifacts and provides DevTools. Native annotation is not supported on these sandboxed pages. New content versions retain their selected library files and runtime in a shared immutable snapshot. The viewer blocks the open network and the OpenChamber API.

## How OpenChamber sees it

The gallery and the service are one extension, installed in Settings, Extensions. The agent tools are an MCP server, installed in Settings, MCP. OpenChamber renders the MCP calls through `contributes.tools`, but it does not host the tools. An extension cannot register an agent tool, and an MCP server cannot draw a rail panel. The two are separate installs with separate permissions.

The setup page in the gallery shows the exact MCP JSON for the installed folder and checks the service and MCP heartbeat.

## Requirements

- OpenChamber desktop or web, tested against 2.5.1
- Bun 1.4 or newer for building and tests
- Node 24 for the bundled MCP server, service, and viewer
