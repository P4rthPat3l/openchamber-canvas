# Canvas authoring preflight research

Status: research. Executed against the working tree on 2026-11-07. Existing user changes to the design-system reference and its browser tests were present. No clean verification commit is claimed.

## Question and boundary

Can an agent verify an artifact in the actual Canvas renderer before creating a published artifact or adding a published version? Can publication preserve the tested source and rendering dependencies without copying preview state or feedback?

This investigation reads installed authoring guidance and artifact metadata. All probe writes, browser actions, and promotion tests use disposable stores under `/tmp/opencode`. No installed extension, external configuration, or existing artifact was changed.

## Authoring evidence

- The installed `canvas-authoring` skill loaded through the normal skill tool. Its source matched `skills/canvas-authoring/SKILL.md` byte for byte. This rules out a stale skill for this session, not for every earlier authoring run.
- The live store contained 40 artifacts, with 14 owned by this repository. Recent metadata from other projects included six versions within 4.6 minutes, four within 1.2 minutes, and three within 3.8 minutes. The read-only inventory used `node:fs/promises` and `parseMeta`; it did not initialize or write the live store.
- A few source-session conversation excerpts were inspected. Some revisions followed explicit requests to change the explanation or perspective. One report had one user request and multiple closely spaced versions before its completion response. The message-list tool exposes conversation text, not complete executor traces. These observations cannot establish whether every version came from a runtime failure, a cosmetic change, or a skipped skill.
- The maintained skill already prohibits publish-as-preview. Its tests assert wording and resource availability. Existing authoring cases have not been run as paired model evaluations.
- The chart, diagram, and mockup starters have independent styling. Their README asks agents to replace those styles and add the fallback header and switcher. They are technical examples, not ready-to-use examples of the advertised shared system.

No customer details, artifact source bodies, view tokens, or session excerpts are retained in this record.

## Executed renderer probe

Command, run from this repository where Bun, Playwright, and its dependencies exist:

```bash
bun run scripts/.canvas-authoring-probe.ts
```

The repository had no `.env` files. The script explicitly supplied every writable store root and the installed runtime/library paths. It imported the real `ArtifactStore`, `createViewerServer`, and `installedRendering` implementations, and launched `/usr/bin/google-chrome` through Playwright.

The first execution failed with `ENTRY_NOT_FOUND: A bundle needs an entry file`. The script had omitted the existing store's required bundle `entry`. Adding `entry: 'index.html'` corrected the probe input. No product code changed.

The successful run returned:

```json
{"probe":"PASS","runtime":"actual Canvas server and pinned runtime","chartjs":true,"darkTheme":true,"sandboxOnEntryAndSecondary":true,"sandboxStorageBlocked":true,"candidateStateAndFeedbackWork":true,"publishedStoreEmptyBeforePromotion":true,"promotionPreservesFileHashesAndRendering":true,"changedLocalSourceIgnored":true,"promotedVersions":1,"promotedStateAndFeedbackEmpty":true,"scriptErrors":0,"outsideRequests":0,"limit":"Isolated-store feasibility only. No preview tool, shared-daemon routing, expiry, or scoped preview tokens implemented."}
```

The candidate was an immutable snapshot in a disposable, separate store. The existing viewer served its entry and secondary HTML with the normal sandbox. In Chrome, the pinned Chart.js library rendered, the injected runtime seeded dark theme, runtime storage and feedback worked, and browser `localStorage` remained blocked. The destination store was empty at this point.

The script then changed the original local HTML file and published from the candidate's stored file bytes. It constructed the destination store's rendering source from the candidate's pinned rendering directory. The resulting artifact had identical file records and rendering hash, one version, empty state, and no feedback. It did not reread the changed local file.

The source script, disposable stores, and the directory left by the failed execution were removed after investigation.

## What this proves and what it does not

The existing renderer can execute an isolated candidate, and the existing snapshot format can supply the tested file bytes and rendering dependencies for publication. A new browser engine or relaxed sandbox is unnecessary.

The probe temporarily used the existing artifact-store layout inside scratch space. It did not implement a product preview capability or prove that a hidden preview store and the published store can share the detached daemon safely. Namespace-scoped tokens, ownership checks, expiration, cleanup versus promotion races, retry handling, shared-daemon routing, cancellation, and relocated-package registration need implementation tests before shipping.

Desktop panel routing was not exercised. This investigation does not measure model selection, authoring time, visual quality, or reduced version counts after a change.

## Proposed next step

See [FEAT-001 section 41](../features/FEAT-001-openchamber-canvas.md#41-preview-first-authoring-and-scenario-starters) for the proposed implementation boundary and acceptance criteria. Its preview contract remains planned until approved and implemented.
