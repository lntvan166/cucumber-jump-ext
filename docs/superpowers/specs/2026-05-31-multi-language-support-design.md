# Multi-Language Support Design

**Date:** 2026-05-31  
**Status:** Approved

## Goal

Extend Cucumber Jump to support all languages with official Cucumber bindings — Java, Kotlin, Python, JavaScript, TypeScript, Ruby, C#, Dart, and Go — while keeping full backward compatibility for the ~1k existing users of the Go-only version.

---

## Background

The current extension is built around a Go-specific two-level lookup:

1. `.feature` step → `bddFile` (step registry, e.g. `bdd.go`) — maps regex patterns to function names via a StepMap structure
2. `bddFile` → `*_steps.go` (implementation files) — locates the actual Go function

This two-level indirection is unique to the user's custom godog wiring pattern. All other Cucumber language bindings register steps directly on the implementation method/function via annotations, decorators, or function calls — no separate registry file.

---

## Architecture

### Core interface: `LanguageAdapter`

New file: `src/languageAdapter.ts`

```typescript
export type StepDefinition = {
  pattern: string;           // regex or Cucumber Expression
  patternLine: number;       // 0-based line of the pattern declaration
  patternStartCol: number;
  patternEndCol: number;
  implFunctionName?: string; // named handler (when separate from declaration line)
  implLine?: number;
};

export interface LanguageAdapter {
  parseStepDefinitions(content: string): StepDefinition[];
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean;
}
```

`StepDefinition` is the language-agnostic replacement for the Go-specific `BddStepBlock`. The shape is intentionally close so `documentCache.ts` and `resolver.ts` require only targeted changes.

### Adapter registry

New file: `src/adapterRegistry.ts`

Maps file extensions (inferred from `stepsGlob`) to adapter instances:

| Extension(s) | Adapter |
|---|---|
| `*.go` (no `bddFile`) | `GoAdapter` |
| `*.go` (with `bddFile`) | legacy path (existing `bddParser` + `goImplFinder`) |
| `*.java`, `*.kt` | `JavaAdapter` |
| `*.py` | `PythonAdapter` |
| `*.ts`, `*.js` | `JsAdapter` |
| `*.rb` | `RubyAdapter` |
| `*.cs` | `CsharpAdapter` |
| `*.dart` | `DartAdapter` |

Extension is extracted from the `stepsGlob` pattern (last non-wildcard segment). Fallback default is `GoAdapter`.

### File structure

```
src/
  adapters/
    goAdapter.ts          ← new: parses ctx.Step() / s.Step() patterns
    javaAdapter.ts        ← @Given/@When/@Then annotations (Java and Kotlin — identical syntax)
    pythonAdapter.ts      ← @given/@when/@then decorators (behave / pytest-bdd)
    jsAdapter.ts          ← Given()/When()/Then() calls (cucumber-js, TS + JS)
    rubyAdapter.ts        ← Given/When/Then blocks
    csharpAdapter.ts      ← [Given]/[When]/[Then] attributes (SpecFlow / Reqnroll)
    dartAdapter.ts        ← given1/when1/then1 registration (flutter_gherkin)
  languageAdapter.ts      ← StepDefinition type + LanguageAdapter interface
  adapterRegistry.ts      ← extension → adapter mapping
  bddParser.ts            ← KEPT UNCHANGED (legacy Go support)
  goImplFinder.ts         ← KEPT UNCHANGED (legacy Go support)
  documentCache.ts        ← refactored: caches StepDefinition[] instead of BddStepBlock[]
  resolver.ts             ← refactored: uses LanguageAdapter instead of Go-specific calls
  config.ts               ← bddFile becomes optional; no other changes
  featureFinder.ts        ← UNCHANGED (already language-agnostic)
  featureParser.ts        ← UNCHANGED
  extension.ts            ← minor: wire adapter registry
  devMode.ts              ← UNCHANGED
  stepUi.ts               ← UNCHANGED
  conflictHint.ts         ← UNCHANGED
  sameFileUri.ts          ← UNCHANGED
  editorNavigate.ts       ← UNCHANGED
```

---

## Step patterns parsed per language

### Go (new adapter — no `bddFile`)

Parses standard godog registration:

```go
ctx.Step(`^I have (\d+) cucumbers$`, iHaveCucumbers)
s.Step("when the user logs in", loginHandler)
suite.Step(`^pattern$`, func(ctx context.Context) error { ... })
```

Regex: `\.\bStep\s*\(\s*[` + '`' + `"](.*?)[` + '`' + `"]\s*,\s*([a-zA-Z0-9_]+|\bfunc\b)`

- Backtick and double-quoted patterns both supported
- Named handler → `implFunctionName` set; anonymous func → `implLine` set to declaration line
- Scans the same `stepsGlob` files for `func handlerName(` to find the precise implementation line

### Java / Kotlin

```java
@Given("I have {int} cucumbers in a basket")
public void iHaveCucumbers(int n) { ... }
```

```kotlin
@Given("I have {int} cucumbers")
fun iHaveCucumbers(n: Int) { ... }
```

Regex: `@(Given|When|Then|And|But)\s*\(\s*["](.*?)["]\s*\)`

- `implFunctionName` extracted from the method declaration on the next non-blank line

### Python (behave / pytest-bdd)

```python
@given('I have {n:d} cucumbers')
def step_impl(context, n):
    ...
```

Regex: `@(given|when|then|step)\s*\(\s*['"](.*?)['"]\s*\)`

- Case-insensitive keyword match
- `implFunctionName` extracted from the `def` on the next non-blank line

### JavaScript / TypeScript (cucumber-js)

```typescript
Given('I have {int} cucumbers', function(n: number) { ... })
When(/^the user logs in$/, (ctx) => { ... })
```

Regex string literal: `(Given|When|Then|And|But)\s*\(\s*['"\`](.*?)['"\`]`  
Regex literal: `(Given|When|Then|And|But)\s*\(\s*/(.*?)/`

- Both string and `/regex/` forms supported
- Anonymous functions are common; `implLine` points to the declaration line

### Ruby

```ruby
Given('I have {int} cucumbers') do |n|
  ...
end

When(/^the user logs in$/) do
  ...
end
```

Regex: `(Given|When|Then|And|But)\s*\(\s*['"](.*?)['"]\s*\)|/(.*?)/\s*\)`

### C# (SpecFlow / Reqnroll)

```csharp
[Given("I have {int} cucumbers")]
public void IHaveCucumbers(int n) { ... }
```

Regex: `\[(Given|When|Then|And|But)\s*\(\s*["](.*?)["]\s*\)\]`

- `implFunctionName` extracted from the method on the next non-blank line

### Dart (flutter_gherkin)

```dart
given1<int>('I have {int} cucumbers', (world, n) async {
  ...
})
```

Regex: `(given\d*|when\d*|then\d*|and\d*|but\d*)\s*[<(]`  
Pattern string extracted from first string argument.

---

## Config changes

`bddFile` becomes **optional** in the JSON schema. It is silently ignored for all non-Go languages. Existing Go configs with `bddFile` continue to work without any changes.

**Before (existing users, unchanged):**
```json
{
  "featureGlob": "services/my-api/feature/**/*.feature",
  "bddFile": "**/testing/bdd.go",
  "stepsGlob": "**/testing/*_steps.go"
}
```

**After (new users, simpler):**
```json
{
  "featureGlob": "services/my-api/feature/**/*.feature",
  "stepsGlob": "services/my-api/testing/*_steps.go"
}
```

```json
{
  "featureGlob": "src/test/**/*.feature",
  "stepsGlob": "src/test/**/*Steps.java"
}
```

---

## Navigation flows

### Forward: `.feature` → implementation

1. Extract step text from cursor line (`featureParser.ts`, unchanged)
2. Build resolution chain for the feature URI (`config.ts`, unchanged)
3. For each entry in chain:
   - If `bddFile` is set → **legacy path** (existing `bddParser` + `goImplFinder`)
   - Else → get adapter from `adapterRegistry` by `stepsGlob` extension
   - Find all files matching `stepsGlob`
   - For each file: call `adapter.parseStepDefinitions(content)`
   - Find first definition where `adapter.matchesStep(def, rawStep, normalized)` is true
   - Return location (definition line, or resolved impl line for named handlers)
4. Cache results in `documentCache.ts` (keyed by URI + mtime, same as today)

### Reverse: step file → `.feature` usages

1. Detect which pack the current file belongs to (`config.ts`, unchanged)
2. If legacy Go path (bddFile present) → existing `resolveFromBdd` logic, unchanged
3. Else:
   - Get adapter for the file's extension
   - `adapter.parseStepDefinitions(content)` for the open document
   - Find the definition whose range contains the cursor: a definition's range spans from its annotation/decorator line through the end of the function body (closing brace/`end`/dedent). The cursor anywhere in that range activates reverse navigation for that step.
   - Pass pattern to `featureFinder.ts` (unchanged) to search `.feature` files

---

## Backward compatibility

| Scenario | Behavior |
|---|---|
| Existing Go config with `bddFile` | Fully unchanged — legacy path used |
| Existing Go config without `bddFile` | New Go adapter used (ctx.Step parsing) |
| New Java/Python/JS/etc. config | New adapter path, no `bddFile` needed |
| Unknown extension in `stepsGlob` | Falls back to Go adapter |

No deprecation warnings are shown. The `bddFile` field stays in the schema and the settings UI indefinitely.

---

## Testing plan

- Unit tests for each adapter's `parseStepDefinitions()` with representative real-world files
- Unit tests for `matchesStep()` covering string literals, regex literals, and Cucumber Expressions
- Existing Go tests kept and extended to cover the new `goAdapter.ts`
- Integration tests (manual) for each language: forward navigation + reverse navigation
- Regression check: existing Go project with `bddFile` must behave identically before and after

---

## Out of scope

- Autocomplete / step suggestions (separate feature)
- Cucumber Expression evaluation beyond normalized text matching (e.g. `{int}` type checking)
- Languages not listed above (can be added later by creating a new adapter file)
- Go module detection or multi-module workspace support
