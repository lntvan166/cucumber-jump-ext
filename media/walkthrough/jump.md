# Try a jump

1. Open a `.feature` file.
2. Put the cursor on a step line (`Given …`, `When …`, `Then …`).
3. Press **F12** — you land on the step definition.

From a step definition, **F12** goes the other way: it lists every feature
line that uses it.

If a jump does not work, run **Cucumber Jump: Show step resolution** — it
prints exactly which projects, globs, and files were tried.
