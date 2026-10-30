# OpenChamber extension platform

Status: research. Verified against OpenChamber 2.5.1 on 2026-10-23.

Canvas 0.3.0 replaces the MCP-specific implementation described in this historical platform investigation. Read [the native-plugin update](#16-native-opencode-tools-update) for the current registration mechanism. The earlier MCP/config/heartbeat sections document the old implementation, not a current requirement.

This document records how an OpenChamber extension is packaged, installed, loaded, and connected to a local process and to agent tools. It is the platform reference for FEAT-001.

## 1. Sources

| Source | What it establishes |
|---|---|
| Installed app at `/opt/OpenChamber` | Version 2.5.1, Electron shell, bundled web app |
| `@openchamber/sdk@2.5.1` at `~/.bun/install/cache/@openchamber/sdk@2.5.1@@@1/` | Manifest, iframe protocol, host API, service contract |
| `~/.config/openchamber/extensions/` | Real installed extensions: Excalidraw, Kanban, Resource Monitor |
| `~/.config/openchamber/extensions.json` | Install paths, capability grants, service scopes, storage ids |
| `~/.config/openchamber/agent-tool/` | Built-in OpenCode plugin: `openchamber`, `openchamber_render`, `openchamber_knowledge`, `openchamber_notify` |
| [Build an extension](https://docs.openchamber.dev/sdk) | Author guide |
| [Host API](https://docs.openchamber.dev/sdk/host/) | Method contracts and limits |
| [Use extensions](https://docs.openchamber.dev/extensions/) | Install, permissions, update, pause, remove |
| [MCP Servers](https://docs.openchamber.dev/mcp/) | Where MCP servers are configured |
| [Browser Panel](https://docs.openchamber.dev/desktop-browser/) | Rendering, annotation, agent control |
| [Agent Control Tool](https://docs.openchamber.dev/agent-control-tool/) | Built-in agent tools and their limits |
| [Changelog 2.5.1](https://openchamber.dev/changelog/) | Local URLs open in the browser panel; MCP servers idle out after 15 minutes |

Facts below are marked **Verified** when they come from the SDK package, the installed app, or the docs. Unmarked behavior is planned or needs a probe before the plan relies on it.

## 2. Four separate surfaces

The word "extension" hides four different mechanisms. They install separately and have separate permissions.

| Surface | What it is | Who installs it | What it can do |
|---|---|---|---|
| Extension panel | A sandboxed HTML page on the right rail | Settings, Extensions | Draw UI, read context, call host methods |
| Extension service | A Node process the host starts for the extension | Declared in the manifest, approved at install | Anything the user can do, on loopback |
| MCP server | A separate process that gives the agent tools | Settings, MCP or `opencode.json` | Read and write what its code allows |
| Chat tool card | Manifest `contributes.tools` | Part of the extension manifest | Change how a tool call is drawn, no code |

The important separation for Canvas:

- The gallery is an extension panel.
- The store and viewer are a service and a viewer daemon.
- The agent tools are an MCP server.
- The chat card is a presentation rule in the extension manifest.

An extension manifest cannot register an executable agent tool. OpenCode plugins can register tools directly, while MCP is another supported mechanism. Neither mechanism draws a rail panel; that remains the OpenChamber extension's responsibility.

## 3. Package and install

**Verified.** An extension is a folder with at least:

```text
package.json          manifest, including the openchamber block
panel/index.html      the page OpenChamber shows
panel/main.js         a classic IIFE, built by the author
```

OpenChamber never compiles TypeScript. It serves the built `.js` file as it sits in the package. A service entry must also be built JavaScript:

```text
service/main.js
```

Build commands from the SDK:

```bash
bunx openchamber-guest-bundle panel/main.ts panel/main.js
bunx openchamber-guest-bundle --node service/main.ts service/main.js
```

Any bundler that emits an IIFE works. The panel iframe cannot load ES modules.

### Install paths

| Path | Behavior |
|---|---|
| Folder | Runs from the real folder. Edit, rebuild, reload. No update check. |
| Zip | Copied to `{dataDir}/extensions/{id}`. No update check. |
| Git URL | Copied to the data folder. Settings checks for a newer `version` about once an hour. |
| SSH Git URL | Same as Git, with a selected Git identity. |

The 2.5.1 changelog adds a Browse button on the Extensions page that opens the community catalog.

### Install checks

**Verified.** Install fails when:

- `version` is missing or not semver.
- `apiVersion` is not `1`.
- `engines.openchamber` is newer than the running app.
- A declared entry HTML file or its relative scripts are missing.
- `panel.icon` names an `.svg` that is missing.
- A declared `service.entry` is missing.
- `panel.id` does not match `^[a-z][a-z0-9-]*$`. Single-word ids are valid; excalidraw ships `"id": "excalidraw"`. Every failure in `inspectGuestPackage` (a missing `package.json` in the selected folder included) returns the same `invalid-manifest` code, which the Add dialog shows as one generic "panel.id must be kebab-case" toast. Select the package folder itself, not its parent.

### MCP registration reach

Settings → MCP in OpenChamber 2.5.1 writes entries into the user-layer OpenCode config: `mcp.servers` in the v2 shape (or a legacy v1 `mcp.<name>`), into the file resolved as `OPENCODE_CONFIG`, else `$OPENCODE_CONFIG_DIR` or `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode/opencode.json(c)` (verified in the installed app's `@openchamber/web/server/lib/opencode/mcp.js` and `config-v2.js`). OpenChamber always writes the v2 shape.

A panel cannot read the filesystem, so Canvas's extension service reads those files read-only for the extension (`service/mcp-registration.ts`, `/mcp-registration`): it strips JSONC comments and trailing commas, tolerates raw control characters in strings, matches entries whose `command` ends at the installed `mcp/server.js`, and covers only the user layer. Project-scope registrations live in a project's `.opencode/opencode.json`, which the service cannot attribute to the panel's project, and are out of reach. The MCP heartbeat still answers "is the server alive": the server only runs while an agent request needs it.

### Lifecycle

| Event | Behavior |
|---|---|
| Install | Catalog row is written, capability approval dialog appears |
| Approve | Grants are stored in `extensions.json` |
| Enable | Panel, service, actions, commands, tools become available |
| Pause | Panel hidden, service stopped, calls return `DISABLED`; grants stay |
| Update | Git installs only; new capabilities trigger a new approval |
| Remove | Panel and storage removed; folder install leaves the folder |

## 4. Manifest surfaces

**Verified.** The `openchamber.contributes` block accepts these keys:

| Key | Purpose | Limit |
|---|---|---|
| `panel` | Rail entry, identity, optional `entry`, `dock`, `size` | One |
| `background` | Hidden HTML for actions and commands | One |
| `page` | Full-screen page opened from the Extension pages menu | One |
| `statusSection` | Section in the chat Work Status panel | One |
| `fileEditors` | Editor for matching file names in Files | 8 editors, 16 patterns each |
| `attach` | Entry in the `+` menu or a dialog | One |
| `actions` | Message and session menu actions | 8 |
| `commands` | Slash commands that attach an item | 8 |
| `tools` | How tool calls are drawn in chat | 16 |
| `capabilities` | Permissions the user approves | `prompt`, `sessions`, `files`, `model`, `shells` |
| `service` | Local process the host starts | One |
| `integration` | Account card and `host.request` origin | One |
| `filesystem` | Paths outside the project the page may read or write | 16 patterns |
| `origins` | HTTPS origins the page may fetch | 8 |

A panel entry is optional. Without `panel.entry`, the extension still has an identity for Settings and approval, but no rail icon. With no panel and no background entry, it can only declare `tools`.

`page` and `attach` require a visible panel. `statusSection` and `fileEditors` are separate frames and do not require one.

## 5. The iframe contract

**Verified.**

- The panel runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`. Its origin is opaque.
- The server sends a guest frame policy with `sandbox allow-scripts`.
- The page may load scripts, styles, images, fonts, media, workers, and frames only from its own package, or from `data:` and `blob:`.
- `connect-src` is limited to the guest's own package path. `fetch` cannot reach the network or the OpenChamber API.
- Declared `origins` add approved HTTPS origins to `fetch`, images, fonts, styles, and media, never to `script-src`.
- The page talks to the host through `connectHost()` over `postMessage`. Calls time out after 20 seconds as `HOST_TIMEOUT`.
- Host pushes: `onReady`, `onDirectory`, `onSession`, `onSessionLifecycle`, `onConnection`, `onSettings`, `onItem`.
- The page never receives an integration token, the service token, or the service port.

### Methods relevant to Canvas

| Method | Capability | Use in Canvas |
|---|---|---|
| `openUrl(url)` | none | Open a view URL in the browser panel |
| `openSurface(surfaceId)` | none | Show a host surface or `plugin:<panel id>`; verify the plugin form in P2 |
| `toast`, `writeClipboard` | none | Feedback and copy actions |
| `storage.get/set/delete/keys` | none | Gallery preferences; 64 KiB per value, 2 MiB namespace |
| `attach(item)` | none | Put an artifact chip on the chat box |
| `prompt({ text, send })` | `prompt` | Not used in v1; `compose` writes the instruction instead |
| `listProjects`, `listSessions`, `openSession` | `sessions` | v1.1 optional; v1 groups by directory |
| `readFile`, `writeFile`, `listDir`, `stat` | `files` or `filesystem` | Export into the project, if needed |
| `generate` | `model` | Optional title or summary generation |
| `onRunningShells`, `readShellOutput` | `shells` | Not needed for Canvas |
| `serviceRequest` | `service` | Every store and viewer call from the gallery |

`openUrl` needs no capability. In the desktop app, a local address (`localhost`, `127.0.0.1`, `[::1]`) opens in the browser panel when a project or chat is open. Other addresses follow the user's chat link setting.

## 6. Capabilities

**Verified.** The user approves the full list once at install. A newer version that asks for more triggers a new dialog. A call outside the grant fails with `NOT_GRANTED`.

| Capability | What it allows |
|---|---|
| `prompt` | Send messages in the current session |
| `sessions` | List projects, worktrees, sessions; create and open sessions |
| `files` | Read and write inside the open project |
| `model` | One-off text with the user's Small Model |
| `shells` | Watch and stop background shell commands |
| `service` | Added when `contributes.service` exists; runs a local process |
| `filesystem` | Added when `contributes.filesystem` exists |
| `origins` | Added when `contributes.origins` exists |
| `network` | Added when `contributes.integration` exists |
| `conversation` | Added when a session action asks for messages |

The service runs with the user's full access and no sandbox. The approval dialog says this in plain words. The `exec` and `sockets` lists are advisory intent, not an OS sandbox.

## 7. Local service contract

**Verified.**

```text
panel (iframe) --serviceRequest--> host --HTTP 127.0.0.1:port--> service process
```

### Manifest

```json
{
  "service": {
    "entry": "service/main.js",
    "runtime": "host",
    "permissions": {
      "exec": ["git"],
      "sockets": []
    }
  }
}
```

`runtime` currently accepts only `"host"`.

### Spawn

- The first `serviceRequest` starts the process.
- The host uses its own runtime: `process.execPath` with `ELECTRON_RUN_AS_NODE` on desktop. A system `node` is not required.
- The host binds an ephemeral loopback port and passes `OPENCHAMBER_SERVICE_PORT` and `OPENCHAMBER_SERVICE_TOKEN`.
- The service inherits only PATH, HOME, temp, locale, and Windows system variables. API keys and the UI password are not passed.
- The host polls `GET /health` with `Authorization: Bearer <token>` until HTTP 200, with a 15 second timeout.
- The service must bind `127.0.0.1` only. Never `0.0.0.0`.
- The panel never sees the token or the port. Only the host proxy talks to loopback.

### Lifecycle

| Event | Behavior |
|---|---|
| Install | Service is listed, not spawned |
| Approve | `service` grant is written |
| First request | Spawn, wait for health, proxy |
| Panel open | Status via `serviceStatus` |
| Service crash | Status `failed`; next request respawns |
| Pause | Service stopped |
| Uninstall | SIGTERM, then kill |
| Host quit | All guest services killed |
| Host crash | Service keeps running until the next host start, which kills it |

### Limits

- `serviceRequest` response is capped at 8 MB. A larger answer is `RESPONSE_TOO_LARGE` and the whole body is dropped.
- The request timeout is 20 seconds.
- There is no streaming call from the panel to the service. A service cannot push events to the panel through `serviceRequest`.
- Error codes: `NO_SERVICE`, `DISABLED`, `SERVICE_FAILED`, `REQUEST_FAILED`, `RESPONSE_TOO_LARGE`, `HOST_TIMEOUT`, `HOST_REJECTED`, `BAD_PATH`.

### Roles

A service can declare a host role:

- `provides: ["browser"]` answers the agent's twelve `browser.*` actions. The user picks it in Settings, OpenChamber Tools, Browser provider.
- `provides: ["source-control"]` adds a Git host next to GitHub, GitLab, Gitea, Forgejo, Gerrit.
- `surface: true` shows a live picture in the rail, with pointer, keyboard, paste, and a hand-back-to-agent control.

Canvas does not need a host role. The gallery panel is enough.

## 8. MCP and OpenCode

**Verified by the OpenCode MCP contract and the OpenChamber docs.**

- MCP servers are configured in Settings, MCP, with personal or project scope, or directly in `opencode.json`.
- OpenCode starts local servers over stdio.
- OpenChamber does not load or host MCP servers. It renders the tool calls in chat.
- Tool names are prefixed with the server name. A server named `canvas` with a tool named `publish` becomes `canvas_publish` to the model.
- `contributes.tools` matches the name OpenCode reports, such as `mcp.canvas.*`. It changes the icon, title, subtitle, and output layout. It adds no behavior.
- The MCP process lifetime follows the project's OpenCode session. The 2.5.1 changelog says a project that is left alone frees its MCP servers after 15 minutes. A view URL served by the MCP process dies with it.

This is why Canvas needs a separate viewer process that outlives the MCP server. The MCP should write the store and ensure the viewer is running, not serve HTML from its own listener.

## 9. Browser panel

**Verified.**

- The desktop browser panel is a real browser with persistent logins, DevTools, reload, hard reload, zoom, device presets, and a light/dark override.
- Annotation is desktop-only. It attaches element, region, or freehand marks plus a screenshot and the user's note to the chat message.
- The annotate machinery is Electron renderer code, not an extension surface. The Files pane and the browser panel share one embedding component (`contextPanel.mode.files` and `contextPanel.mode.browser` in the renderer bundle); the markup toggle (`contextPanel.browser.annotate.*`) lives in the same bundle, which references a `webview`-style embedding, `executeJavaScript` injection, and `capturePage` screenshots. The picker overlay runs inside the embedded page itself; nothing of it is reachable from a sandboxed extension iframe or artifact viewer.
- The agent can drive the panel with the `openchamber_web` tool: open, snapshot, click, type, scroll, back, forward, inspect, capture, resize.
- The 2.5.1 changelog confirms that a local address opened by an extension opens in the browser panel.
- Clipboard reads work only for a focused page on the literal `localhost` hostname. Pages on `127.0.0.1` or `[::1]` cannot read the clipboard through JavaScript.
- The web app can display a page in the panel but cannot annotate or drive it.
- Remote instances: the panel runs on the client, while the extension service runs on the server. A server loopback URL is not reachable from the client panel.

## 10. What an extension cannot do

| Cannot | Consequence for Canvas |
|---|---|
| Register an executable agent tool from the extension manifest | The agent integration is registered separately in OpenCode |
| Run code in the OpenChamber app origin | Artifact HTML never runs in the gallery |
| Fetch arbitrary URLs from the panel | All data goes through `serviceRequest` or declared `origins` |
| Stream from a service to the panel | The gallery polls; the viewer page can use SSE to the viewer daemon |
| Load in VS Code or mobile | Canvas is web and desktop only |
| Open a full-screen page from code | The user opens it from the Extension pages menu |
| Read the clipboard on `127.0.0.1` | Use `localhost` in view URLs if clipboard matters, or provide a runtime copy action |
| Modify OpenChamber config without a grant | Do not write `opencode.json` from the extension |
| Auto-install the MCP server | The user adds it in Settings, MCP |

## 11. Build and package checklist

1. `package.json` has `version`, `openchamber.apiVersion: 1`, `engines.openchamber`, and a `contributes` block.
2. `panel/index.html` loads `./main.js` with a normal script tag.
3. `panel/main.js` is a classic IIFE.
4. `service/main.js` is built JavaScript and binds `127.0.0.1`.
5. The service answers `GET /health` with the bearer token within 15 seconds.
6. The service reads `OPENCHAMBER_SERVICE_PORT` and `OPENCHAMBER_SERVICE_TOKEN`.
7. The extension icon is a Remixicon name or a package `.svg`.
8. The zip or git package contains built files, not `node_modules` or TypeScript sources.
9. Every declared path stays inside the package.
10. The capability list is the smallest one the feature needs.
11. The gallery never injects artifact HTML with `innerHTML`.
12. The service never logs the token, the view token, or artifact bodies.
13. Test a folder install, a zip install, and a git install.
14. Test pause, uninstall, and an extension update that adds a capability.

## 12. Canvas manifest sketch

This is the planned shape, not an implemented file.

```json
{
  "name": "openchamber-canvas",
  "version": "0.1.0",
  "openchamber": {
    "apiVersion": 1,
    "engines": { "openchamber": ">=2.5.1" },
    "contributes": {
      "panel": {
        "id": "canvas",
        "name": "Canvas",
        "icon": "artboard",
        "entry": "panel/index.html"
      },
      "page": {
        "entry": "panel/page.html",
        "title": "Canvas gallery"
      },
      "statusSection": {
        "entry": "status/index.html",
        "title": "Canvas",
        "height": 76,
        "requiresProject": true
      },
      "service": {
        "entry": "service/main.js",
        "runtime": "host"
      },
      "tools": [
        {
          "match": "mcp.canvas.*",
          "name": "Canvas",
          "icon": "artboard",
          "title": "{input.title}",
          "subtitle": "{output.kind} v{output.version}",
          "output": "markdown"
        }
      ]
    }
  }
}
```

`service` adds the `service` capability automatically. The panel needs no other capability. Feedback and refine use `host.compose`, which needs none. The MCP tools are not in this file. They are installed in Settings, MCP.

## 13. Probes for Canvas

These probes answer the platform questions the plan depends on.

| Probe | Question | Pass condition | Fallback |
|---|---|---|---|
| P1 | Does `host.openUrl` on a loopback view URL open the desktop browser panel? | Panel opens, not the system browser | Use a clickable link and document the system browser |
| P2 | Does `host.openSurface('plugin:canvas')` open the gallery panel? | Panel opens | Do not rely on it |
| P3 | Does the gallery panel stay mounted while the browser panel is shown? | Heartbeat continues | Gallery cannot auto-follow; agent opens |
| P4 | Does a sandboxed view page run inline canvas, SVG, and wasm under the planned CSP? | All three run | Remove wasm, keep scripts |
| P5 | Does browser panel annotation work on a loopback page? | Annotation available | Accept no annotation; do not drop the sandbox |
| P6 | Does a detached viewer daemon survive an MCP restart and serve the same URL? | URL still loads after the MCP exits | Use MCP-scoped URLs and document expiry |
| P7 | Does `localStorage` throw in the sandboxed view? | Throws, as expected | Provide the `canvas.storage` shim |
| P8 | Does `connect-src` on the explicit viewer origin, with CORS `Origin: null`, let the view page use `fetch` and `EventSource`? | Fetch, SSE, and feedback work | Disable the runtime and keep the gallery; do not widen `connect-src` |
| P9 | What tool name does OpenCode report for a server named `canvas`? | `canvas_publish`, not `canvas_canvas_publish` | Rename the server or tools |
| P10 | How long does an MCP server live after the project goes idle? | Measured, not guessed | Viewer daemon is mandatory |
| P11 | Does the panel see a non-loopback `location.hostname` on a remote instance? | Yes | Use a service health probe and a warning |
| P12 | Can a single-file HTML artifact be served with `sandbox allow-scripts` and still use the injected runtime? | Runtime loads and feedback works | Inline the runtime into the served HTML |

## 14. References

- [Build an extension](https://docs.openchamber.dev/sdk)
- [Host API](https://docs.openchamber.dev/sdk/host/)
- [UI kit](https://docs.openchamber.dev/sdk/ui/)
- [Use extensions](https://docs.openchamber.dev/extensions/)
- [MCP Servers](https://docs.openchamber.dev/mcp/)
- [Browser Panel](https://docs.openchamber.dev/desktop-browser/)
- [Agent Control Tool](https://docs.openchamber.dev/agent-control-tool/)
- [OpenChamber roadmap](https://openchamber.dev/roadmap)
- [MCP specification: tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers)

## 15. Native extension UI audit

Inspected on 2026-10-23 against the installed `@openchamber/sdk@2.5.1` and Canvas commit `4656110`. The working tree was clean at the start of the audit. Upstream `main` documentation describes the design intent; the installed SDK declarations and implementation determine which APIs Canvas can use. The findings describe that pre-migration commit; the resolution below records the current state.

Sources:

- [UI kit guide](https://docs.openchamber.dev/sdk/ui/).
- [Official SDK Playground](https://github.com/openchamber/openchamber/blob/main/packages/sdk/examples/hello-kit/panel/main.ts) and [task workspace](https://github.com/openchamber/openchamber/blob/main/packages/sdk/examples/tasks-demo/panel/workspace.ts).
- [OpenChamber UI guidance](https://github.com/openchamber/openchamber/blob/main/.agents/skills/openchamber-ui-guidance/SKILL.md) and [surfaces](https://github.com/openchamber/openchamber/blob/main/.agents/skills/openchamber-ui-guidance/references/surfaces.md).
- [Theme roles](https://github.com/openchamber/openchamber/blob/main/.agents/skills/theme-system/references/tokens-and-examples.md).
- Installed SDK `dist/ui/index.d.ts`, `style.js`, `theme.js`, `list.js`, `select.js`, and `menu.js`.

Findings:

- At commit `4656110`, Canvas imported `applyHostReady` but did not mount any SDK controls. Its custom controls therefore did not receive the kit's appearance and interaction rules.
- Use `mountButton`, `mountSearchField`, `mountSelect`, `mountMenu`, `mountList`, `mountTextField`, `mountTabs`, `mountBadge`, `mountBanner`, `mountSpinner`, `mountEmpty`, and `mountSeparator` wherever those primitives fit. Keep the returned handles, call `update` for controlled values, and call `dispose` when removing a control.
- SDK controls are the supported extension equivalents of the app's internal React controls. Importing private app components or copying their Tailwind styles is not the extension integration path.
- The default SDK action is a tinted button, not Canvas's custom solid primary fill. Fields, buttons, triggers, and menus have app-owned depth and theme-specific treatment. Layout stays flat; status banners use a tint without a border. Focus uses the native control treatment, not an additional Canvas ring.
- `applyHostReady` supplies surface/foreground pairs and computed `--oc-primary-text`, `--oc-success-text`, `--oc-warning-text`, `--oc-error-text`, and `--oc-info-text`. Base accent/status colors are fills, not interchangeable text colors. Selection uses selection tokens, not primary.
- Apply every ready snapshot, but do not rebuild the screen for a theme-only or session-only snapshot. Keep mounted fields, drafts, focus, selection, and request state intact.
- The kit's `mountList` supports title, subtitle, leading text, meta, badge, and selection. It has no arbitrary row-action slot or grid-card API. The kit also has no public dialog primitive or icon-button property. Those limits do not justify recreating supported controls. Compose unsupported layout around real SDK buttons, and use decorative inline SVG icons inside labelled SDK controls where an icon helps; keep the existing native dialog with SDK actions.
- Guest storage is `host.storage`, not browser `localStorage`. The latter is unavailable under the extension's opaque-origin sandbox.
- At audit time, `tsconfig.json` omitted `panel/` and `status/`. A disposable extended-config check found two nullable-root errors and one SVG-versus-HTMLElement error in `panel/main.ts`; the ordinary typecheck had not checked these files.

Probe result: a disposable browser probe using the installed SDK in an `allow-scripts` iframe verified controlled search/select/field values, keyboard list selection, menu Escape, theme changes without remounting, draft/focus retention, and no horizontal overflow at 320px. Its light/dark tokens were synthetic API fixtures, not evidence that every actual OpenChamber palette has been visually accepted. The probe source was removed after the audit.

### Resolution

Commit `a4911b2` implements the migration. The panel, setup view, and Work Status section mount `mountButton`, `mountSearchField`, `mountSelect`, `mountMenu`, `mountList`, `mountTextField`, `mountBadge`, `mountBanner`, `mountEmpty`, and `mountSpinner`. Decorative inline SVG icons sit inside labelled controls and custom section headings. Custom CSS is limited to composition the kit lacks. View/sort preferences use `host.storage`; `panel/` and `status/` are in `tsconfig.json`; the three errors are fixed.

`tests/browser/panel.browser.ts` serves the built panel and status entries in an opaque iframe with a mock host. It verifies AC-037 through AC-042, six official resolved palette snapshots, a host font/radius override, theme-only snapshots without refetch or remount, retained draft/focus, disposal, menus, dialog, setup, empty, error/retry, grid, 320px rail, 720px wide panel, and 1200px page/setup/empty layouts. `bun run test:browser` is the entry point. Installed-app visual acceptance remains pending.

## 16. Native OpenCode tools update

Verified on 2026-10-30 against OpenCode 2.2.0, its published plugin types, the installed OpenChamber agent plugin, and the native Canvas regression tests. This section supersedes the Canvas-specific MCP installation and heartbeat design earlier in this note.

### How the built-in tools work

The installed `~/.config/openchamber/agent-tool/openchamber-agent-tool/index.js` exports an OpenCode plugin. Its setup registers tools with `ctx.tool.transform`, supplying descriptions, JSON input schemas, options, and executors. The executor sends authenticated HTTP requests to OpenChamber with the session ID and call ID. Tool registration is executable infrastructure, separate from any additional prompt instructions. OpenCode can expose a registered tool directly or through Code Mode.

This is different from an extension's `contributes.tools`. That manifest field changes tool-call presentation only. An extension manifest does not register arbitrary executable tools, nor does installing an OpenChamber extension automatically authorize an OpenCode plugin.

### Canvas 0.3.0 registration

The Canvas package exports its built `plugin/index.js`. The user merges the installed package directory into OpenCode V2 configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/installed/canvas"]
}
```

Configured local plugin entries must be directories. The package's exports select its built entry. There is no required runtime SDK import or node_modules in the installed bundle. The development dependency `@opencode/plugin@2.2.0` checks its types. OpenCode reloads watched configuration; `/reload` is available when necessary.

The plugin registers namespace `canvas` and the six operations. Effective names remain `canvas_publish`, `canvas_update`, `canvas_list`, `canvas_read`, `canvas_archive`, and `canvas_result`; Code Mode exposes the namespace as `tools.canvas`. Each operation declares an OpenCode permission action. Native errors retain serialized Canvas codes/details in their message; successful text results contain JSON.

Each call resolves `ctx.session.get({ sessionID })` and uses `session.location.directory`, rather than process.cwd() or the plugin's setup location. Session `subpath` records a path relative to the project for indexing; it must not be appended again. Session provenance comes from the invocation. Explicit alternate directories remain available for deliberate cross-project operations.

### Runtime and cancellation findings

OpenCode's compiled executable is not interchangeable with `node` when launched as `process.execPath`. The detached viewer launch sets `BUN_BE_BUN=1` under Bun and retains `ELECTRON_RUN_AS_NODE=1` for Electron. An actual-OpenCode cold-start regression fetches a working view URL; testing under Node or against an already-running viewer would miss this boundary.

Invocation signals reach session/viewer requests and store lock acquisition. Cancelled update, archive, and dedupe waiters cannot acquire their lock later and mutate. Once the atomic write begins, it completes; cancellation does not remove a committed artifact. Once a detached viewer is spawned, startup remains serialized until readiness or timeout despite caller cancellation. The cancelled call may wait for that bounded startup; it cannot permit a second daemon to start in the gap. The viewer remains independent of plugin reload and unload.

### Setup and verification limits

Canvas no longer scans OpenCode configuration or writes an MCP heartbeat. Setup provides exact plugin JSON/path and a sample prompt that is composed for review, never sent. It does not claim to know which plugins a session loaded. Work Status lists artifacts without an inferred tool connection badge.

The isolated real-host test proves package loading, effective names, session lookup, executor behavior, and cold-start viewing without a model request. Its observer invokes the registered executor directly. It does not prove model/Code Mode selection, permission rejection, OpenChamber tool-card matching, or installed desktop routing. Those remain explicit user acceptance checks in FEAT-001 AC-073.

Sources: [OpenCode plugin overview](https://opencode.ai/v2/docs/build/plugins), [server tools](https://opencode.ai/v2/docs/build/plugins/server#tools), [plugin configuration](https://opencode.ai/v2/docs/plugins), [`src/plugin/index.ts`](../../src/plugin/index.ts), [`tests/plugin.test.ts`](../../tests/plugin.test.ts).
