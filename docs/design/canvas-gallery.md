# Canvas gallery surface

Scope: the Canvas rail panel, full-screen page, setup view, and Work Status section.

## Direction

Canvas is an OpenChamber extension, not a separate visual brand. It uses the public `@openchamber/sdk/ui` controls and the host's theme, font, radius, depth, focus, and selection rules. The rail is an artifact list; at 720px and wider the rail and the full-screen page keep that list beside an inspector. Custom CSS composes those views; it does not recreate or restyle the kit's controls.

The component migration replaced the custom surface in commit `a4911b2`. The rejected custom styling is historical, not a reference.

## Source of truth

- Installed `@openchamber/sdk@2.5.1`, particularly its `ui` exports and appearance stylesheet.
- [Official UI kit guide](https://docs.openchamber.dev/sdk/ui/).
- [OpenChamber UI guidance](https://github.com/openchamber/openchamber/blob/main/.agents/skills/openchamber-ui-guidance/SKILL.md) and its surface guidance.
- The audit and resolution in [the platform research](../research/openchamber-extension-platform.md#15-native-extension-ui-audit).

## Components

- Mount SDK buttons, search, selects, menus, text fields, lists, badges, banners, empty states, and spinners. Keep handles, feed controlled values back with `update`, and dispose controls when their owning view is removed.
- Do not copy private React components or their CSS. The SDK is the supported extension equivalent. Do not override SDK control geometry, colors, shadows, type, hover, selection, or focus.
- Apply `applyHostReady` on every host snapshot. A theme-only snapshot changes tokens and supplied font/radius; it must not remount controls or refetch data.
- Controls follow the kit's raised treatment and tinted primary actions. Layout stays flat and separated by space or tone. Selection uses selection tokens; primary means an action. Tinted text uses the host-computed status-text colors.
- Host storage is `host.storage`; browser `localStorage` is unavailable in the opaque sandbox.

## Composition

Custom CSS is limited to the responsive list/inspector split, section headings, decorative icons, flat grid tiles, version metadata and action clusters, setup and status layout, and the native confirmation dialog frame. All interactive children in those areas are SDK controls. Decorative inline SVG icons may sit inside a mounted SDK button or menu trigger and in custom headings; they do not replace the control or override its geometry, colors, or focus. The SDK has no grid-card, arbitrary list-row action slot, icon-button property, or dialog mount; those gaps do not justify recreating supported controls.

- The library toolbar uses SDK selects, a search field, and an options menu. Scope navigation remains visible when the current list is empty. Search and count disappear when the scope has no artifacts.
- At 720px and wider, the rail panel and the full-screen page keep the library beside the inspector. The narrow rail replaces the library with the inspector and a Back control. The inspector actions sit in the title row, so no empty toolbar row consumes the first screen.
- The grid uses flat tiles, labelled SDK buttons, and the host selection fill. The card body and the Inspect button both open the inspector.
- The detail uses SDK buttons with decorative icons for Open, Copy URL, Export, favorite, attach, archive, and confirmed deletion. Versions gets a left-aligned heading and count; Ask the agent gets a heading and a labelled field. Favorite is metadata; it is not mixed into the tag badges.
- The revision field follows Open/Copy URL/Export, ahead of feedback and history. Drafts belong to an artifact and survive Back, scope changes, Setup, and polling for the panel session.
- Feedback uses SDK checkboxes, badges, buttons, loading, and error controls with noninteractive text payloads. Add feedback to chat is explicit and never sends. Ten records show initially with pagination; Pending and Added to chat describe composer status, not agent receipt.
- Three recent versions show initially; an SDK control expands older history. Legacy versions visibly identify unpinned rendering dependencies.
- Search, scope, tags, and sort run on the service before pagination. Show loaded/matching counts and a Load more button; zero matches never remove the search field. Keyboard split behavior uses the layout's 720px breakpoint.
- Setup uses SDK badges, banners, actions, and a labelled, keyboard-focusable JSON scroller under left-aligned headings with icons. Copy plugin config and Copy path use the exact installed package directory. Other plugin entries are preserved when the user merges the configuration.
- The sample prompt is always available for user review. Setup does not scan OpenCode config or infer a session's connection state. It explains how to confirm the tools in chat. Viewer compatibility and known-protocol restart remain explicit actions; a failed recheck disables restart rather than retaining stale compatibility.
- The Work Status section shows artifact count and latest title as native text, without a guessed agent connection badge. The section is transparent over the host panel.

## Verification

`bun run test:browser` serves the actual built panel and status entries in an opaque `allow-scripts` iframe with a mock host. It covers SDK-only controls, six resolved themes plus host font/radius overrides, retained drafts/focus, disposal, storage preferences, keyboard/menus/dialog, loading/empty/error/retry/grid states, and native Setup under AC-071. Setup snapshots and bounded gates cover 320, 375, 390, 768, 1024, 1280, 1440, and 2048px in light and dark, including long package paths.

The suite uses resolved palette snapshots, not a separately handwritten mockup. Installed-app visual acceptance is still required; passing token and geometry tests is not proof that every installed or user-authored palette was inspected.
