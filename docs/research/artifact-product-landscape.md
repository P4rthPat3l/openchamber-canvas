# Artifact product landscape

Status: research. Sources checked on 2026-10-23.

This document records what other products do with agent-generated artifacts, and which of those patterns fit OpenChamber Canvas. It is the second reference for FEAT-001.

## 1. Scope

The products fall into three groups:

- Chat artifacts: Claude artifacts, Claude Cowork live artifacts, OpenAI Canvas.
- Coding-session artifacts: Claude Code artifacts.
- Tool-attached UI: VS Code MCP Apps.

OpenChamber's own surfaces are included because Canvas has to fit beside them, not replace them.

## 2. Claude artifacts in chat

Source: Anthropic help center, "What are artifacts and how do I use them?", updated October 2026.

### What it does

- A panel opens beside the conversation.
- Artifact kinds include documents, code, single-page HTML, images, diagrams, dashboards, and small interactive tools.
- Templates: Docs, Slides, Design, Dashboards (beta), Motion (beta).
- Version history. Every edit creates a version. The user can step back.
- Publish creates a public URL. Anyone with the link can view it. A Claude user can copy or remix it.
- Persistent storage, up to 20 MB per artifact, text only. Personal or shared.
- Connectors: an artifact can read and write connected apps such as Asana, Google Calendar, and Slack. The user approves the tools on first use.
- Artifacts can call Claude on Anthropic's infrastructure. The viewer signs in with their own account.
- Direct editing in docs, slides, and design canvases. "Edit with Claude" rewrites only the highlighted text.
- Export: Word, PDF, Markdown, Google Docs, PowerPoint, Google Slides, HTML, zip, MP4.
- A gallery tab lists every artifact.
- Error state: "Try fixing with Claude" copies the error into a new message.

### What is strong

- The artifact is persistent and findable. It is not trapped in a message.
- Version history is always present, so experimentation is safe.
- The artifact can hold state across sessions.
- The artifact can reach the user's connected tools.
- Templates give a non-coder a starting point.

### What is weak or out of scope for Canvas

- Publishing and remixing depend on Anthropic's cloud. Canvas is local-first.
- Shared storage and team collaboration are cloud features.
- The docs, slides, design, and motion editors are large products. Canvas should not build them in v1.
- Storage is 20 MB and text only. Canvas can store files on disk without that limit.

## 3. Claude Code artifacts

Source: Anthropic help center and Claude Code docs, plus product reporting from June 2026.

### What it does

- Claude Code publishes session output as a live page at a private URL.
- The page updates in place as the session continues. A viewer watching a long task sees it change without reloading.
- Each artifact keeps version history and lives in a gallery.
- Team and Enterprise users can share with the organization. The owner can always share the latest version or pin a version.
- The artifact is built from the full session context: codebase, connectors, conversation.
- Example artifacts: a pull request walkthrough with annotated diffs, a dashboard from session data, an investigation timeline.

### What to borrow

- Live update in place. This is the single most important behavior Canvas lacks.
- Session provenance. An artifact knows which session made it.
- Gallery plus version history.
- A "latest version" default and a way to pin a version.

### What to skip in v1

- Team sharing and organization permissions. Canvas is single-user and local.
- A hosted private URL. Canvas uses a loopback URL and the browser panel.

## 4. Claude Cowork live artifacts

Source: Anthropic help center and product reporting from April 2026.

### What it does

- Persistent interactive HTML dashboards saved in the Cowork sidebar under "Live artifacts".
- Connected to apps and files through MCP.
- Refreshes with current data when opened.
- The dashboard is a view over live data, not a snapshot.

### What to borrow

- Live sources. A dashboard should read a CSV, JSON file, or log file when it opens.
- A "last refreshed" timestamp.
- Refresh on open, plus a manual refresh button.
- A source list the user can inspect.

### What to change for Canvas

- Cowork uses cloud MCP connectors. Canvas should start with local files under the project, because that is where the user's data already lives.
- A command source can run a local script, but it needs explicit user approval. Do not let artifact HTML declare a command at runtime.

## 5. OpenAI Canvas

Source: OpenAI's launch post, January 2025, and 2026 reporting on its retirement.

### What it did

- A side-by-side writing and coding surface.
- Direct edits to text or code.
- Shortcuts such as adjust length, debug code, port to another language, and code review.
- Version restore with a back button.
- Sharing a canvas asset.

### What happened

- OpenAI removed Canvas from GPT-5.5 Instant and Thinking in May 2026. Writing and coding moved into inline "writing blocks" and "code blocks" in the chat.
- Reporting describes Canvas as effectively retired once the legacy models sunset.

### Lesson

A separate editor is expensive to maintain and easy to replace with inline blocks. The durable value is not the editor. It is persistence, versioning, and integration with the work. Canvas should not build a WYSIWYG editor. It should make the agent's output durable and reopenable.

### What to borrow

- Version restore.
- Targeted edits: select a region or text, then ask the agent to change only that.
- A clear preview and code/source toggle.

## 6. VS Code MCP Apps

Source: VS Code MCP developer guide, 2026.

### What it does

- A tool returns a `_meta.ui.resourceUri` that points to a `ui://` resource with MIME type `text/html;profile=mcp-app`.
- The host renders the HTML in a sandboxed iframe.
- The app uses the MCP Apps SDK to talk to the host.
- The resource declares `connectDomains`, `resourceDomains`, and `frameDomains`.

### What to borrow

- Declarative network and resource domains. Canvas should declare its runtime library set and its local data sources instead of allowing arbitrary URLs.
- A sandboxed UI attached to a tool result.
- The idea that a tool result can carry a live view rather than only text.

### Difference from OpenChamber

OpenChamber's `contributes.tools` only changes presentation. It cannot render HTML in a chat card. The closest Canvas can do is return a Markdown link to the view URL. The browser panel is the live view.

## 7. OpenChamber's own surfaces

### `openchamber_render`

The built-in tool draws one page inside a chat message.

- Bounded by the message width, about 720 px on desktop and 360 px on phones.
- Full inline JavaScript, inline SVG, and a base stylesheet with theme tokens.
- Local images by absolute path, up to 12 per page, 10 MB each.
- `awaitAnswer` lets the page collect a choice and return JSON to the agent.
- No persistence, no gallery, no version history. The page scrolls away with the chat.

Canvas should complement it:

- `openchamber_render` for an answer that belongs in the reply.
- Canvas for an artifact the user will reopen, annotate, iterate on, or share with a teammate.

### Browser panel

- Desktop-only annotation, agent control, DevTools, device presets, and light/dark override.
- It already renders loopback pages from extensions.
- It is the viewer for Canvas. Canvas should not build its own browser chrome.

### Roadmap: Canvases

OpenChamber's roadmap lists Canvases as planned: "For an analysis or a report, the agent builds charts, tables and diagrams in a panel next to the chat."

#### Status on 2026-10-23

- The roadmap places Canvases under **Planned**, not **In progress**. The in-progress items are Accounts and Settings Sync, Isolated Workspaces, and Mobile App.
- Canvases is the first item under Planned. That is the only ordering signal. There is no date.
- There is no public milestone, branch, pull request, issue, or design document for the feature. A GitHub search for "canvases" returns two bug reports about rendered pages, not a design.
- The repository has no `canvases` or `artifacts` store or panel. The only related code is the inline render tool.

#### What is already shipped

The rendering layer is substantial. It is scoped to a chat message, not a panel.

| Release | Date | What shipped |
|---|---|---|
| 2.3.3 | 2026-10-14 | `openchamber_render`: a chart, table, diagram, or mockup above the answer; theme variables; full screen; HTML download; a Settings toggle |
| 2.4.0 | 2026-10-17 | Local images and screenshots in a rendered page; a mockup can take the project's look |
| 2.5.0 | 2026-10-19 | "Annotate page" on rendered pages and HTML files in Files; selection quoting |
| 2.5.1 | 2026-10-23 | A local address opened by an extension opens in the browser panel |

The code paths:

- `packages/ui/src/components/chat/message/parts/HtmlRenderFrame.tsx` draws the sandboxed frame, handles the theme, full screen, download, annotation, selection, and the answer bridge.
- `packages/ui/src/components/chat/message/parts/htmlRender.ts` builds the page bootstrap, theme variables, chart palette, link handling, selection, marks, and `openchamber.submit`.
- `packages/ui/src/components/chat/message/parts/renderPageImages.ts` and `packages/web/server/lib/openchamber-control/render-page.js` handle local images, the 200,000 character HTML cap, the 25 MB image budget, and the answer payload.
- `packages/ui/src/lib/renderPageAnswer.ts` sends the `awaitAnswer` result back to the waiting tool call.

Missing for a built-in Canvases:

- A persistent store keyed by canvas id.
- A panel next to the chat that stays open.
- A list or gallery of canvases.
- Version history.
- An update-by-id path, so the agent can revise an existing canvas instead of rendering a new page.
- Project scoping and reopen after a restart.

#### What it will provide

Official: charts, tables, and diagrams in a panel next to the chat, for an analysis or a report.

Inferred from the name and the shipped render tool:

- A persistent side panel rather than a page that scrolls away.
- More than one canvas, since the name is plural.
- Reuse of the sandbox, theme variables, full screen, annotation, and export already built for `openchamber_render`.
- Agent updates to an open canvas, because the render tool already has a live page and a message bridge.

Unknown:

- A gallery or project filter.
- Version history and restore.
- Feedback from the canvas to the agent.
- Markdown, PDF, image, or multi-file bundles.
- Sharing, publishing, or export formats beyond HTML.
- Whether it is a new panel or a mode inside the browser panel.

#### What this means for Canvas

The hard rendering and safety work is done. The product layer is not public. Do not wait for a date. Build the extension now, and focus on what a built-in panel is least likely to cover:

- A project gallery that survives restarts.
- Versions, restore, and compare.
- A feedback channel from the artifact to the agent.
- Bundles, Markdown, images, PDF, and local data.
- Export and session provenance.

Keep the store open and documented. If the built-in feature ships, it may cover the basic panel and the extension can become the richer gallery or a compatibility layer. If it never ships, the extension is the feature.

This is both validation and risk. Canvas should:

- Ship before the built-in feature, as a bridge.
- Keep the store format open and documented so a built-in Canvases feature can read it later.
- Avoid a proprietary database or a cloud dependency.
- Be ready to become a compatibility layer or a richer gallery on top of the built-in surface.

## 8. Feature matrix

Legend: yes, partial, no.

| Product | Persistent | Gallery | Versions | Live update | Live data | Agent feedback | Share or publish | Local-first | Multi-file | Export | Templates | Storage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude artifacts | yes | yes | yes | partial | yes | partial | yes | no | no | yes | yes | 20 MB |
| Claude Code artifacts | yes | yes | yes | yes | yes | no | yes | no | partial | partial | no | no |
| Cowork live artifacts | yes | yes | partial | yes | yes | no | partial | no | no | partial | no | no |
| OpenAI Canvas (historical) | yes | no | yes | no | no | no | yes | no | no | partial | no | no |
| OpenChamber `openchamber_render` | no | no | no | no | no | yes (`awaitAnswer`) | no | yes | no | no | no | no |
| OpenChamber Canvas (target) | yes | yes | yes | yes | yes (local) | yes | export only | yes | yes | yes | yes | local shim |

## 9. What to borrow

### Must have in v1

- Persistent store and gallery.
- Version history, restore, and compare.
- Live update in place when the agent calls `canvas_update`.
- A feedback channel from the artifact to the agent.
- Export to a file the user can open or commit.
- Search, tags, and favorites.
- Project and session provenance.
- A fixed set of bundled runtime libraries so artifacts do not need a CDN.

### Should have in v1.1

- Multi-file bundles with assets.
- Markdown, image, and PDF artifact kinds.
- Thumbnails.
- Templates that compose a prompt into the chat.
- Duplicate an artifact as a starting point.
- Local file sources for live dashboards.
- A storage shim for artifacts that need state.
- Selection-to-agent editing.

### Later

- Data dashboard kind with a chart spec.
- Slides or deck runtime.
- Shared artifacts between projects.
- Team sharing or a static export server.
- Collaboration and comments.

### Do not build

- A WYSIWYG document editor.
- A cloud publishing service.
- A design-system editor.
- Video or motion generation.
- A replacement for the chat.

## 10. Positioning

Canvas is the durable, local artifact layer for OpenChamber. It takes what the agent made, keeps it on disk, shows it in the browser panel, and lets the user reopen, annotate, version, and update it. It does not publish to a cloud, and it does not try to edit the artifact for the user. The agent stays the editor. The user gets a project asset.

The closest comparison is Claude Code artifacts. The main differences are local storage, project-aware grouping, the browser panel with annotation, local data sources, and a feedback loop that runs through the user's own session.

## 11. References

- [Claude artifacts help](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)
- [Claude Code artifacts](https://code.claude.com/docs/en/artifacts)
- [Claude Cowork live artifacts](https://support.claude.com/en/articles/14729249)
- [OpenAI Canvas launch](https://openai.com/index/introducing-canvas)
- [OpenAI Canvas retirement reporting](https://felloai.com/chatgpt-canvas)
- [VS Code MCP Apps](https://code.visualstudio.com/api/extension-guides/ai/mcp)
- [OpenChamber roadmap](https://openchamber.dev/roadmap)
- [OpenChamber Browser Panel](https://docs.openchamber.dev/desktop-browser/)
- [OpenChamber Agent Control Tool](https://docs.openchamber.dev/agent-control-tool/)
- `openchamber_render` tool description in `~/.config/openchamber/agent-tool/openchamber-agent-tool/index.js`
