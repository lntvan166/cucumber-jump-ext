# Set up navigation

Cucumber Jump connects `.feature` files to step definitions in **Java, Kotlin,
Python, JavaScript, TypeScript, Ruby, C#, Dart, and Go**.

**Zero setup:** open any `.feature` file — the extension scans the workspace
and starts navigating automatically when it can match your steps to
definitions.

**Explicit setup:** run **Cucumber Jump: Create configuration** from the
command palette. It shows the detected projects with evidence
(`23/31 steps matched`) and writes the ones you confirm to
`.vscode/settings.json`.

If detection finds nothing, the command inserts a template — fill in
`featureGlob` and `stepsGlob` (the file extension of `stepsGlob` selects the
language).
