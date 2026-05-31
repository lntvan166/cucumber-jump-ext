# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Cucumber Jump** is a VS Code extension that enables bidirectional navigation between Gherkin `.feature` files and step definitions across **Java, Kotlin, Python, JavaScript, TypeScript, Ruby, C#, Dart, and Go**. It auto-detects the language from the `stepsGlob` file extension.

The Go legacy path (using a separate `bdd.go` step registry) is fully preserved for backward compatibility.

## Commands

```bash
# Compile TypeScript to out/
npm run compile

# Watch mode (incremental compile)
npm run watch

# Run unit tests (Vitest)
npm test

# Run tests in watch mode
npm run test:watch

# Package .vsix for local install
npm run package

# Package for VS Code Marketplace (injects correct base URLs for README images)
npm run package:marketplace
```

**Testing:** Vitest unit tests live in `src/adapters/__tests__/`. They test pure TypeScript (no VS Code API) and run directly via Node. Run a single test file with `npm test -- <filename>` (e.g. `npm test -- javaAdapter`).

Manual end-to-end testing is done by launching the Extension Development Host via `.vscode/launch.json`.

## Architecture

All source is in `src/`. Compiled output goes to `out/` (gitignored). Entry point: `src/extension.ts`.

### Two resolution paths

**New adapter path** (all languages, no `bddFile` in config):

```
.feature step text
  → featureParser.ts     extract + normalize step text
  → config.ts            build resolution chain from cucumberJump.projects/libraries
  → adapterRegistry.ts   pick adapter from stepsGlob extension
  → documentCache.ts     getStepDefinitions(uri, adapter)  [mtime cache]
  → adapters/*.ts        parseStepDefinitions() + matchesStep()
  → goImplFinder.ts      find func declaration (Go named handlers only)
  → Location
```

**Legacy Go path** (when `bddFile` is set in config — fully unchanged):

```
.feature step text
  → featureParser.ts     extract + normalize step text
  → config.ts            build resolution chain
  → documentCache.ts     getBddBlocks(bddUri)  [mtime cache]
  → bddParser.ts         parse StepMap (backtick key → handler name)
  → goImplFinder.ts      find func HandlerName( in *_steps.go
  → Location
```

The branch point is in `resolver.ts`: `if (entry.pack.bddFile)` routes to the legacy path; otherwise the adapter path runs.

### Key files

| File | Role |
|---|---|
| `src/languageAdapter.ts` | `StepDefinition` type, `LanguageAdapter` interface, `findDefinitionAtPosition` util |
| `src/adapterRegistry.ts` | Maps file extension (from `stepsGlob`) → `LanguageAdapter` instance |
| `src/adapters/cucumberExpression.ts` | Converts Cucumber Expressions (`{int}`, `(s)`, `word/word`) to `RegExp` |
| `src/adapters/goAdapter.ts` | Parses `ctx.Step(` / `s.Step(` patterns |
| `src/adapters/javaAdapter.ts` | Parses `@Given/@When/@Then` (Java + Kotlin — identical syntax) |
| `src/adapters/pythonAdapter.ts` | Parses `@given/@when/@then` (behave) |
| `src/adapters/jsAdapter.ts` | Parses `Given()/When()/Then()` string and `/regex/` forms (cucumber-js) |
| `src/adapters/rubyAdapter.ts` | Parses `Given/When/Then` string and `/regex/` blocks |
| `src/adapters/csharpAdapter.ts` | Parses `[Given]/[When]/[Then]/[StepDefinition]` attributes |
| `src/adapters/dartAdapter.ts` | Parses `given1()/when1()/then1()` (flutter_gherkin) |
| `src/config.ts` | Reads settings, builds resolution chain, resolves `**` globs to concrete paths |
| `src/documentCache.ts` | mtime-keyed cache for both `BddStepBlock[]` (legacy) and `StepDefinition[]` (new) |
| `src/resolver.ts` | Orchestrates all resolution: `resolveFromFeature`, `resolveFeatureUsagesFromStepsAtPosition`, `explainFeatureStepResolution`, etc. |
| `src/bddParser.ts` | **Legacy Go only** — parses StepMap backtick keys and handler names |
| `src/goImplFinder.ts` | Finds `func Name(` declarations in step files (used by both paths for Go named handlers) |
| `src/featureFinder.ts` | Reverse navigation — finds `.feature` lines matching a step pattern |
| `src/featureParser.ts` | Parses Gherkin step text, language-agnostic |
| `src/devMode.ts` | Paired-pane Dev mode session management |
| `src/stepUi.ts` | CodeLens, status bar hint, quick-pick, showStepResolution output |
| `src/extension.ts` | VS Code provider registration and event wiring |

### Core types

```typescript
// languageAdapter.ts — new adapter path
type StepDefinition = {
  pattern: string;           // regex or Cucumber Expression
  patternLine: number;       // 0-based line of the pattern declaration
  patternStartCol: number;
  patternEndCol: number;
  implFunctionName?: string; // named handler (separate from declaration, e.g. Go ctx.Step)
  implLine?: number;         // line of the function/method body
  bodyEndLine?: number;      // last line of the definition block (for reverse navigation)
};

interface LanguageAdapter {
  parseStepDefinitions(content: string): StepDefinition[];
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean;
}

// bddParser.ts — legacy Go path only
type BddStepBlock = {
  commentText: string | undefined;  // // comment above the map key (canonical step text)
  regexPattern: string;             // backtick-quoted Go regex
  regexLine: number;
  regexStartColumn: number;
  regexEndColumn: number;
  implFunctionName: string | undefined;  // from `return handler(state, …)`
  implLine: number | undefined;
};
```

### `matchesStep` logic (all adapters)

Every adapter's `matchesStep` applies the same three-stage priority:
1. **Normalized text equality** — `normalizeStepText(pattern) === normalizedStep`
2. **Cucumber Expression** — `isCucumberExpression(pattern)` → `cucumberExpressionToRegex(pattern).test(rawStep)`
3. **Regex or literal**:
   - Go adapter: `regexMatchesRawStep(pattern, rawStep)` (patterns always regex)
   - All others: if pattern starts with `^` or ends with `$` → use as regex; otherwise escape and anchor as literal string

### Adding a new language

1. Create `src/adapters/<lang>Adapter.ts` implementing `LanguageAdapter`
2. Create `src/adapters/__tests__/<lang>Adapter.test.ts` with Vitest tests
3. Add the extension mapping in `src/adapterRegistry.ts` (`EXT_MAP`)
4. Add `onLanguage:<lang>` to `activationEvents` in `package.json`
5. Add `{ language: "<lang>", scheme: "file" }` and `vscode-remote` variant to `adapterStepFileSelector` in `src/extension.ts`

### Dev mode

`devMode.ts` manages a split-pane session: implementation on the left (`ViewColumn.One`), `.feature` on the right (`ViewColumn.Two`). A `DevModeSession` holds the paired feature URI, column assignments, and disposables. Cursor movements trigger a debounced `syncFromEditor` → resolver → scroll opposite pane. Works for all supported step-file languages.

## Settings contract

All settings are under `cucumberJump.*`.

| Field | Required | Description |
|---|---|---|
| `featureGlob` | yes | Glob for `.feature` files |
| `stepsGlob` | yes | Glob for step files — extension determines language |
| `bddFile` | no (Go legacy only) | Step registry file for godog StepMap pattern |
| `name` | no | Label for documentation |

When `bddFile` or `stepsGlob` contains `**`, `config.ts` resolves it against the feature file's package root (segment before `/feature/`) or the steps file's package root (segment before `/testing/` or `/steps/`).

The resolution chain: one matching project (most specific `featureGlob`) → all libraries in order.
