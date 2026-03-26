# Cucumber Jump

VS Code / Cursor extension: jump between Gherkin `.feature` steps and Go [godog](https://github.com/cucumber/godog) `StepMap` entries (`bdd.go`, `common_bdd.go`, …) and `*_steps.go` implementations. It does **not** register a grammar for `.feature` files (syntax highlighting comes from another Gherkin/Cucumber extension).

---

## Usage guide

### Navigation and keys

| Where                                           | Action                                  | What it does                                                                                                                               |
| ----------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.feature` (step line)                          | **F12**                                 | **Go to primary step target** — opens the first resolved target (usually `*_steps.go`), avoiding a merged multi-definition peek.           |
| `.feature` (step line)                          | **Go to Definition** / Ctrl+click       | Uses the definition provider; with default settings you mostly get the implementation; see `cucumberJump.includeStepRegistryInDefinition`. |
| `.feature` (step line)                          | **Ctrl+F12** / **Go to Implementation** | Same resolver as definitions when no other extension wins the gesture.                                                                     |
| `bdd.go` (regex key line or `//` comment above) | **Go to Definition**                    | Jumps to matching `.feature` lines (merged with gopls if it returns anything).                                                             |
| `bdd.go` (inside `func() { … }` body)           | **Go to Definition**                    | **Go only** (gopls) — Cucumber Jump does not add `.feature` targets there.                                                                 |
| `bdd.go` (anywhere in the step block)           | **Shift+F12** / **Find All References** | Lists `.feature` usages for that step (Cucumber Jump reference provider).                                                                  |

**Optional: “all feature usages” on a shortcut** — bind the built-in reference command so it matches TS/Go muscle memory, for example **Alt+F12**:

```json
{
  "key": "alt+f12",
  "command": "editor.action.referenceSearch.trigger",
  "when": "editorTextFocus && resourceLangId == go"
}
```

Adjust `when` if you use it only in `bdd.go` (e.g. match file path patterns via an extension that sets context, or keep it broad for all Go).

**Palette commands**

- **Cucumber Jump: Go to primary step target** — same as F12 on `.feature`.
- **Cucumber Jump: Go to Implementation** / **Go to Step Registry** — from a `.feature` step, open only that target.

### Peek without merged definitions

**Cucumber Jump: Peek step targets (pick list)** opens a **Quick Pick of only this extension’s targets** (implementation and/or registry, depending on settings and resolution). Use it when Ctrl+click or Peek Definition mixes in other extensions and you want a clean list.

### Dev mode (Go left, feature right)

- **Editor title bar (`.feature` only):** icon-only **Toggle Dev mode** — hover shows **“Cucumber Jump: Toggle Dev mode”**; **cucumber** image (`assets/cucumber.png`) when Dev mode is off for this tab, **codicon `$(close)`** when this tab is the paired feature (so it no longer matches the built-in split icon). If you do not see it, check the **⋯** overflow on the editor title bar, reload the window, and use extension **0.1.23+** for correct `.feature` detection.
- **Command Palette:** **“Cucumber Jump: Toggle Dev mode”** (command id `cucumberJump.toggleDevMode`) — same action as the title icon.
- **Cucumber Jump: Open Dev mode (Go left, feature right)** — same as toggle when Dev mode is off (command palette).
- **Dev mode layout** — two editor groups with a fixed layout (full gopls on the Go side):
  - **Left column:** Go (`*_steps.go` or `bdd.go` when you start from `.feature`, or the file you had open when you start from Go).
  - **Right column:** the **paired** `.feature` file (the active feature for this session).
  - From a **`.feature`** file: the cursor can be **anywhere** in the file. The extension picks the **nearest** Gherkin step line (same line, then closest above, then closest below) and opens its **first** resolved Go target on the **left** (usually `*_steps.go`). If the file has **no** steps or none resolve, it opens the pack’s **`bdd.go`** at the top on the **left** instead.
  - From **`bdd.go`**: cursor on a line inside a step map entry (as with **Find References**); the **first** matching `.feature` usage opens on the **right**, your `bdd.go` stays on the **left**.
  - From **`*_steps.go`**: cursor inside a step **handler** (`func name(` …); the extension resolves the **first** matching `.feature` line on the **right**, your steps file on the **left**.
- While Dev mode is active, moving the cursor in the **feature** uses the **nearest** step line for the same sync (implementation, or `bdd.go` if there is no implementation). Moving the cursor in **Go** updates the feature editor on the **right** only when the resolved usage is in the **same** `.feature` file as the paired session (so other services’ usages do not hijack the pane). Sync uses the pinned columns (`ViewColumn.One` / `ViewColumn.Two`) when a file is not already visible, which avoids opening extra editor groups after you rearrange tabs.
- **Status bar (left):** prominent **`DEV · <file.feature>`** (pinned style) shows the paired file; tooltip has the full workspace-relative path. **Click** for **Dev mode actions…** (focus feature, focus Go, or close).
- **Tab / explorer:** the paired `.feature` gets a **file decoration** (purple **●** next to the name and themed color on supported UIs). VS Code/Cursor do **not** expose an API to recolor the tab title text itself; this is the supported way to mark that resource.
- **Cucumber Jump: Close Dev mode** stops listening and hides the Dev status item. Extension deactivation also clears the session.
- **`cucumberJump.devModeDebounceMs`** (default `200`) — delay before syncing after selection changes.

**Limitations:** If a `.feature` has **no** step lines, Dev mode can still open (left pane is `bdd.go`) but feature-side **sync** does nothing until you add steps. Multiple `.feature` hits for one step use the **first** match when opening Dev mode from Go. Multiline Gherkin steps only treat the **keyword** line as a step.

### Editor affordances

- **`cucumberJump.codeLensEnabled`** (default `false`) — when `true`, each Gherkin step line in `.feature` files shows **Implementation** and **Registry** CodeLens links.
- **`cucumberJump.statusBarHintEnabled`** (default `false`) — when `true`, on a `.feature` step line the status bar shows the resolved implementation as `path:line` (debounced). Clicking the item runs **Show step resolution**.

### Configuration and onboarding

- **`cucumberJump.projects` / `cucumberJump.libraries`** — map `featureGlob` → `bddFile` → `stepsGlob` (paths relative to the workspace folder). See **Settings reference** below.
- **`cucumberJump.includeStepRegistryInDefinition`** (default **`false`**) — `false`: Ctrl+click / Go to Definition from `.feature` prefers **only** `*_steps.go` when it resolves (then falls back to `bdd.go` if needed). `true`: also lists the `bdd.go` registry line in the same peek. Palette commands **Go to Step Registry** / **Go to Implementation** are unchanged.
- **`cucumber.glue`** (official Cucumber extension) — point globs at your step files (e.g. `**/testing/*_steps.go`) so third-party “definition” noise on `.feature` lines is reduced.
- **`editor.gotoLocation.multipleDefinitions`** — this extension sets **`goto`** for `[cucumber]`, `[gherkin]`, and `[feature]` by default so feature files do not always open the peek UI. Override per language if you prefer peek there.

**Cucumber Jump: Show step resolution** prints, to the **Cucumber Jump** output channel, how the current `.feature` step was matched: pack order, resolved `bdd` path, map line, handler name, and implementation path (or why something is missing). Use it when a jump is empty or wrong.

**Workspace folder vs globs:** If `featureGlob` starts with a segment like `testing/` but you opened **only** that folder as the workspace root, paths relative to the workspace omit that prefix. The extension also tries **workspace-folder-name + `/` + relative path** against the same glob. Library `bddFile` / `stepsGlob` values that repeat the workspace folder name (e.g. `testing/common/...` when the root is already `testing`) are normalized when opening files.

### Same `.feature` line appearing as a “definition”

Cucumber Jump **filters out** targets that point at the same `.feature` file using **real filesystem paths** so a URI string mismatch does not re-show the open file. Remaining duplicates on **Go to Definition** usually come from **another** extension; disabling ours proves only we were contributing if nothing else registers definitions for that buffer.

---

## Install (Cursor / VS Code)

```bash
cd cucumber-jump-ext
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository
```

Install the `.vsix` via **Extensions: Install from VSIX…**. If packaging fails with an inspector error, use `env -u NODE_OPTIONS npm run package` (Linux/macOS).

---

## Settings reference

Minimal example (per-module layout with `feature/` and `testing/`):

```json
{
  "cucumberJump.projects": [
    {
      "name": "payments-api",
      "featureGlob": "services/payments-api/feature/**/*.feature",
      "bddFile": "services/payments-api/testing/bdd.go",
      "stepsGlob": "services/payments-api/testing/*_steps.go"
    }
  ],
  "cucumberJump.libraries": [
    {
      "name": "shared-steps",
      "featureGlob": "libs/bdd-common/feature/**/*.feature",
      "bddFile": "libs/bdd-common/steps/common_bdd.go",
      "stepsGlob": "libs/bdd-common/steps/*_steps.go"
    }
  ]
}
```

**`**`in`bddFile`/`stepsGlob`:** the extension takes the package root as the path **before** `/feature/`in the open file and splices it into the first`**/`segment (e.g.`**/testing/bdd.go`+`services/foo/feature/x.feature`→`services/foo/testing/bdd.go`).

**Several modules:** each module should have its own `projects` row with matching `bddFile` / `stepsGlob`. When multiple `featureGlob` entries match, the row whose `bddFile` sits under the **same** package root as the feature file wins; otherwise the narrowest `featureGlob` wins.

---

## Syntax highlighting for `.feature`

If `.feature` files are plain text: install a Gherkin/Cucumber highlighter, set language mode to **Gherkin** / **Cucumber** / **Feature**, and optionally:

```json
"files.associations": {
  "*.feature": "gherkin"
}
```

This extension activates on **`onStartupFinished`** so it does not compete with grammar extensions on activation order.

---

## Development

Open the **`cucumber-jump-ext`** folder, **Run > Start Debugging** (F5), then in the host window open a repo with `.feature` + Go and configure `cucumberJump.*`.

---

## Limitations

- Step matching uses a **comment line + JS `RegExp`** fallback; exotic Go-only regex may differ from godog.
- Reverse **Find References** from Go only runs for `bddFile` paths listed in settings.

We do **not** call `vscode.executeDefinitionProvider` from inside our definition provider (re-entrancy / hang risk on some hosts).
