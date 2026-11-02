# Canvas artifact design system

Scope: the HTML artifacts the agent creates. This is not the gallery panel, the viewer chrome, or the OpenChamber SDK surface.

## Rule

Use the project's design system when it has one. Inspect CSS custom properties, Tailwind or theme config, component styles, Storybook, and design documentation. Map its colors, type, spacing, radii, shadows, and motion into the artifact's own semantic tokens. Keep the artifact self-contained. If the project has local fonts or images, bundle them; never add a remote font or CDN dependency.

If the project has no design system, start from [`examples/design-system.html`](../../examples/design-system.html). Keep its tokens and primitives. Do not mix a partial project system with the fallback. One system per artifact.

The chart, diagram, and mockup examples remain focused pattern references and are not restyled in this pass. When reusing one, replace its local style block with the project system or the fallback, and add the fallback header and Light/Dark switcher required by the preflight.

## Direction

The fallback is an Anthropic-inspired editorial system, not a copy of Anthropic's interface. Warm paper ground, deep ink, a restrained rust accent, a serif display voice, a workhorse system sans for body copy, quiet one-pixel rules, modest radii, and soft offset shadows. The palette stays restrained: warm neutrals plus one accent, with semantic state colors used only where they carry meaning.

This is the default for reports, dashboards, diagrams, and mockups. It is deliberately calmer than a marketing page and denser than an article. The artifact should read as a working document first.

## Tokens

| Token | Light | Dark | Role |
|---|---|---|---|
| `--canvas-bg` | `#f3efe7` | `#171411` | Page ground |
| `--canvas-surface` | `#fffdf8` | `#201c17` | Cards, inputs, table |
| `--canvas-surface-2` | `#ebe4d7` | `#29241d` | Callouts, status, inset areas |
| `--canvas-ink` | `#211f1b` | `#f3eee5` | Primary text |
| `--canvas-muted` | `#6c655b` | `#b9b0a2` | Secondary text |
| `--canvas-line` | `#d8cfbf` | `#3b342b` | Quiet dividers |
| `--canvas-line-strong` | `#b4a894` | `#5b5143` | Callout borders |
| `--canvas-control` | `#8a7c68` | `#8f806c` | Input and secondary-button border, at least 3:1 on ground and surface |
| `--canvas-accent` | `#b85c3b` | `#e08a66` | Decorative accent and focus detail |
| `--canvas-accent-strong` | `#8c3e25` | `#f0a888` | Text links and quiet actions |
| `--canvas-accent-soft` | `#f1dcd0` | `#3b261d` | Selection and soft accent |
| `--canvas-action` | `#8c3e25` | `#e08a66` | Primary action fill |
| `--canvas-action-ink` | `#fffdf8` | `#171411` | Primary action text |
| `--canvas-success` | `#2f6b4f` | `#8fc9a7` | Success text and mark |
| `--canvas-success-soft` | `#dcebe2` | `#1d3226` | Success badge surface |
| `--canvas-warning` | `#855714` | `#e0b66f` | Warning text and mark |
| `--canvas-warning-soft` | `#f3e5c5` | `#382b16` | Warning badge surface |
| `--canvas-danger` | `#923b3b` | `#e59a9a` | Error text and mark |
| `--canvas-danger-soft` | `#f2dada` | `#3a1d1d` | Danger badge surface |
| `--canvas-focus` | `#2f5f7a` | `#8fc7e0` | Focus ring |
| `--canvas-radius-sm` | `6px` | `6px` | Inputs, buttons, swatches |
| `--canvas-radius` | `10px` | `10px` | Panels and callouts |
| `--canvas-radius-lg` | `18px` | `18px` | Feature card |
| `--canvas-shadow` | `0 1px 2px rgb(33 31 27 / 6%), 0 14px 36px rgb(33 31 27 / 8%)` | `0 1px 2px rgb(0 0 0 / 30%), 0 18px 44px rgb(0 0 0 / 28%)` | Raised surfaces |

The state text tones are chosen to clear 4.5:1 on their tinted backgrounds. Body and muted text clear 4.5:1 on both grounds.

## Type

- Display and section headings: `ui-serif, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`.
- Body and controls: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.
- Code and measurements: `ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace`.
- Display size: `clamp(2.5rem, 6vw, 4.8rem)`, line-height below 1, tracking no tighter than `-0.035em`.
- Body measure: 65 to 75 characters. Headings balance; paragraphs use pretty wrapping.
- Use tabular numerals for quantities.

## Primitives

- Page shell: one centered column, 72rem maximum, 2rem side gutters on small screens.
- Section head: heading on the left, a short note on the right. Stack on narrow screens. No eyebrow or kicker.
- Panel: a quiet surface for foundations and supporting content. One-pixel border, no heavy shadow.
- Card: a raised surface for one concrete object. Use it once or twice, not as the page structure.
- Badge: a tinted pill with a small dot, a text label, and a semantic tone. Never color alone.
- Callout: a tinted surface with a one-pixel border, a strong label, and a short explanation. No colored left rail.
- Table: a real table with a caption, scoped headers, quiet row rules, and tabular numerals in numeric columns.
- Form: a label above each native control, a clear focus ring, and a disabled state. Buttons use a verb that names the action.
- Status: a muted inline message for saved, pending, empty, or error states.

## Theme switcher

Every new artifact declares light and dark tokens and includes a visible two-button Light/Dark switcher in its header.

- Seed the control from `document.documentElement.dataset.theme`, which the viewer sets.
- Set `data-theme` on the root and update `aria-pressed` on each button.
- Use a `role="group"` with an accessible name.
- Do not use `localStorage`.
- Keep the switch per-view. Do not persist a theme that overrides the viewer on the next open.
- Style selection, focus, caret, scrollbars, and tabular numerals from the palette.

## Constraints

- No CDN scripts, remote fonts, external images, or open-network requests.
- Do not copy the gallery's SDK controls. The artifact has its own visual language.
- Do not copy a project's private components. Recreate the visual language with local HTML and CSS.
- Check both themes in the real viewer, at a narrow and a wide width, before publishing.
- Respect reduced motion. Decorative motion is optional; state changes must not depend on it.
- Keep the artifact readable without JavaScript. Scripts add behavior, not the primary content.

## Verification

`tests/browser/examples.browser.ts` serves `design-system.html` through the built viewer in light and dark, checks the seeded switcher state, computed page and surface tokens, and keyboard activation, and fails on outside requests or script errors. `tests/skill.test.ts` checks that the authoring skill links the fallback, requires project-first detection, and requires a light/dark switcher. The browser check covers the reference example only. It does not prove how a model will apply the system to a new artifact.
