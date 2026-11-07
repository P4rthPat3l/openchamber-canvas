# Feature walkthrough

Use when the reader needs to understand what happens in a feature, including alternate roles or outcomes. Start with the [report](../../../examples/report.html), adding the diagram pattern only if it explains the sequence better.

## Required content

A scenario has an actor, starting conditions, trigger, ordered actions, data or state changes, and an observable outcome. Include relevant alternate and failure paths. It is not a list of screens or a table of feature names.

For example, a checkout explanation identifies the customer and cart, submission, validation, payment success or failure, order persistence, and the result shown to the customer. If the code does not establish a step, mark it unknown. Do not infer a real transfer from a ledger update.

Cover each role the user asked about. If the behavior differs for a new user and an existing user, show separate paths rather than a confusing toggle that hides the distinction. Use small labeled sample inputs only when examples are requested; keep them separate from verified production findings.

## Layout and checks

Lead with a short plain-language outcome. Follow with the main journey, the relevant alternate paths, and before/after state where useful. Name who performs each action and what the user sees. Add controls only when switching a scenario helps understanding, not merely to make a static report interactive.

Trace each path from its initial state to its outcome. Verify data changes and UI claims against inspected code or supplied evidence. Check that labels explain actions without relying on formulas or unexplained domain terms. Stop when the requested roles and paths are covered and the preview passes.
