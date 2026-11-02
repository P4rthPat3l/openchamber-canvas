# Authoring Canvas artifacts

Use these source files as starting points, not as automatically installed artifacts:

- `chart.html` uses the pinned `chartjs` library. Its table and chart share one dataset.
- `diagram.html` defines nodes and flows once. Focused SVG views, the complete table, and selection details derive from that graph. Nodes support Enter and Space; flow-table buttons provide keyboard access to every flow.
- `mockup.html` demonstrates an accessible form, runtime storage, and structured feedback. It never changes a real account.

The Canvas OpenCode plugin registers the bundled [`canvas-authoring`](../skills/canvas-authoring/SKILL.md) skill. Load it through the normal skill tool before creating or revising an artifact. It points to these installed examples, so no separate skill installation or template download is needed. Read only the example that fits the task and keep one canonical project-local source; installed examples are reference material, not the source folder for a different project's artifact. Complete the skill's preflight before the first publish. Publish one complete artifact, then verify the actual view; use `canvas_update` only for a concrete defect or a user-requested change, and batch related fixes into one update.

Publish from the project root, keeping project ownership separate from the source subdirectory:

```json
{
  "title": "Property enquiries",
  "filePath": "examples/chart.html",
  "directory": "/home/parth/Production/openchamber-canvas",
  "libraries": ["chartjs"]
}
```

Use the native `canvas_publish` tool, or `tools.canvas.publish` through OpenCode Code Mode. The plugin supplies the calling session's directory when you omit `directory`. Omit `libraries` for the diagram and mockup. Never load scripts or styles from a CDN. `window.canvas` provides storage and feedback in the sandbox; browser `localStorage` is unavailable. Do not put secrets or real customer information in example content.

Use `data-theme` for light/dark appearance. Keep a textual equivalent for charts and diagrams. Generate the drawing, labels, table, and details from the same data rather than maintaining separate copies. Split dense graphs into focused views and keep a complete table as the reference.

To revise, call `canvas_read`, edit the source file, then call `canvas_update` with `filePath` and the read response's `version` as `baseVersion`. Batch all requested changes into one update; do not publish an intermediate draft. A metadata-only update needs only `id`, `baseVersion`, and `title` or `tags`. Changed-content dedupe publishing also needs `baseVersion`.

Feedback is saved, not automatically sent to an agent. The gallery's Add feedback to chat action puts selected records in the composer for review. An explicitly opened version is a fixed snapshot; opening the artifact without a version follows new revisions.

Exports contain the authored source files. The viewer-injected runtime and pinned library files are not bundled into a standalone export. A chart export needs its declared library to render outside Canvas.
