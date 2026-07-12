# Missing-step diagnostics + "Create step definition" quick-fix — design

**Date:** 2026-07-12
**Status:** Approved (brainstorming)
**Target version:** 2.2.0 (minor — additive, opt-in)

## Summary

Turn Cucumber Jump from a pure *navigation* tool into an *authoring* tool for its
first step. Two tightly-coupled capabilities:

1. **Missing-step diagnostics** — an opt-in warning (yellow squiggle) on every
   `.feature` step (`Given/When/Then/And/But`) that the resolver cannot match to
   a step definition.
2. **"Create step definition" quick-fix** — a lightbulb code action on a
   squiggled step that generates a correctly-formatted stub in the right language
   and inserts it into a step file the user picks.

Autocomplete, "create all missing steps in file", and data-table/doc-string
awareness are explicitly **out of scope** for this spec.

## Product decisions (locked)

- **Enablement:** new setting `cucumberJump.diagnosticsEnabled`, default **false**
  (matches the `codeLensEnabled` / `statusBarHintEnabled` precedent — no surprise
  noise for existing users).
- **Severity:** `DiagnosticSeverity.Warning` (yellow squiggle).
- **Stub target:** quick-pick among existing step files matched by `stepsGlob`,
  plus a "＋ New file…" option when a path can be proposed.
- **Class-based placement:** append the stub at end of file with a marker comment
  (the *simplified* option — we do **not** attempt to insert before the final
  closing brace).

## UX flow

1. User enables `cucumberJump.diagnosticsEnabled`.
2. Opening a `.feature` file squiggles every step with no matching definition
   ("No matching step definition").
3. Cursor on a squiggled step → lightbulb → **"Cucumber Jump: Create step
   definition"**.
4. Quick-pick lists the `stepsGlob`-matched step files (workspace-relative,
   most-recently-used first) plus "＋ New file…" when a path can be proposed.
5. Pick a target → stub inserted via `WorkspaceEdit`, file opened, cursor placed
   in the stub body.
6. Squiggle clears on the next diagnostic pass (the new definition now resolves).

## Architecture

### Modules

| File | Change | Role |
|---|---|---|
| `src/diagnostics.ts` | **new** | Owns a `DiagnosticCollection`; on feature open/edit (debounced) + step-file save + config change, walks each step line, calls `stepResolves`, publishes warnings for unmatched steps. Per-document cancellation. |
| `src/resolver.ts` | add `stepResolves(document, line, token): Promise<StepResolutionState>` | Reuses the existing chain logic without constructing `Location`s. Returns whether the file is *eligible* for diagnostics and whether the step matched — one source of truth shared with navigation. |
| `src/featureParser.ts` | add `getStepKeywordAtLine(text, line): { keyword, body } \| undefined` | Returns the effective Given/When/Then keyword (resolving `And`/`But` by scanning upward) plus the step body. Existing `getStepTextAtLineNumber` is unchanged. |
| `src/stepStubber.ts` | **new, pure** | `generateStub({ keyword, stepText, adapterId }): string`. Parameter inference + naming + per-language template. Unit-tested like the adapters. |
| `src/adapters/*.ts` | add stub-template capability | Each adapter contributes its language's stub shape so "one language = one file" still holds. See "Stub ownership" below. |
| `src/extension.ts` | register providers | `CodeActionProvider` on the feature selector + diagnostics lifecycle wiring + the new command. |

### Stub ownership

`stepStubber.ts` holds the language-agnostic pieces: parameter inference
(step text → parameter list + rewritten pattern) and identifier derivation.
Each adapter exposes a small template descriptor consumed by the stubber, e.g.:

```typescript
// languageAdapter.ts — additive, optional
interface StepStubTemplate {
  patternStyle: 'cucumber' | 'go-regex';
  isClassBased: boolean;            // append-with-marker when true
  render(ctx: StubRenderContext): string;
}
interface LanguageAdapter {
  // ...existing...
  stubTemplate?: StepStubTemplate;  // undefined → quick-fix not offered for this language
}
```

Adapters without a `stubTemplate` simply don't offer the quick-fix (diagnostics
still work — resolution is unaffected).

## Diagnostics engine (`diagnostics.ts`)

### When a step is flagged

A step is flagged **only** when a missing match is meaningful. `stepResolves`
returns an eligibility signal so the engine can decide per-file:

- Resolution chain empty for this feature → **no diagnostics for the file**.
- Chain exists but adapter undetectable OR **zero** step files found →
  **no diagnostics** (misconfiguration, already surfaced by *Show step
  resolution* — not a missing step).
- Chain exists, adapter resolves, ≥1 step file found, step matches no
  definition → **Warning** on the step's text range.

Consequence: a brand-new project with no step files yet shows **no** squiggles
until at least one step file exists. Deliberate — avoids a wall of yellow on
unconfigured repos.

### Lifecycle

Refresh on:
- feature file open,
- feature file edit (debounced ~300ms),
- **step file save** (a new/edited definition can clear squiggles in open features),
- `cucumberJump.*` config change,
- setting toggled on.

A per-document `CancellationTokenSource` supersedes in-flight passes. The
collection is cleared when the setting is turned off and on `dispose`.

### Legacy Go `bddFile` path

Included. `stepResolves` routes through the same `if (entry.pack.bddFile)`
branch point navigation uses, so godog StepMap projects get diagnostics too.

## Stub generation (`stepStubber.ts`)

### Pattern style + parameter inference

Cucumber Expression for all languages **except Go** (godog is regex-only →
anchored regex). Inference over the step body:

| In step text | Cucumber Expression | Go regex |
|---|---|---|
| `"quoted"` | `{string}` | `"([^"]*)"` |
| standalone integer `42` | `{int}` | `(\d+)` |
| decimal `3.14` | `{float}` | `([\d.]+)` |
| everything else | literal | escaped literal, wrapped `^…$` |

### Naming + body

- Function/method name derived from the step body, per language convention
  (`the user logs in` → snake_case for Python/Ruby/Go, camelCase for JS/TS,
  etc.). Collisions are not resolved here (the user picks the target file); the
  stub is a starting point.
- Body is a pending/TODO marker per language (`raise NotImplementedError`,
  `throw new PendingException()`, `pending()`, `return godog.ErrPending`, …).
  Cursor is placed in the body.

### Placement (simplified)

- **All languages:** append the stub at **end of file**.
- **Class-based languages** (Java, Kotlin, C#, Dart): prefix the appended block
  with a marker comment, e.g.
  `// TODO(Cucumber Jump): move this method inside your step-definition class`.
  We do **not** attempt to locate the class body.

Example — `When the user enters "admin" and 3 codes`:

```python
@when('the user enters {string} and {int} codes')
def step_impl(context, arg1, arg2):
    raise NotImplementedError
```

```java
// TODO(Cucumber Jump): move this method inside your step-definition class
@When("the user enters {string} and {int} codes")
public void the_user_enters_and_codes(String arg1, int arg2) {
    throw new io.cucumber.java.PendingException();
}
```

## Quick-fix + target selection

- `CodeActionProvider` on the feature-file selector, kind `QuickFix`, offered
  only when the cursor line carries a Cucumber Jump diagnostic **and** the
  resolved adapter has a `stubTemplate`.
- The action invokes command `cucumberJump.createStepDefinition`, which:
  1. Rebuilds the step-file list from the resolution chain's `stepsGlob` (same
     `findFiles` the resolver uses).
  2. Shows a `QuickPick` (workspace-relative paths, most-recently-used first)
     plus "＋ New file…" when a path can be proposed.
  3. Inserts the stub via `WorkspaceEdit`, opens the file, reveals + selects the
     stub body.
- **"＋ New file…"** proposes a path next to a sibling step file (or in the steps
  root the scanner already knows), pre-filled + editable, seeded with the
  language's minimal file scaffold (imports + class wrapper for class-based
  languages) plus the stub.
- The command is also palette-invokable when the cursor is on an unmatched step.

## Settings & commands

- **Setting:** `cucumberJump.diagnosticsEnabled` — boolean, default `false`,
  `markdownDescription` mirroring the CodeLens/status-bar wording.
- **Command:** `cucumberJump.createStepDefinition` — "Cucumber Jump: Create step
  definition".

## Testing

- **Vitest (pure):** `stepStubber` gets a test file per language covering
  parameter inference, keyword→annotation mapping, `And`/`But` keyword
  resolution, identifier derivation, and escaping — same rigor as the adapter
  suite.
- The diagnostics *decision* logic (the file-eligibility gate + per-step match
  check) is extracted pure where possible so it is unit-testable without the
  VS Code API.
- Manual end-to-end via the Extension Development Host: enable the setting,
  confirm squiggles appear/clear, run the quick-fix into an existing file and a
  new file, across at least one decorator language (Python) and one class-based
  language (Java).

## Docs

- README: short "Authoring: create missing steps" section.
- CHANGELOG: `2.2.0` entry.
- `docs/ai-setup-prompt.txt`: unaffected.

## Out of scope (YAGNI)

- Step autocompletion (separate future spec).
- "Create all missing steps in file" bulk action.
- Data-table / doc-string awareness in generated signatures.
- Inserting class-based stubs *inside* the class body (simplified to
  append + marker for this release).
