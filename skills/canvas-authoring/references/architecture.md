# Architecture walkthrough

Use when the reader asks how a system works, where responsibility lives, or how a request or database change moves through it. Start with the [diagram](../../../examples/diagram.html) for a graph or [report](../../../examples/report.html) for a primarily textual explanation.

## Required content

- State the question and boundary. A system context view, request sequence, and database relationship view answer different questions. Do not combine all three in one unreadable graph.
- Name actors, processes, stores, and external systems. Distinguish persisted rows from computed values and real integrations from proposed ones.
- For a database perspective, identify the starting rows and keys, the statements or operations in order, the resulting rows, and the query that drives the visible UI. Link relevant code paths and functions when inspected. State transaction boundaries or their absence only with evidence.
- Label arrows with what moves. Use explicit step numbers only when order matters. Show important failure boundaries, not hypothetical retries unsupported by the code.
- Mark observed, inferred, and proposed behavior. Do not invent schema, endpoints, or implementation details to complete the drawing.

## Layout and checks

Use a compact header, a legible focused diagram, selected-item details, and a complete textual flow equivalent. Prefer several selectable focused views to one oversized graph. Keep nodes, edges, labels, and the table derived from one graph. Preserve the shared tokens but give the drawing enough width; contain horizontal scrolling within the drawing/table.

Check every arrow against evidence and the table. Test keyboard selection and long labels. Confirm the reader can follow one concrete request or row change from start to outcome without guessing who acts. Stop when that question is answered and the preview passes. Do not add unrelated system areas.
