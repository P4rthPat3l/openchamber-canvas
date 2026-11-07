# Metrics dashboard

Use when the reader needs to compare measured values, understand a trend, or inspect a dataset. Start with the [chart](../../../examples/chart.html).

## Required content

Name the source, time range, units, aggregation, and population. Distinguish sample values from real observations. Never invent missing values, imply a live feed from a static snapshot, or treat missing data as zero. A time series needs chronological order; a category comparison does not.

Choose the simplest drawing that answers the question. Use comparable axes and a zero baseline for magnitude bars. Explain denominators and percentage changes. Derived summaries, labels, drawing, table, and selected details must come from the same dataset.

## Layout and checks

Lead with the measured question and scope, then the chart and its textual equivalent. Add filters only when they work on the supplied data and help the task. Avoid decorative statistics or fake loading/error states for a static dataset.

Verify plotted values against the table and any calculations. Test zero, missing, empty, and long-label cases when the data permits them. With no observations, explain the absence instead of drawing a misleading zero chart. Recolor the actual chart when the user switches themes, not just the page background. Stop when values and scope are accurate and the preview passes.
