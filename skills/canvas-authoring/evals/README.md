# Authoring evaluation protocol

These are task fixtures, not proof of model behavior. Paired model evaluations have not been run. The deterministic tests verify resources and instruction contracts; browser tests verify the implementation and shipped starters.

## Cases and setup

| Case | Setup and purpose |
|---|---|
| simple-chart | Empty project with no design system. Verify supplied values and fallback styling. |
| visual-report | Empty project. Verify a static report without fake app states. |
| revise-existing | Seed one Release readiness artifact in the isolated store. Capture its ID and base version. No deployed system is involved. |
| project-style | Copy `project-style/project.css` into the isolated project root. Verify the agent uses that system rather than the warm fallback. |
| long-label-flow | Empty project. Verify focused architecture flow, long labels, and keyboard/text equivalents. |
| empty-data | Empty project. Verify honest empty metrics, not invented observations or a zero chart. |

Use a fresh isolated project, artifact store, viewer port file, and session for every run. Explicitly set `CANVAS_STORE` and `CANVAS_VIEWER_PORT_FILE` in the test host. Register the built package in that isolated host only. Supply native Canvas tools, the normal skill loader, file tools, and the same browser capability to both variants. Prompt frontmatter describes the task budget; it is not an executable tool-permission configuration. Do not run these against existing user artifacts or change installed configuration.

Compare baseline and candidate with the same model, model settings, prompt, fixtures, viewport/theme matrix, and browser availability. Repeat each case rather than trust a single successful generation. The baseline is the unmodified authoring package, not a candidate run with extra reminders removed from the user prompt. Do not silently add coaching to only one variant.

## Score the actual trace

Record skill loading and whether it happened before source authoring, the selected scenario/reference, design-system evidence, preview calls, publish calls, content update calls, duplicate artifact IDs, tool errors/retries, elapsed wall time, and available token/cost data. Count metadata-only updates separately. Record whether later updates followed a user request or an observed defect.

Check correctness against the task's supplied values and facts. Inspect source and actual rendering, including narrow/wide views and both themes. Record visual hierarchy, readability, overflow, keyboard access, and interaction results with screenshots. Review the artifact's explanation for the intended audience, not just its CSS. Fewer versions alone do not establish quality or productivity.

For the preview-capable candidate, expect checks before promotion of the tested previewId, normally one publication or one update of the existing artifact, and no open-ended cosmetic loop. A preview URL or an agent's claimed pass is not browser evidence. An unavailable browser must be reported as an unverified result, not a pass. Fail a run that fabricates facts, loses requested content, publishes known-broken work, or reduces counts by skipping checks.

Preserve the trace and screenshots outside the source tree without credentials or signed viewer URLs. Summarize counts and observed failures. Report distributions of elapsed time and publication/update counts across repeated runs, plus the number of artifacts passing correctness and visual review. Do not claim improvement before those runs exist.

## Baseline available today

The 2026-11-07 read-only investigation found recent artifacts with six versions in 4.6 minutes, four in 1.2 minutes, and three in 3.8 minutes. The currently installed skill matched the checkout. Conversation excerpts do not reveal every executor call or establish why each version changed. This is observational evidence of closely spaced versions, not a controlled model baseline or a measured before/after improvement. The full boundary and isolated renderer probe are documented in the repository's `docs/research/canvas-authoring-preflight.md`.
