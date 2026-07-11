# Zero-setup onboarding — design spec

**Date:** 2026-07-12
**Status:** approved for planning
**Target release:** 2.1.0

## Problem

Cucumber Jump 2.0.0 requires hand-written `cucumberJump.projects` JSON before
anything works. A new user who installs from the Marketplace and opens a
`.feature` file gets nothing: no jump, no hint, no path from install to value.
The 2.0.0 review identified onboarding as the top adoption blocker. There is
also no CI, so a red build can reach `main` unnoticed.

## Goal

A user who installs the extension and opens a `.feature` file in a workspace
with recognizable step definitions gets working navigation with **zero setup**.
Users who want explicit control get a one-command setup. Success criteria:

- F12 on a step line resolves in an unconfigured workspace whose features and
  steps the scanner can pair (all layouts in `manual-test-seed.py` except
  `broken/`).
- No behavior change of any kind in workspaces that have explicit config.
- `npm test` + `npm run compile` run on every push/PR via GitHub Actions.

Out of scope for this phase: localized Gherkin, multi-language packs,
ambiguous-step picker, demo GIF refresh (blocked on maintainer screen
recording), any parser edge cases.

## Architecture

Everything is TypeScript inside the extension. No shell scripts, no external
processes, no new runtime dependencies.

```
.feature opened, no explicit config
  → configScanner.ts   scanWorkspace() → ScanProposal[]      [new, pure logic]
  → inferredConfig.ts  holds proposals as in-memory packs    [new]
  → config.ts          effective config = settings ?? inferred
  → (everything downstream unchanged: resolver, adapters, UI)
```

### 1. Scanner — `src/configScanner.ts`

Match-driven: proposals are backed by real step↔definition matches, not
directory-name guessing.

Algorithm:
1. `findFiles('**/*.feature', node_modules excluded, cap 5000)`. Group feature
   files by directory.
2. `findFiles` for each known step extension (from `adapterRegistry` — export
   the extension list). Skip files > 512 KB.
3. Extract step texts per feature directory via `featureParser`
   (`getStepTextAtLineNumber` over each line), sampling at most 40 steps per
   directory.
4. Parse each candidate step file with its adapter (`getAdapterForUri`) and
   keep files with ≥ 1 step definition.
5. Score every (feature-dir, step-file-dir-tree, language) pair: number of
   sampled steps with ≥ 1 matching definition (`adapter.matchesStep`).
6. Emit proposals where matched ≥ 1, best-scoring steps tree per feature
   tree. Derive globs from the tightest common roots:
   `{ name, featureGlob, stepsGlob, language, matchedSteps, totalSteps }`.

Types:

```typescript
type ScanProposal = {
  name: string;          // derived from the common root dir, e.g. "orders"
  featureGlob: string;   // e.g. "orders/features/**/*.feature"
  stepsGlob: string;     // e.g. "orders/steps/**/*.java"
  language: string;      // extension, e.g. "java"
  matchedSteps: number;
  totalSteps: number;    // sampled
};

function scanWorkspace(folder, token): Promise<ScanProposal[]>
```

File collection uses the VS Code API and stays in the scanner's thin shell;
grouping/scoring/glob-derivation are pure functions operating on
`{ relPath, content }` records so Vitest can cover them with fixture objects —
no filesystem in unit tests.

### 2. Inferred config — `src/inferredConfig.ts` + `config.ts` hook

- `config.ts`'s pack lookup functions (`getResolutionChainForFeature`,
  `findPackForStepsFile`) consult explicit settings first; if **no projects and
  no libraries are configured for the folder**, they fall back to
  `getInferredPacks(folder)`.
- Inference lifecycle: triggered lazily the first time a `.feature` resolution
  runs in an unconfigured folder; runs once per session per folder; result
  cached in memory. `cucumberJump.rescanWorkspace` command re-runs it.
  Invalidated when explicit config appears (config-change listener already
  exists in `extension.ts`).
- Guardrails: async and cancellable; never blocks activation; scan errors are
  logged to the existing "Cucumber Jump" output channel and produce an empty
  result (extension behaves exactly like today).
- `explainFeatureStepResolution` prints `(inferred — not saved to settings)`
  next to packs that came from inference, plus the match evidence.
- New setting `cucumberJump.autoConfigure` (boolean, default `true`) to opt
  out of inference entirely.

### 3. Save offer (one-time toast)

After the first inference that yields ≥ 1 proposal **and** a successful
resolution actually used it, show once per workspace
(`workspaceState` key):

> Cucumber Jump configured itself — N project(s) detected.
> [Save to settings] [Adjust…] [Don't ask again]

- **Save to settings** — writes the inferred projects to
  `.vscode/settings.json` verbatim.
- **Adjust…** — opens the Create-configuration quick-pick pre-populated with
  the proposals.
- **Don't ask again** — sets the workspaceState flag; inference keeps working
  silently.

If inference found nothing, show instead (also once): "Cucumber Jump couldn't
detect your step definitions — [Set up manually] [Open walkthrough]" where
*Set up manually* runs the Create-configuration command (which will offer the
template fallback).

### 4. `Cucumber Jump: Create configuration` command

`cucumberJump.createConfiguration`:
1. Runs `scanWorkspace` with a progress notification.
2. Multi-select quick-pick, all items pre-checked. Label: project name +
   language; detail: `matched 23/31 steps · orders/features → orders/steps`.
3. Writes selected proposals to `.vscode/settings.json`
   (`ConfigurationTarget.Workspace`), merging with (not clobbering) any
   existing entries; skips proposals whose featureGlob already exists.
4. Opens the first matching `.feature` and runs `goToPrimaryStepTarget` so the
   user sees a working jump immediately.
5. Zero proposals → offer to insert a commented template of
   `cucumberJump.projects` into settings instead.

### 5. Walkthrough

`contributes.walkthroughs`, one walkthrough, three steps (markdown lives in
`media/walkthrough/*.md`):
1. **Set up** — button runs `createConfiguration`; completes on command run or
   when config/inference exists (`onContext`).
2. **Jump** — try F12 on a step line; completes on command
   `goToPrimaryStepTarget`.
3. **Extras** — enable Dev mode, CodeLens, status-bar hint (links to settings).

### 6. CI

`.github/workflows/ci.yml`: on push + PR to `main` — checkout, Node 20,
`npm ci`, `npm test`, `npm run compile`. Add a badge to README.

## Error handling

- Scanner: per-file read/parse failures are skipped and counted; a summary
  line goes to the output channel. Cancellation propagates the token.
- Settings write failures surface a `showErrorMessage` with the JSON to copy
  manually.
- Inference must never throw into the resolver path: `getInferredPacks`
  catches internally and returns `[]`.

## Testing

- **Vitest (new `src/__tests__/configScanner.test.ts`):** pure
  scoring/grouping/glob-derivation functions against
  fixture layouts mirroring `manual-test-seed.py` — per-language projects, a
  monorepo with sibling feature/step trees, a repo with zero matches, two
  same-language projects (must yield two proposals, not one broad glob).
- **Manual:** `manual-test-seed.py` gains a `--no-config` flag that seeds the
  same workspace without `.vscode/settings.json`; TESTPLAN.md gains rows:
  zero-setup F12 works, toast appears once, Save writes correct settings,
  rescan command, walkthrough completes, `broken/` still warns.
- CI proves itself on its first PR.

## Decisions log

- Match-driven scanning (approach B) chosen over directory heuristics and
  broad-glob defaults; broad-glob template kept only as the empty-result
  fallback.
- Zero-setup inference chosen as the primary UX per maintainer ("none setup is
  the best"); the command remains for explicit control.
- All logic in-extension TypeScript — explicitly no `.sh`/`.py` for users.
- One notification total per workspace, native surfaces only (ClaudeGate
  lessons: ≤ 3-step onboarding, prefer native UI).
