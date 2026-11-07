# Investigation report

Use when the user needs to understand a bug, incident, code review finding, or migration result. Start with the [report](../../../examples/report.html); use the diagram pattern only for a flow that explains the finding.

## Required content

Separate observed behavior, expected behavior, evidence, hypotheses, changes already made, and checks still needed. Name reproduction conditions and affected scope only as far as the evidence supports them. Record commands and actual results without credentials or customer records.

For a fix, explain before and after using one consistent example. Distinguish application behavior from existing historical data, and a proposed repair from a repair actually executed. A successful build does not prove runtime correctness. A screenshot does not prove a database change.

## Layout and checks

Lead with the finding and its consequence. Follow with evidence, the explanatory sequence, verified changes, and remaining risks or checks. Keep uncertainties beside the claim they limit. Include empty findings as an honest result, not fabricated issues to fill the page.

Check statements against the inspected code, supplied records, and executed commands. Make sure a hypothesis is not labeled a cause and a planned operation is not labeled complete. Keep the report readable without JavaScript. Stop when the requested investigation is understandable and verification limits are explicit.
