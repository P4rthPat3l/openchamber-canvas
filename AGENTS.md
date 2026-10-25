# Project conventions

Feature documentation lives in `docs/features/`. Read the relevant feature document before changing a feature. Platform research lives in `docs/research/`. Read `openchamber-extension-platform.md` before changing the extension manifest, the service contract, or the MCP setup.

## Status

The 0.2.0 security/revision hardening is built. The extension is installed at an older release; installed-app acceptance is pending. The shared store, sandboxed viewer, pinned rendering snapshots, MCP/service contracts, feedback handoff, paginated gallery, status section, and authoring examples exist.

## Stack

- TypeScript, no `any`.
- Bun 1.4 for scripts, bundling, and tests.
- Node 24 runtime for the MCP server and the extension service. Both ship as bundled ESM or CJS files, because OpenChamber never compiles extensions.
- `@openchamber/sdk` for the panel, the service contract, and the guest bundler.
- `@modelcontextprotocol/sdk` for the MCP server.
- No UI framework. Mount the public `@openchamber/sdk/ui` components for buttons, fields, search, selects, menus, lists, badges, banners, empty states, spinners, and separators. Custom CSS and plain HTML are only for composition the installed kit lacks: responsive split, grid, version metadata, setup/status layout, and the native dialog frame.

## Commands

Phase 1 commands:

```bash
bun run typecheck
bun run lint
bun test
bun run test:browser
bun run build
```

`lint` is a typecheck alias until a linter is added. `build` builds the panel, status, service, MCP, viewer, and runtime, copies libraries into `viewer/libraries/`, and hashes them into `viewer/build.json`. `test:browser` builds and tests the panel/status entries, bundled Node viewer/runtime, and examples; it requires `/usr/bin/google-chrome` and Node. Browser stores/screenshots use `/tmp/opencode`.

## Hard rules

- Artifact HTML is untrusted. It runs only in the browser panel, never in the extension page, never with `eval` in the host page, never through `innerHTML` in the gallery.
- Every served HTML document needs the sandbox policy, including secondary bundle documents. An entry-only policy lets link navigation escape isolation. Native form submission is blocked; use a button with validation and `canvas.feedback`, never add `allow-forms`.
- Rendering snapshots live under `.rendering/<sha256>` in the store. Version manifests reference them; restore preserves the source reference. Legacy manifests have no reference and must stay visibly unpinned. Never silently replace missing/tampered pinned dependencies with installed ones.
- Require `baseVersion` for all content mutations, including replacements and changed-content dedupe. Metadata-only updates do not create versions or notify following views.
- A daemon's build identity is captured at startup. Do not accept health alone as compatibility or reread an updated package version as the running build. Only the known authenticated shutdown protocol may stop a daemon; never kill a PID read from an untrusted/stale port file.
- SDK checkboxes are controlled. Feed `checked` back through `handle.update` in `onChange`, just as fields need their value updated. Feedback delivery means successful composer insertion, not sending or reading.
- The view response keeps `sandbox allow-scripts`. `connect-src` may name only the viewer daemon origin (`http://127.0.0.1:<port>` or `http://localhost:<port>`), never the app origin and never the open network. Changes to `src/viewer/policy.ts` need the security tests.
- The service and the viewer daemon bind `127.0.0.1` only. No `0.0.0.0`.
- The viewer daemon is the only process that serves artifact HTML. The MCP server writes the store and ensures the viewer; it does not serve a second copy.
- Never remove `sandbox allow-scripts` from the view response to make annotation or storage work. Use the runtime shim, or accept the limitation.
- Use the public `@openchamber/sdk/ui` controls rather than recreating buttons, fields, search, selects, menus, lists, badges, banners, empty states, or feedback. Do not import private OpenChamber React components or override kit control geometry, colors, shadows, type, selection, or focus. Decorative inline SVG icons may sit inside a mounted kit button or menu trigger and in custom section headings; they must not replace a kit control or change its geometry. Custom CSS is only layout the kit lacks.
- Apply `applyHostReady` on every host ready snapshot. Do not rebuild mounted controls for a theme-only snapshot; call `update` for controlled values and `dispose` when removing a view.
- Use `host.storage`, not `localStorage`, for panel preferences. The extension iframe has an opaque origin.
- Store paths are validated against the store root. No `..`, no symlink escape.
- The extension asks for the `service` permission only. Do not add `filesystem`, `sessions`, or `prompt` without a documented reason.
- Bundles run one level below the package root (`mcp/`, `service/`, `viewer/`) while sources run two levels below (`src/<area>`). Paths resolved from `import.meta.url` must work in both, as `src/mcp/version.ts` does. A path that only works from source breaks the installed app at startup.
- The service token and view tokens are never logged, never sent to the panel, and never placed in artifact HTML.
- Do not modify OpenChamber's installation or configuration outside the project folder. The extension and MCP server are installed by the user.
- `opencode.json` is managed by OpenChamber and is not tracked. The extension bundles `mcp/server.js` but cannot register an MCP server. The user adds it in Settings → MCP. The setup page shows the exact config.

## Local paths

- Project: `/home/parth/Production/openchamber-canvas`
- Store: `~/.config/openchamber/artifacts`
- Built MCP: `/home/parth/Production/openchamber-canvas/mcp/server.js`
- Installed OpenChamber: `/opt/OpenChamber`
- OpenChamber data: `~/.config/openchamber`

## Plan changes

If a probe or an implementation discovery invalidates the plan, stop and update the feature document before continuing. Do not improvise around a failed assumption.
