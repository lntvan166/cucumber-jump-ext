# Changelog

All notable changes to **Cucumber Jump** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
