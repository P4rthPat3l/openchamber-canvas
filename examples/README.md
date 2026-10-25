# Authoring Canvas artifacts

Use these source files as starting points, not as automatically installed artifacts:

- `chart.html` uses the pinned `chartjs` library. Its table and chart share one dataset.
- `diagram.html` defines nodes and flows once. Focused SVG views, the complete table, and selection details derive from that graph. Nodes support Enter and Space; flow-table buttons provide keyboard access to every flow.
- `mockup.html` demonstrates an accessible form, runtime storage, and structured feedback. It never changes a real account.

Publish from the project root, keeping project ownership separate from the source subdirectory:

```json
{
  "title": "Property enquiries",
  "filePath": "examples/chart.html",
  "directory": "/home/parth/Production/openchamber-canvas",
  "libraries": ["chartjs"]
}
```

Use `canvas.publish`. Omit `libraries` for the diagram and mockup. Never load scripts or styles from a CDN. `window.canvas` provides storage and feedback in the sandbox; browser `localStorage` is unavailable. Do not put secrets or real customer information in example content.

Use `data-theme` for light/dark appearance. Keep a textual equivalent for charts and diagrams. Generate the drawing, labels, table, and details from the same data rather than maintaining separate copies. Split dense graphs into focused views and keep a complete table as the reference.

To revise, call `canvas.read`, edit the source file, then call `canvas.update` with `filePath` and the returned `baseVersion`. A metadata-only update needs only `id`, `baseVersion`, and `title` or `tags`. Changed-content dedupe publishing also needs `baseVersion`.

Feedback is saved, not automatically sent to an agent. The gallery's Add feedback to chat action puts selected records in the composer for review. An explicitly opened version is a fixed snapshot; opening the artifact without a version follows new revisions.

Exports contain the authored source files. The viewer-injected runtime and pinned library files are not bundled into a standalone export. A chart export needs its declared library to render outside Canvas.
