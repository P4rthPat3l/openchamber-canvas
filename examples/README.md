# Authoring Canvas artifacts

Use these source files as starting points, not as automatically installed artifacts:

- `design-system.html` is the fallback tokens-and-primitives reference when the project has no system.
- `chart.html` uses bundled Chart.js and one dataset for its bars and table.
- `diagram.html` derives focused views, a complete table, and keyboard-accessible details from one graph.
- `mockup.html` demonstrates validation, pending/retry behavior, storage, and feedback. It never changes a real account.
- `report.html` is a static decision/investigation starter. Content remains readable without scripts.

The plugin registers the bundled [`canvas-authoring`](../skills/canvas-authoring/SKILL.md) skill. Load it before authoring. Choose the reader's scenario, then read its focused reference and closest starter. Keep one canonical project-local source; installed examples are not the source directory for another project's artifact.

Inspect the project's design language first: CSS variables, Tailwind/theme config, components, Storybook, or design docs. Use its full system. Otherwise these starters already carry the fallback foundations and viewer-seeded Light/Dark switcher. They share tokens and controls, not identical layouts. Do not assemble a new system for each artifact. See the [artifact design rules](../docs/design/artifact-design-system.md).

## Preview, then promote

Use this payload with `canvas_preview`, or `tools.canvas.preview` through Code Mode:

```json
{
  "title": "Property enquiries",
  "filePath": "examples/chart.html",
  "libraries": ["chartjs"]
}
```

Source paths must be inside the invoking project. Omit `directory` for that project; an explicit directory selects project ownership, not a scratch output folder. Copy/adapt an installed starter into the actual project before previewing it. Omit libraries except for the chart starter. No CDN, external font, image, or open-network dependency is allowed.

Complete source preflight and check the returned preview `viewUrl` in the actual renderer. Inspect a narrow/wide view and both themes together, including relevant interactions. Fix concrete failures in the canonical source as one batch, create another preview, and use at most one normal confirmation pass.

After checks pass, call `canvas_publish` with a title and the tested `previewId`. Do not send the source again. Canvas promotes frozen source and rendering, not a reread of a changed local file. Publish one complete artifact; do not publish intermediate drafts. Direct source publication remains supported if preview is unavailable, with actual-runtime checks afterward where possible.

Previews expire after 30 minutes, belong to their invoking project/session, and never appear in the gallery. Their state and feedback are disposable and never promoted. An expired preview needs another verified snapshot. No browser means rendering remains unverified; a URL is not a successful check. Preserve a published artifact ID on viewer warnings rather than blindly publishing again.

## Revise safely

Read the existing artifact, edit its canonical source, and preview the complete revised snapshot with the target kind and libraries. Update the same ID with `previewId` and the read response's `version` as `baseVersion`. Promotion is full replacement, not a partial bundle merge. Direct file/merge/edit inputs remain supported. Batch requested changes into one update. Metadata-only updates need only ID, base version, and title/tags. Conflicts require a reread and reconciliation.

## Runtime and export

`window.canvas` provides storage and feedback inside the sandbox. Browser `localStorage` is unavailable. Use validated `type="button"` actions, never native form submission. Feedback is saved, not automatically sent to an agent. Published feedback can be added to the composer for user review through the gallery.

Keep Light/Dark switches per-view. Generate chart/diagram drawings and textual equivalents from one dataset. Do not invent data, put customer records into examples, or add fake application states to static reports.

An explicitly opened version stays fixed; opening an artifact without a version follows revisions. Exports contain authored files only, not the viewer-injected runtime or pinned libraries. A chart export needs its declared library outside Canvas.
