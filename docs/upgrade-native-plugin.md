# Switch an existing Canvas installation to the native plugin

Canvas 0.3.0 replaces its MCP server with an OpenCode plugin. It requires OpenCode 2.2.0 or newer. There is no MCP compatibility server in this release.

1. Update or reload the Canvas extension so its service and Setup page use the new package.
2. Remove or disable your old Canvas registration in Settings → MCP. If you registered it directly in a configuration file, remove only that Canvas entry. Keep other MCP servers and settings.
3. Open Canvas → Setup and copy the plugin configuration. Merge the exact installed package directory into your existing OpenCode `plugins` array. Do not point it at `plugin/index.js` or the removed `mcp/server.js`.
4. OpenCode watches its configuration. Use `/reload` if the tools have not appeared, then send Setup's sample prompt after reviewing it.
5. Confirm the six `canvas_*` tools are available, open an existing artifact, and ask the agent to read and revise a test artifact using its current `baseVersion`.

The gallery and plugin should use the same installed package directory and the same store. The default store remains `~/.config/openchamber/artifacts`. Existing artifacts, versions, feedback, runtime storage, and pinned rendering snapshots do not need conversion. Removing an MCP registration must not delete that store.

Neither the extension nor the plugin edits your configuration automatically. A project-scoped plugin is available only in that project's applicable configuration. The Setup page cannot certify that a particular session has loaded the plugin; test it in the intended chat.

If you must return to the previous release, restore that package and its previous MCP configuration yourself. Do not rewrite the artifact store.
