# Cucumber Jump

**Cucumber Jump** connects **Gherkin `.feature` files** with **Go** code in projects that use a generated **step map** (for example [godog](https://github.com/cucumber/godog)): one file lists every step’s **regex and wiring**, and separate files hold the **real logic**.

Install from the **Visual Studio Marketplace** (VS Code) or your editor’s extension panel — search **Cucumber Jump** (publisher **lntvan166**). Open a workspace that contains both `.feature` files and the configured Go paths, then add the settings below.

---

## Demos

### Demo 1 — Jump between `.feature` and Go

This shows **bidirectional navigation**: from a Gherkin step to the right Go place, and from Go back to the scenario.

![Demo 1 — navigating from a feature step to Go and back](assets/demo1.gif)

### Demo 2 — Dev mode (paired panes)

**Dev mode** pins a **split layout**: **implementation / registry on the left**, **`.feature` on the right**. When you **move the caret on a step line on the right**, the **left editor** updates to the matching Go code. When you **move inside paired Go** (bdd or steps file), the **right** scrolls to the linked feature line.

Start or stop it from the **cucumber icon** in the **`.feature`** editor title bar, from the command palette (**Toggle Dev mode** / **Open Dev mode**), or via the **DEV · …** status bar item. Full behavior and commands are in **Dev mode** later in this README.

![Demo 2 — Dev mode: step on the right, Go follows on the left](assets/demo2.gif)

---

## Quick setup with an AI assistant

Cucumber Jump works in **VS Code**, **Cursor**, and other VS Code–based editors. If your editor has an **AI chat** (e.g. GitHub Copilot Chat, Cursor, Codeium, or JetBrains AI in VS Code), you can paste a setup prompt so the assistant inspects your tree and proposes `cucumberJump` entries for `.vscode/settings.json`.

1. Open your project as the **workspace root** so paths resolve correctly.
2. Copy the prompt: **[Open raw file](https://github.com/lntvan166/cucumber-jump-ext/raw/main/docs/ai-setup-prompt.txt)** (select all → copy), or expand the block below.
3. Paste into your AI chat and ask it to merge the settings (or show a diff first). **Review** the JSON before saving.

<details>
<summary><strong>Setup prompt</strong> (expand to copy) — also available as <a href="https://github.com/lntvan166/cucumber-jump-ext/raw/main/docs/ai-setup-prompt.txt">raw</a></summary>

```text
You are helping configure Cucumber Jump (VS Code / Cursor extension, publisher lntvan166) for this workspace.

Context: The workspace root is opened in a VS Code–compatible editor. All paths in cucumberJump settings are relative to that workspace folder.

Tasks:
1. Discover all *.feature files and infer each BDD "package root" (the directory segment before /feature/ in the path, or the folder that groups one BDD module).
2. For each distinct layout, locate the step registry (bdd.go, *_bdd.go, or similar: file with godog-style StepMap / regex → handler wiring) and step implementation files (typically *_steps.go).
3. Monorepo / many services: if every module uses the **same relative layout** (e.g. each package root has feature/ + testing/bdd.go + testing/*_steps.go under one common parent), prefer **one** cucumberJump.projects entry with ** in featureGlob, bddFile, and stepsGlob (see README "Wildcards in bddFile and stepsGlob"). Do **not** emit one projects object per service in that case—it bloats the array. Add **multiple** projects entries only when layouts genuinely differ in ways a single ** pattern cannot express.
4. Add cucumberJump.libraries entries only for shared/common features and shared registry + steps. Libraries are searched after the matching project, in array order.
5. Merge cucumberJump.projects, cucumberJump.libraries, and optional keys (statusBarHintEnabled, etc.) into .vscode/settings.json. Preserve every existing unrelated setting. Create .vscode/settings.json if missing. For cucumberJump.includeStepRegistryInDefinition: use **false** or omit the key (extension default is false). Set **true** only if the user explicitly wants the bdd registry line included in Go to Definition alongside the implementation—do not default it to true.
6. If the official Cucumber extension is used, suggest cucumber.glue globs that include the same implementation paths so its language server does not conflict with Cucumber Jump on step lines.
7. Single-file layout: if handler funcs live in the same file as the registry (no *_steps.go), set bddFile to that file and set stepsGlob to a glob that includes that file (same path, or a broader folder glob such as my/module/testing/*.go). A pattern like *_steps.go alone does not match bdd.go.
8. Multi-root workspaces: if multiple folders are opened, settings may need per-folder .vscode/settings.json or the correct scope for each root.
9. After editing, explain how to verify: open a .feature, put the caret on a step line, press F12 (Go to primary step target) or Go to Definition; use the command "Cucumber Jump: Show step resolution" if something fails.
10. Glob pitfalls (not regex): do **not** rely on `prefix-*` style globs (single `*` for one folder name) in the middle of paths for nested monorepos—they often **fail to match** in VS Code workspace globs. **Prefer `**` from a stable parent** (e.g. `my-root/**/feature/**/*.feature`, `my-root/**/testing/bdd.go`). If you must anchor a literal prefix before arbitrary nested paths, `prefix-**` sometimes works where `prefix-*` does not; still **default to plain `**`** when one pattern covers every module. Apply the same rule to cucumber.glue.

Reference: see the "Example settings.json" section in the Cucumber Jump README for the shape of projects and libraries.

Example monorepo pattern (rename segments to match your repo): featureGlob "services/**/feature/**/*.feature", bddFile "services/**/testing/bdd.go", stepsGlob "services/**/testing/*_steps.go", plus a libraries entry for any shared tree (e.g. libs/bdd-shared/feature and libs/bdd-shared/steps as in the Example settings.json below).

Output: proposed JSON fragment or full merged settings.json. If you cannot write files, show the diff clearly and remind the human to review before saving.
```

</details>

---

## How your repo maps to settings

| Concept                 | Typical files                        | Role                                                                                                                                                      |
| ----------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Step registry**       | `bdd.go`, `common_bdd.go`, …         | **All steps are registered here**: comment + regex key → thin wrapper that calls a handler. This is what **`bddFile`** points to.                         |
| **Step implementation** | `*_steps.go` (e.g. `login_steps.go`) | **Business logic** for each step: real `func` bodies. This is what **`stepsGlob`** must find.                                                             |
| **Feature specs**       | `*.feature`                          | Gherkin scenarios; each step line is resolved via the registry, then the implementation. **`featureGlob`** selects which features belong to which module. |

Resolution order from a `.feature` step: **matching `projects` entry first**, then each **`libraries`** entry in order until a match is found.

---

## Settings (`cucumberJump.*`)

All paths are **relative to the workspace folder** (the root you opened in VS Code / Cursor).

### `cucumberJump.projects` (array)

Each object describes **one service or module** that has its own features + Go test layout.

| Field             | Required | Meaning                                                                                                               |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| **`featureGlob`** | yes      | Glob for `.feature` files owned by this module, e.g. `services/my-api/feature/**/*.feature`.                          |
| **`bddFile`**     | yes      | The **step registry** file: generated map of regex → handler call. Can be a fixed path or a `**` pattern (see below). |
| **`stepsGlob`**   | yes      | Glob for **implementation** files, usually `*_steps.go` next to `bdd.go`.                                             |
| **`name`**        | no       | Optional label; only for your own documentation in JSON.                                                              |

If several `featureGlob` values match the same file, the extension prefers the entry whose **`bddFile`** lives under the **same package root** as the feature file (the path segment **before** `/feature/`).

### `cucumberJump.libraries` (array)

Same shape as **`projects`**: `featureGlob`, **`bddFile`** (shared registry), **`stepsGlob`** (shared `*_steps.go`). Used for **shared** steps (e.g. a `common` package). Searched **after** the matching project, in **array order**.

### `cucumberJump.includeStepRegistryInDefinition`

- **`false`** (default): **Go to Definition** / Ctrl+click on a step prefers **only** the **`*_steps.go`** implementation when it resolves; if not found, **`bdd.go`** is still used as a fallback.
- **`true`**: also offers the **registry line** in `bdd.go` (useful if you want both in one flow).

Palette commands **Go to Step Registry** and **Go to Implementation** are unchanged.

### `cucumberJump.codeLensEnabled`

Default **`false`**. When **`true`**, step lines in `.feature` files show **Implementation** and **Registry** CodeLens links.

### `cucumberJump.statusBarHintEnabled`

Default **`false`**. When **`true`**, on a `.feature` step line the status bar shows the resolved implementation path (debounced). Click opens **Show step resolution**.

### `cucumberJump.devModeDebounceMs`

Delay in milliseconds (default **200**, minimum **50**) before **Dev mode** syncs the paired editor after the cursor moves.

### Wildcards in `bddFile` and `stepsGlob`

If the pattern contains **`**`**, the extension builds a concrete path from the open feature’s **package root** (everything before `/feature/`). Example: `\*\*/testing/bdd.go`+`repo/my-svc/feature/x.feature`→`repo/my-svc/testing/bdd.go`.

**Registry and implementations in one file:** `stepsGlob` selects which Go files are searched for `func HandlerName(` bodies. A typical `*_steps.go` glob does **not** match `bdd.go`. If your handlers live in the same file as the step map, set `bddFile` to that file and set `stepsGlob` to a glob that includes it (for example the same relative path, or a folder glob like `my/module/testing/*.go` if that stays small enough).

---

## Example `settings.json`

```json
{
  "cucumberJump.projects": [
    {
      "name": "my-api",
      "featureGlob": "services/my-api/feature/**/*.feature",
      "bddFile": "services/my-api/testing/bdd.go",
      "stepsGlob": "services/my-api/testing/*_steps.go"
    }
  ],
  "cucumberJump.libraries": [
    {
      "name": "shared",
      "featureGlob": "libs/bdd-shared/feature/**/*.feature",
      "bddFile": "libs/bdd-shared/steps/common_bdd.go",
      "stepsGlob": "libs/bdd-shared/steps/*_steps.go"
    }
  ],
  "cucumberJump.includeStepRegistryInDefinition": false
}
```

---

## Dev mode (paired **Go** + **feature**)

Dev mode opens a **fixed layout**: **Go on the left**, **`.feature` on the right**, and keeps them in sync when you move the cursor (within the rules below).

### Title bar button (on `.feature` tabs)

- In the **editor title bar** (same area as editor actions), look for the **Cucumber Jump** icon on **`.feature`** tabs.
- **Cucumber icon** → start Dev mode for that feature (or switch pairing to this tab).
- **Close (×) icon** → this tab is the **paired** feature; click to **exit** Dev mode.

If the icon is hidden, open the **⋯** overflow menu on the title bar. Hover the control to see **Cucumber Jump: Toggle Dev mode**.

### Commands

- **Cucumber Jump: Toggle Dev mode** — same as the title bar control.
- **Cucumber Jump: Open Dev mode (Go left, feature right)** — start Dev mode when it is off.
- **Cucumber Jump: Close Dev mode** — stop pairing and clear the session.

You can open Dev mode with the cursor **anywhere** in a `.feature` file: the extension uses the **nearest** Gherkin step line (current line, then above, then below). If nothing resolves, it may open **`bdd.go`** on the left instead.

While Dev mode is on, a **status bar** item shows **`DEV · <file.feature>`**; **click** it for actions (focus feature, focus Go, close).

---

## Other navigation (short)

- **Inline steps in `bdd.go`**: If the map uses an anonymous `func` with only `return nil` (and the real `return myHandler(state, …)` is commented out), there is no `*_steps.go` target. **Go to Definition** / **Go to Implementation** then open the **step line in `bdd.go`** (the regex key) instead of doing nothing.
- **F12** on a `.feature` step (when the keybinding applies): **Go to primary step target** — jumps to the main Go target without relying on merged definition lists.
- **Cucumber Jump: Peek step targets** — pick list of this extension’s targets only.
- **`bdd.go`**: **Go to Definition** / **Find All References** in supported positions jumps to or lists **`.feature`** usages (per configuration).

Highlighting for `.feature` files comes from your **Gherkin / Cucumber** extension; Cucumber Jump does not replace it.

If you use the **official Cucumber** extension, set **`cucumber.glue`** to include your `*_steps.go` globs so its language server does not fight navigation on the same lines.

---

## License

MIT — see the `license` field in `package.json`.
