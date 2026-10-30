# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

OpenChamber users working with an agent on a project. They ask for a chart, dashboard, report, mockup, or diagram, then reopen it, compare versions, give feedback, and ask the agent to change it. The same person uses the rail panel for a quick look and the full-screen page for a longer session.

## Product Purpose

Canvas is the project gallery for artifacts the agent creates. It keeps each artifact as a durable, versioned object rather than a transient chat card, opens the real HTML in OpenChamber's browser panel, and returns user feedback to the agent. Success means a user can find the artifact again, open the right version, and continue the work without leaving OpenChamber.

## Positioning

Artifacts live in the project's store, not in a chat transcript. They keep sandboxed JavaScript, DevTools, versions, and feedback, while the agent gets publish, read, update, and result tools. Native annotation is not supported on sandboxed artifact pages. The viewer is local and served by a detached loopback daemon.

## Operating Context

The user works in an OpenChamber project with the agent in the main chat. The extension panel sits on the right rail and can open full-screen. The gallery calls the extension service for reads, view URLs, export, and feedback. A native OpenCode plugin registers the six Canvas operations in the OpenCode server. Both share `~/.config/openchamber/artifacts`. The extension asks for the `service` permission only.

## Capabilities and Constraints

- HTML and bundle artifacts in v1. Markdown, image, PDF, and data kinds are deferred.
- Versions, restore, archive, trash, favorites, tags, search, export, feedback, and session provenance.
- New versions pin their runtime and libraries; historical views stay fixed unless following is explicitly requested. Legacy versions remain readable but are labelled unpinned.
- Feedback is readable and selectable in the gallery. Adding it to chat composes a draft and records that action; it does not send a message or claim the agent has read it.
- Search covers the full scope before pagination. Revision drafts survive navigation for the current panel session.
- Artifact HTML is untrusted and runs only in the browser panel, never in the extension page.
- The viewer and service bind loopback. The view response keeps `sandbox allow-scripts`.
- The user registers the installed Canvas package directory in OpenCode's `plugins` configuration. Setup provides the exact path and JSON, plus a reviewed sample prompt. There is no MCP server or guessed connection badge.
- The UI must use the public OpenChamber SDK UI components and theme tokens and feel native to the app; the panel is not a separate brand surface. Custom CSS is limited to composition the installed kit lacks.

## Evidence on Hand

- `docs/features/FEAT-001-openchamber-canvas.md` for the plan, contracts, and acceptance criteria.
- A real smoke-test artifact with Chart.js in the store.
- The built viewer, service, native OpenCode plugin, panel, and status section.
- No user research, testimonials, or usage benchmarks. Do not invent them.

## Product Principles

1. The artifact is the object. The gallery shows the artifact, its version, and its state, not a feed of messages.
2. The agent publishes; the user decides. The gallery never changes an artifact without an explicit user action.
3. Local first. The store, viewer, and tokens stay on the user's machine.
4. Calm by default. The rail panel is for scanning and reopening; the full-screen page is for inspection and iteration.
5. History is visible. Version, restore, and feedback are first-class, not hidden in a menu.

## Accessibility & Inclusion

Keyboard access to search, list navigation, detail actions, and the setup flow. Visible focus. Every icon control has an accessible name. The panel must remain usable at the rail width and at full-screen width.
