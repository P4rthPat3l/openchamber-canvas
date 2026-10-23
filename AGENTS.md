# Project conventions

Feature documentation lives in `docs/features/`. Read the relevant feature document before changing a feature. Platform research lives in `docs/research/`. Read `openchamber-extension-platform.md` before changing the extension manifest, the service contract, or the MCP setup.

## Status

This repository is in Phase 5 built, manual acceptance pending. The artifact store, view policy, viewer server, runtime, pinned libraries, MCP server, extension service, gallery panel, status section, and extension manifest exist. The Phase 0 blocking probes pass.

## Stack

- TypeScript, no `any`.
- Bun 1.4 for scripts, bundling, and tests.
- Node 24 runtime for the MCP server and the extension service. Both ship as bundled ESM or CJS files, because OpenChamber never compiles extensions.
- `@openchamber/sdk` for the panel, the service contract, and the guest bundler.
- `@modelcontextprotocol/sdk` for the MCP server.
- No UI framework. Use the OpenChamber UI kit from `@openchamber/sdk/ui`.

## Commands

Phase 1 commands:

```bash
bun run typecheck
bun run lint
bun test
bun run build
```

`lint` is a typecheck alias until a linter is added. `build` builds the viewer server and runtime, and copies the pinned libraries into `viewer/libraries/`.

## Hard rules

- Artifact HTML is untrusted. It runs only in the browser panel, never in the extension page, never with `eval` in the host page, never through `innerHTML` in the gallery.
- The view response keeps `sandbox allow-scripts`. `connect-src` may name only the viewer daemon origin (`http://127.0.0.1:<port>` or `http://localhost:<port>`), never the app origin and never the open network. Changes to `src/viewer/policy.ts` need the security tests.
- The service and the viewer daemon bind `127.0.0.1` only. No `0.0.0.0`.
- The viewer daemon is the only process that serves artifact HTML. The MCP server writes the store and ensures the viewer; it does not serve a second copy.
- Never remove `sandbox allow-scripts` from the view response to make annotation or storage work. Use the runtime shim, or accept the limitation.
- Store paths are validated against the store root. No `..`, no symlink escape.
- The extension asks for the `service` permission only. Do not add `filesystem`, `sessions`, or `prompt` without a documented reason.
- The service token and view tokens are never logged, never sent to the panel, and never placed in artifact HTML.
- Do not modify OpenChamber's installation or configuration outside the project folder. The extension and MCP server are installed by the user.

## Local paths

- Project: `/home/parth/Production/openchamber-canvas`
- Store: `~/.config/openchamber/artifacts`
- Installed OpenChamber: `/opt/OpenChamber`
- OpenChamber data: `~/.config/openchamber`

## Plan changes

If a probe or an implementation discovery invalidates the plan, stop and update the feature document before continuing. Do not improvise around a failed assumption.
