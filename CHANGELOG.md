# Changelog

All notable changes to **Cucumber Jump** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
