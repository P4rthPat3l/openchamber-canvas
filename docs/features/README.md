# Feature documents

| ID | Feature | Status | Implementation | Document |
|---|---|---|---|---|
| FEAT-001 | OpenChamber Canvas | Active | 0.3.0 native plugin built; installed acceptance pending | [FEAT-001-openchamber-canvas.md](FEAT-001-openchamber-canvas.md) |

FEAT-001 includes [security and revision hardening](FEAT-001-openchamber-canvas.md#37-security-and-revision-hardening), built in package 0.2.0 with acceptance criteria AC-050 through AC-065. Installed-app acceptance is pending.

The [native OpenCode plugin replacement](FEAT-001-openchamber-canvas.md#38-native-opencode-plugin-replacement) is built, with AC-066 through AC-073. It removes MCP rather than maintaining two adapters. Automated tests include real OpenCode cold-start viewing; installed-app and agent-loop acceptance remain pending.

Every feature document uses stable section numbers, stable rule IDs, and the status vocabulary `Current`, `Planned`, `Inferred`, `Unknown`.

Research that supports a feature lives in `docs/research/`:

| Document | Purpose |
|---|---|
| [openchamber-extension-platform.md](../research/openchamber-extension-platform.md) | Native OpenCode tools, extension/service/browser boundaries, and historical MCP research |
| [artifact-product-landscape.md](../research/artifact-product-landscape.md) | What Claude, Claude Code, Cowork, OpenAI Canvas, and VS Code MCP Apps do |
