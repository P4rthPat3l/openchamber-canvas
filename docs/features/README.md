# Feature documents

| ID | Feature | Status | Implementation | Document |
|---|---|---|---|---|
| FEAT-001 | OpenChamber Canvas | Active | 0.5.0 artifact design system; 0.4.0 bundled authoring skill; user-reported working | [FEAT-001-openchamber-canvas.md](FEAT-001-openchamber-canvas.md) |

FEAT-001 includes [security and revision hardening](FEAT-001-openchamber-canvas.md#37-security-and-revision-hardening), built in package 0.2.0 with acceptance criteria AC-050 through AC-065. Installed-app acceptance is pending.

The [native OpenCode plugin replacement](FEAT-001-openchamber-canvas.md#38-native-opencode-plugin-replacement) is built, with AC-066 through AC-073. It removes MCP rather than maintaining two adapters. Automated tests include real OpenCode cold-start viewing; the user reported the installed preview working. Model-selection and full agent-loop acceptance remain manual.

The [bundled authoring skill](FEAT-001-openchamber-canvas.md#39-bundled-canvas-authoring-skill) ships in 0.4.0, with AC-074 through AC-078. AC-079 tightens its preflight, publish-once, and batched-correction guidance after observed publish-as-preview churn. Native skill loading, lifecycle, relocated distribution, and regression checks pass. The user reported the preview build working. Actual model selection, paired authoring trials, and full installed-app acceptance remain unverified.

The [artifact design system](FEAT-001-openchamber-canvas.md#40-artifact-design-system) ships in 0.5.0, with AC-080 and AC-081. It adds a project-first fallback, a reference example, and a per-view Light/Dark switcher.

Every feature document uses stable section numbers, stable rule IDs, and the status vocabulary `Current`, `Planned`, `Inferred`, `Unknown`.

Research that supports a feature lives in `docs/research/`:

| Document | Purpose |
|---|---|
| [openchamber-extension-platform.md](../research/openchamber-extension-platform.md) | Native OpenCode tools, extension/service/browser boundaries, and historical MCP research |
| [artifact-product-landscape.md](../research/artifact-product-landscape.md) | What Claude, Claude Code, Cowork, OpenAI Canvas, and VS Code MCP Apps do |
