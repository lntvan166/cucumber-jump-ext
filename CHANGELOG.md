# Changelog

All notable changes to **Cucumber Jump** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-05-31

### Added

- **Multi-language support** — step definition navigation now works for **Java, Kotlin, Python, JavaScript, TypeScript, Ruby, C#, Dart**, and Go (new-style `ctx.Step()`) in addition to the original Go StepMap path. Language is **auto-detected** from the `stepsGlob` file extension — no extra config field needed.
- **Simple two-field config** for all new languages and new-style Go projects: only `featureGlob` + `stepsGlob` are required. `bddFile` is now optional and only needed for the legacy Go StepMap pattern.
- **`LanguageAdapter` interface** — a clean internal abstraction that parses step definitions and matches steps for each language. Adding a new language is a single new file.
- **Cucumber Expression support**: `{int}`, `{float}`, `{string}`, `{word}`, `{bigdecimal}`, `{double}`, `{long}`, `{short}`, `{byte}`, `{}` parameter types, plus **optional text** (`cucumber(s)` matches both `cucumber` and `cucumbers`) and **alternation** (`cucumber/banana` matches either word).
- **Activation events** for all supported step-file languages (`java`, `kotlin`, `python`, `javascript`, `typescript`, `ruby`, `csharp`, `dart`) so the extension activates promptly when a step file is opened.
- **Dev mode reverse sync** now works for all supported step-file languages, not just Go. Moving the cursor inside a Java/Python/TS/etc. step file syncs the paired `.feature` pane to the matching scenario.
- **`Show step resolution` diagnostics** — the output now reports how many step files match the configured glob, and shows a `⚠` warning when zero files are found, making misconfiguration immediately visible.
- **Vitest unit test suite** (69 tests) covering all language adapters and the Cucumber Expression converter.

### Changed

- **`bddFile`** is now **optional** in `cucumberJump.projects` and `cucumberJump.libraries`. Existing configs with `bddFile` continue to work without any changes — the legacy two-level Go path is fully preserved.
- `stepsGlob` schema description updated to list all supported languages and their file extensions.
- Extension `description` updated to reflect multi-language support.
- **Dev mode** error messages are now language-neutral (no longer reference `bdd.go` or `*_steps.go`).
- **Status bar hint** tooltip updated to say "No step definition found" instead of "No `*_steps.go` match".
- README rewritten with a supported-languages table, per-language quick setup snippets, and step registration pattern examples for each language.
- `docs/ai-setup-prompt.txt` updated to guide AI assistants through multi-language configuration.

### Fixed

- **Unanchored string matching** — plain string patterns (e.g. `"the user logs in"`) were previously matched as unanchored regex, causing `"the user logs in to admin"` to match incorrectly. They are now matched as literal anchored strings. Patterns starting with `^` or ending with `$` are still treated as intentional regex.
- **File scan cap** — `findFiles` calls raised from 200 to 5000 results, preventing silent navigation failures on large monorepos where the target step file was beyond the previous cap.
- `isCucumberExpression` no longer misidentifies Go regex quantifiers like `\d{3}` as Cucumber Expressions. Requires at least one letter inside `{…}`.
- Cache invalidation now covers all supported step-file languages (Java, Python, etc.), not just Go and `.feature` files. Edits to step files are reflected immediately without requiring a config change or restart.

[1.0.0]: https://github.com/lntvan166/cucumber-jump-ext/compare/v0.1.31...v1.0.0

## [0.1.31] - 2026-03-30

### Added

- **`cucumberJump.notifyConflictingExtensions`** (default **true**): one-time notification when **Cucumber (Gherkin) Full Support** (`alexkrechik.cucumberautocomplete`) or **Cucumber** (`CucumberOpen.cucumber-official`) is installed—VS Code merges definition providers, so **F12** (*Go to primary step target*) is the reliable Cucumber Jump-only jump. Dismiss with *Don't show again* (global storage).
- README: coexisting with other Cucumber extensions; **`notifyConflictingExtensions`** note.

[0.1.31]: https://github.com/lntvan166/cucumber-jump-ext/compare/v0.1.30...v0.1.31

## [0.1.30] - 2026-03-27

### Added

- **README**: new **`## Quick setup with an AI assistant`** section (after **Demos**) with a copy-paste prompt for IDE AI chats to analyze the repo and propose `cucumberJump` / `.vscode/settings.json` configuration.
- **`docs/ai-setup-prompt.txt`**: same prompt as **Open raw** for easy copy; collapsible block in the README mirrors it.

### Changed

- **README** (settings docs): note under **Wildcards** when **registry and implementations share one file** (`stepsGlob` must include that file or a broader glob).
- **AI setup prompt** (README + `docs/ai-setup-prompt.txt`): prefer **one** `projects` entry with `**` when layouts match; keep **`includeStepRegistryInDefinition`** at **false** unless the user asks otherwise; **glob pitfalls**—avoid `prefix-*` in nested trees, **prefer `**`** from a stable parent (also for **`cucumber.glue`**); generic monorepo examples (no vendor-specific paths).

[0.1.30]: https://github.com/lntvan166/cucumber-jump-ext/compare/v0.1.29...v0.1.30

## [0.1.29] - 2026-03-27

### Fixed

- **From `.feature`**: If a step is implemented **inline** in `bdd.go` (anonymous `func` only `return nil`, real call commented with `//`), navigation no longer pretends the handler is still the old `return Name(state, …)` line. **Go to Definition**, **Go to Implementation**, and **Dev mode** sync fall through to the **`bdd.go` map entry** (regex line) so you always land on real code.
- Step map parsing **ignores full-line `//` comments** when looking for `return helper(state` delegation to `*_steps.go`, and only scans **within the current map entry’s `func { … }` block** so the next step’s `return …(state` is never mistaken for this one (that regression could make navigation jump nowhere or to the wrong place).
- **Ctrl+click / Go to Definition** stays aligned with **F12**: document selectors use **explicit `scheme`** (`file` and `vscode-remote`) for `.feature` globs and Gherkin language IDs, and for **Go** bdd maps (`go` + `file` / `vscode-remote`). Broad pattern-only or bare `language` filters regressed Ctrl+click in some Cursor builds.
- **Remote SSH / WSL / dev containers**: same explicit `vscode-remote` registration as local `file` workspaces.
- If **dedupe** would drop every definition target (URI edge case), resolutions are still returned instead of empty.
- **`.feature` detection** for navigation uses `Uri.path` when `fsPath` is empty.

### Changed

- README: short note on **inline `bdd.go` map bodies** and fallback to the registry line.

[0.1.29]: https://github.com/lntvan166/cucumber-jump-ext/compare/v0.1.28...v0.1.29

## [0.1.28] - 2026-03-27

### Changed

- **README** demos: **Demo 1** walks through jumping **`.feature` ↔ Go** (with `demo1.gif`); **Demo 2** shows **Dev mode** paired panes—step on the right, Go on the left (with `demo2.gif`).

[0.1.28]: https://github.com/lntvan166/cucumber-jump-ext/compare/v0.1.27...v0.1.28

## [0.1.27] - 2026-03-27

### Fixed

- **Dev mode** (paired layout: Go on the left, `.feature` on the right): Closing the feature side or the paired `.feature` file **ends Dev mode** instead of reopening the feature in a loop. The DEV status bar item and the purple paired-feature decoration clear when the session ends. If the **same** `.feature` was open in two splits and you close only the **right** one, Dev mode ends instead of opening that split again.
- **Go to Definition / Ctrl+click** on `.feature` steps stays reliable after **Reload Window** or restarting the extension, in line with **F12**.
- **Dev mode**: Stale “DEV” state clears when the paired feature is no longer in the right-hand column (e.g. you closed that group but keep editing the feature elsewhere). Go code is revealed only in the **left** pinned column when the same file was open in two splits.

### Changed

- **Finding usages** (e.g. references from Go back to `.feature` lines) is lighter on the editor: specs are read from disk instead of opening every match as a document.
- **Status bar hint** (`cucumberJump.statusBarHintEnabled`): updates are debounced when switching editors too, stale results after fast cursor movement are ignored, and the hint hides immediately when you leave a `.feature` tab. Tooltips spell out what the item means.
- **Quick pick** titles for **Peek step targets** and **Dev mode actions** make the source of the dialog clearer.

[0.1.27]: https://github.com/lntvan166/cucumber-jump-ext/compare/v0.1.26...v0.1.27
