# UI proposal

Use when the user wants a proposed screen or interaction. Start with the [mockup](../../../examples/mockup.html). Use the project's own design system when it exists; the warm Canvas fallback is not a substitute for the project's visual language.

## Required content

- Identify the user task and proposed change. Preserve existing product facts and scope.
- Show realistic, labeled sample content, including long names or text that could affect layout. Do not insert private customer data.
- Show the states relevant to the task: invalid input, pending, success, retry, empty, or loading only where the proposed interaction actually needs them.
- Explain which actions are simulated. Canvas feedback records choices; it does not update a real account, submit a payment, deploy code, or send an email. Preview feedback is disposable.

## Layout and checks

Prioritize the primary task and a clear next action. Use real labeled controls with visible focus, keyboard access, and a responsive composition. Keep user input when an action fails. Disable repeated submission while pending and show a useful result. Do not use native form submission in the sandbox.

Test invalid input, pending behavior, success, and retry with retained values. Check long content and the narrow layout in both themes. Test only the behaviors represented by the mockup, not imagined backend integration. Stop when the proposed task and its relevant states work. Do not redesign unrelated screens or build an application scaffold.
