# Upgrade Canvas to the host-managed plugin

Canvas 0.7.0 requires OpenChamber 2.7.0 or newer. OpenChamber loads the Canvas plugin into its OpenCode while the extension is enabled and approved, so there is no `plugins` entry to add. This guide covers an update from any earlier Canvas release, including the 0.3.0 MCP replacement.

1. Update or reload the Canvas extension.
2. Approve `service` and `opencodePlugin`.
3. If Canvas 0.6.0 or earlier is registered, remove its package directory from the OpenCode `plugins` array in `~/.config/opencode/opencode.json` or the project configuration. Do not add a replacement entry.
4. If a Canvas entry remains in Settings → MCP from 0.2.0, remove it. Keep other MCP servers and settings.
5. Open Canvas → Setup. Confirm the installed package path and the managed delivery statement, then review and send the sample prompt.
6. Confirm the seven `canvas_*` tools are available and open an existing artifact.

The default store remains `~/.config/openchamber/artifacts`. Existing artifacts, versions, feedback, runtime storage, and pinned rendering snapshots do not need conversion. Neither the extension nor Setup writes your OpenCode configuration.

OpenChamber reports the delivery state on the Extensions card. If the managed config does not reach the OpenCode in use, use Add to global config there, or restart the OpenCode that OpenChamber runs. Sessions in isolated spaces do not receive the plugin. Setup cannot certify that a session has loaded it; test it in the intended chat.

To return to 0.6.0, reinstall that version and re-add the installed package directory to the `plugins` array. Setup keeps showing the package path. Do not rewrite the artifact store.
