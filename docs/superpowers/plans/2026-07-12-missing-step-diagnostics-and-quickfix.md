# Missing-Step Diagnostics + Create-Step Quick-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Cucumber Jump into an authoring tool — flag `.feature` steps with no matching step definition (opt-in warning squiggles) and offer a lightbulb quick-fix that generates a correctly-formatted stub in the right language.

**Architecture:** Pure, unit-tested primitives (keyword extraction, parameter inference, per-language stub templates on each adapter) sit under two VS Code glue layers: a `DiagnosticCollection` engine that runs the existing resolver over every step in a feature file, and a `CodeActionProvider` + command that renders a stub and inserts it into a user-chosen step file. All new matching reuses the existing resolution chain so navigation and diagnostics stay in lock-step.

**Tech Stack:** TypeScript, VS Code Extension API (`languages.createDiagnosticCollection`, `CodeActionProvider`, `WorkspaceEdit`), Vitest for pure logic.

## Global Constraints

- **VS Code engine floor:** `^1.85.0` (do not use APIs newer than this).
- **No new runtime dependencies** — only `vscode` (dev) and the existing `minimatch`.
- **Test location:** Vitest only discovers `src/**/__tests__/**/*.test.ts` (see `vitest.config.ts`). Pure-logic tests go there. VS Code glue is verified by `npm run compile` + manual Extension Development Host, matching the repo's existing practice (`resolver.ts`, `extension.ts`, `stepUi.ts` have no unit tests).
- **Settings namespace:** all settings under `cucumberJump.*`.
- **Advanced-feature default:** new user-facing toggles default `false` (precedent: `codeLensEnabled`, `statusBarHintEnabled`).
- **Commit style:** end every commit message with the Co-Authored-By trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Diagnostic identity:** every diagnostic this feature emits uses `source = "Cucumber Jump"` and `code = "missing-step"` so the code-action provider can find them.
- **Keyword semantics:** `And`/`But` inherit the governing `Given`/`When`/`Then` above them; a leading `And`/`But` with nothing above defaults to `Given`.
- **Pattern style:** Cucumber Expression for every language except Go; Go uses an anchored regex (godog is regex-only).

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/featureParser.ts` | Modify | Add `getStepKeywordAtLine` (keyword + body, `And`/`But` resolved). |
| `src/stepStubber.ts` | Create | Pure: parameter inference (`inferPattern`), identifier derivation, casing + escaping helpers. |
| `src/languageAdapter.ts` | Modify | Add `StubParamType`, `StubRenderInput`, `StepStubTemplate`; add optional `stubTemplate` to `LanguageAdapter`. |
| `src/adapters/pythonAdapter.ts`, `javaAdapter.ts` | Modify | Add `stubTemplate` (decorator archetype + class archetype with Kotlin branch). |
| `src/adapters/jsAdapter.ts`, `rubyAdapter.ts`, `csharpAdapter.ts`, `dartAdapter.ts`, `goAdapter.ts` | Modify | Add `stubTemplate` for the remaining languages. |
| `src/resolver.ts` | Modify | Add `findUnmatchedSteps` — one file scan, both resolution paths, returns eligibility + unmatched line numbers. |
| `src/diagnostics.ts` | Create | `DiagnosticCollection` engine + lifecycle (open/edit/save/config), per-doc debounce + cancellation. |
| `src/codeActions.ts` | Create | `CodeActionProvider` + `cucumberJump.createStepDefinition` command (quick-pick target, new-file scaffold, `WorkspaceEdit`). |
| `src/extension.ts` | Modify | Call `registerDiagnostics` and `registerStepAuthoring`. |
| `package.json` | Modify | Add `cucumberJump.diagnosticsEnabled` setting + `cucumberJump.createStepDefinition` command. |
| `src/__tests__/featureParser.test.ts` | Create | Tests for Task 1. |
| `src/__tests__/stepStubber.test.ts` | Create | Tests for Task 2. |
| `src/adapters/__tests__/*Adapter.test.ts` | Modify | Add a `stubTemplate` describe block per language (Tasks 3–4). |
| `README.md`, `CHANGELOG.md` | Modify | Docs (Task 8). |

---

## Task 1: Step keyword extraction

**Files:**
- Modify: `src/featureParser.ts`
- Test: `src/__tests__/featureParser.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```typescript
  export type StepKeyword = 'Given' | 'When' | 'Then';
  export function getStepKeywordAtLine(
    documentText: string,
    zeroBasedLine: number,
  ): { keyword: StepKeyword; body: string } | undefined;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/featureParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getStepKeywordAtLine } from '../featureParser';

const doc = [
  'Feature: login',
  '  Scenario: ok',
  '    Given the user is on the login page',
  '    When the user submits credentials',
  '    And the form is valid',
  '    Then the dashboard is shown',
  '    But no error is shown',
  '    # a comment',
].join('\n');

describe('getStepKeywordAtLine', () => {
  it('returns the literal keyword and body for Given/When/Then', () => {
    expect(getStepKeywordAtLine(doc, 2)).toEqual({ keyword: 'Given', body: 'the user is on the login page' });
    expect(getStepKeywordAtLine(doc, 3)).toEqual({ keyword: 'When', body: 'the user submits credentials' });
    expect(getStepKeywordAtLine(doc, 5)).toEqual({ keyword: 'Then', body: 'the dashboard is shown' });
  });

  it('resolves And to the governing keyword above it', () => {
    expect(getStepKeywordAtLine(doc, 4)).toEqual({ keyword: 'When', body: 'the form is valid' });
  });

  it('resolves But to the governing keyword above it', () => {
    expect(getStepKeywordAtLine(doc, 6)).toEqual({ keyword: 'Then', body: 'no error is shown' });
  });

  it('defaults a leading And/But to Given', () => {
    const orphan = ['  Scenario: x', '    And something happens'].join('\n');
    expect(getStepKeywordAtLine(orphan, 1)).toEqual({ keyword: 'Given', body: 'something happens' });
  });

  it('returns undefined for non-step lines', () => {
    expect(getStepKeywordAtLine(doc, 0)).toBeUndefined();
    expect(getStepKeywordAtLine(doc, 7)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- featureParser`
Expected: FAIL — `getStepKeywordAtLine is not a function` / not exported.

- [ ] **Step 3: Add the implementation**

In `src/featureParser.ts`, the existing `stepKeywordRegex` already captures the keyword in group 1 and body in group 2. Add after `parseStepLine`:

```typescript
export type StepKeyword = 'Given' | 'When' | 'Then';

/**
 * Returns the effective Given/When/Then keyword for a step line plus its body.
 * `And`/`But` inherit the nearest governing Given/When/Then above them; a leading
 * And/But with nothing above defaults to `Given`. Returns undefined for
 * non-step lines (comments, blank, feature/scenario headers).
 */
export function getStepKeywordAtLine(
  documentText: string,
  zeroBasedLine: number,
): { keyword: StepKeyword; body: string } | undefined {
  const lines = documentText.split(/\r?\n/);
  if (zeroBasedLine < 0 || zeroBasedLine >= lines.length) {
    return undefined;
  }

  const here = lines[zeroBasedLine].trim().match(stepKeywordRegex);
  if (!here) {
    return undefined;
  }

  const rawKeyword = here[1];
  const body = here[2].trim();

  if (rawKeyword === 'Given' || rawKeyword === 'When' || rawKeyword === 'Then') {
    return { keyword: rawKeyword, body };
  }

  // And / But: scan upward for the governing keyword.
  for (let i = zeroBasedLine - 1; i >= 0; i--) {
    const m = lines[i].trim().match(stepKeywordRegex);
    if (!m) {
      continue;
    }
    const kw = m[1];
    if (kw === 'Given' || kw === 'When' || kw === 'Then') {
      return { keyword: kw, body };
    }
  }

  return { keyword: 'Given', body };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- featureParser`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/featureParser.ts src/__tests__/featureParser.test.ts
git commit -m "feat: getStepKeywordAtLine resolves And/But to governing keyword

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Stub-generation primitives

**Files:**
- Create: `src/stepStubber.ts`
- Test: `src/__tests__/stepStubber.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```typescript
  export type StubParamType = 'string' | 'int' | 'float';
  export interface InferredPattern {
    cucumber: string;             // e.g. "the user enters {string} and {int} codes"
    goRegex: string;              // e.g. "^the user enters \"([^\"]*)\" and (\\d+) codes$"
    paramTypes: StubParamType[];  // in left-to-right order of appearance
  }
  export function inferPattern(stepBody: string): InferredPattern;
  export function deriveIdentifierWords(stepBody: string): string[];
  export function toSnake(words: string[]): string;
  export function toLowerCamel(words: string[]): string;
  export function toUpperCamel(words: string[]): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/stepStubber.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  inferPattern,
  deriveIdentifierWords,
  toSnake,
  toLowerCamel,
  toUpperCamel,
} from '../stepStubber';

describe('inferPattern', () => {
  it('maps quoted strings, integers and floats to typed placeholders', () => {
    const r = inferPattern('the user enters "admin" and 3 codes');
    expect(r.cucumber).toBe('the user enters {string} and {int} codes');
    expect(r.goRegex).toBe('^the user enters "([^"]*)" and (\\d+) codes$');
    expect(r.paramTypes).toEqual(['string', 'int']);
  });

  it('detects floats before ints', () => {
    const r = inferPattern('deposit 3.50 dollars');
    expect(r.cucumber).toBe('deposit {float} dollars');
    expect(r.goRegex).toBe('^deposit ([\\d.]+) dollars$');
    expect(r.paramTypes).toEqual(['float']);
  });

  it('escapes cucumber-special and regex-special literal characters', () => {
    const r = inferPattern('the (admin) user');
    expect(r.cucumber).toBe('the \\(admin\\) user');
    expect(r.goRegex).toBe('^the \\(admin\\) user$');
    expect(r.paramTypes).toEqual([]);
  });
});

describe('identifier helpers', () => {
  it('derives lowercased words, ignoring quoted literals', () => {
    expect(deriveIdentifierWords('the user enters "admin"')).toEqual(['the', 'user', 'enters']);
  });

  it('falls back to ["step"] when nothing usable remains', () => {
    expect(deriveIdentifierWords('"x" 42')).toEqual(['step']);
  });

  it('cases words', () => {
    const w = ['the', 'user', 'logs', 'in'];
    expect(toSnake(w)).toBe('the_user_logs_in');
    expect(toLowerCamel(w)).toBe('theUserLogsIn');
    expect(toUpperCamel(w)).toBe('TheUserLogsIn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stepStubber`
Expected: FAIL — cannot resolve `../stepStubber`.

- [ ] **Step 3: Write the implementation**

Create `src/stepStubber.ts`:

```typescript
export type StubParamType = 'string' | 'int' | 'float';

export interface InferredPattern {
  cucumber: string;
  goRegex: string;
  paramTypes: StubParamType[];
}

// A double-quoted literal, a decimal, or an integer — matched left to right.
const TOKEN_RE = /"(?:[^"\\]|\\.)*"|\d+\.\d+|\d+/g;

// Cucumber Expression special characters that must be backslash-escaped in literal text.
function escapeCucumberLiteral(text: string): string {
  return text.replace(/[\\(){}/]/g, '\\$&');
}

function escapeGoRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function inferPattern(stepBody: string): InferredPattern {
  const paramTypes: StubParamType[] = [];
  let cucumber = '';
  let goRegex = '';
  let last = 0;

  for (const m of stepBody.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    const literal = stepBody.slice(last, idx);
    cucumber += escapeCucumberLiteral(literal);
    goRegex += escapeGoRegexLiteral(literal);

    const tok = m[0];
    if (tok.startsWith('"')) {
      paramTypes.push('string');
      cucumber += '{string}';
      goRegex += '"([^"]*)"';
    } else if (tok.includes('.')) {
      paramTypes.push('float');
      cucumber += '{float}';
      goRegex += '([\\d.]+)';
    } else {
      paramTypes.push('int');
      cucumber += '{int}';
      goRegex += '(\\d+)';
    }
    last = idx + tok.length;
  }

  const tail = stepBody.slice(last);
  cucumber += escapeCucumberLiteral(tail);
  goRegex += escapeGoRegexLiteral(tail);

  return { cucumber, goRegex: `^${goRegex}$`, paramTypes };
}

export function deriveIdentifierWords(stepBody: string): string[] {
  const words = stepBody
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ') // drop quoted literals
    .replace(/\d+\.\d+|\d+/g, ' ')      // drop numeric literals
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  return words.length > 0 ? words : ['step'];
}

export function toSnake(words: string[]): string {
  return words.join('_');
}

export function toLowerCamel(words: string[]): string {
  return words
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

export function toUpperCamel(words: string[]): string {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- stepStubber`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stepStubber.ts src/__tests__/stepStubber.test.ts
git commit -m "feat: stepStubber parameter inference + identifier helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Stub-template interface + Python & Java/Kotlin templates

**Files:**
- Modify: `src/languageAdapter.ts`
- Modify: `src/adapters/pythonAdapter.ts`, `src/adapters/javaAdapter.ts`
- Test: `src/adapters/__tests__/pythonAdapter.test.ts`, `src/adapters/__tests__/javaAdapter.test.ts`

**Interfaces:**
- Consumes: `StepKeyword` (Task 1); `inferPattern`, `deriveIdentifierWords`, `toSnake`, `StubParamType` (Task 2).
- Produces (in `languageAdapter.ts`):
  ```typescript
  export interface StubRenderInput {
    keyword: StepKeyword;   // 'Given' | 'When' | 'Then' (never And/But)
    stepBody: string;
    ext: string;            // concrete target file extension, lowercase, no dot (e.g. 'kt')
  }
  export interface StepStubTemplate {
    isClassBased: boolean;  // true => caller prepends a marker comment when appending
    render(input: StubRenderInput): string;  // pure stub, NO marker
  }
  // LanguageAdapter gains: stubTemplate?: StepStubTemplate;
  ```
  Adapters WITHOUT `stubTemplate` simply don't offer the quick-fix.

- [ ] **Step 1: Write the failing test**

Append to `src/adapters/__tests__/pythonAdapter.test.ts`:

```typescript
import { pythonAdapter } from '../pythonAdapter';

describe('pythonAdapter.stubTemplate', () => {
  const t = pythonAdapter.stubTemplate!;
  it('is not class-based', () => {
    expect(t.isClassBased).toBe(false);
  });
  it('renders a behave-style decorator stub with typed placeholders', () => {
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin" and 3 codes', ext: 'py' })).toBe(
      [
        "@when('the user enters {string} and {int} codes')",
        'def the_user_enters_and_codes(context, arg1, arg2):',
        '    raise NotImplementedError',
      ].join('\n'),
    );
  });
  it('renders a no-parameter stub', () => {
    expect(t.render({ keyword: 'Given', stepBody: 'the user is logged in', ext: 'py' })).toBe(
      [
        "@given('the user is logged in')",
        'def the_user_is_logged_in(context):',
        '    raise NotImplementedError',
      ].join('\n'),
    );
  });
});
```

Append to `src/adapters/__tests__/javaAdapter.test.ts`:

```typescript
import { javaAdapter } from '../javaAdapter';

describe('javaAdapter.stubTemplate', () => {
  const t = javaAdapter.stubTemplate!;
  it('is class-based', () => {
    expect(t.isClassBased).toBe(true);
  });
  it('renders a Java method with typed params', () => {
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin" and 3 codes', ext: 'java' })).toBe(
      [
        '@When("the user enters {string} and {int} codes")',
        'public void the_user_enters_and_codes(String arg1, int arg2) {',
        '    throw new io.cucumber.java.PendingException();',
        '}',
      ].join('\n'),
    );
  });
  it('renders Kotlin syntax for .kt targets', () => {
    expect(t.render({ keyword: 'Then', stepBody: 'the total is 5', ext: 'kt' })).toBe(
      [
        '@Then("the total is {int}")',
        'fun the_total_is(arg1: Int) {',
        '    throw io.cucumber.java.PendingException()',
        '}',
      ].join('\n'),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pythonAdapter javaAdapter`
Expected: FAIL — `stubTemplate` is `undefined` (and TS build error on the missing interface member if compiled).

- [ ] **Step 3: Add the interface, then the two templates**

In `src/languageAdapter.ts`, add the import and types, and extend the interface:

```typescript
import type { StepKeyword } from './featureParser';

// ...existing StepDefinition type...

export interface StubRenderInput {
  keyword: StepKeyword;
  stepBody: string;
  ext: string;
}

export interface StepStubTemplate {
  isClassBased: boolean;
  render(input: StubRenderInput): string;
}

export interface LanguageAdapter {
  parseStepDefinitions(content: string): StepDefinition[];
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean;
  reverseRegexForPattern(pattern: string): string | undefined;
  /** Optional stub generator. Absent => the "Create step definition" quick-fix is not offered. */
  stubTemplate?: StepStubTemplate;
}
```

In `src/adapters/pythonAdapter.ts`, add the import and `stubTemplate`:

```typescript
import { inferPattern, deriveIdentifierWords, toSnake } from '../stepStubber';
```

```typescript
export const pythonAdapter: LanguageAdapter = {
  parseStepDefinitions: parsePythonStepDefinitions,
  matchesStep(def, rawStep, normalizedStep) {
    return defaultStepMatches(def.pattern, rawStep, normalizedStep);
  },
  reverseRegexForPattern: defaultReverseRegex,
  stubTemplate: {
    isClassBased: false,
    render({ keyword, stepBody }) {
      const { cucumber, paramTypes } = inferPattern(stepBody);
      const name = toSnake(deriveIdentifierWords(stepBody));
      const pattern = cucumber.replace(/'/g, "\\'");
      const params = ['context', ...paramTypes.map((_, i) => `arg${i + 1}`)].join(', ');
      return [
        `@${keyword.toLowerCase()}('${pattern}')`,
        `def ${name}(${params}):`,
        '    raise NotImplementedError',
      ].join('\n');
    },
  },
};
```

In `src/adapters/javaAdapter.ts`, add the import and `stubTemplate`:

```typescript
import { inferPattern, deriveIdentifierWords, toSnake, type StubParamType } from '../stepStubber';
```

```typescript
export const javaAdapter: LanguageAdapter = {
  parseStepDefinitions: parseJavaStepDefinitions,
  matchesStep(def, rawStep, normalizedStep) {
    return defaultStepMatches(def.pattern, rawStep, normalizedStep);
  },
  reverseRegexForPattern: defaultReverseRegex,
  stubTemplate: {
    isClassBased: true,
    render({ keyword, stepBody, ext }) {
      const { cucumber, paramTypes } = inferPattern(stepBody);
      const name = toSnake(deriveIdentifierWords(stepBody));
      const pattern = cucumber.replace(/"/g, '\\"');
      const annotation = `@${keyword}("${pattern}")`;
      const isKotlin = ext === 'kt' || ext === 'kts';
      if (isKotlin) {
        const ktType = (t: StubParamType) => (t === 'string' ? 'String' : t === 'int' ? 'Int' : 'Float');
        const params = paramTypes.map((t, i) => `arg${i + 1}: ${ktType(t)}`).join(', ');
        return [
          annotation,
          `fun ${name}(${params}) {`,
          '    throw io.cucumber.java.PendingException()',
          '}',
        ].join('\n');
      }
      const javaType = (t: StubParamType) => (t === 'string' ? 'String' : t === 'int' ? 'int' : 'float');
      const params = paramTypes.map((t, i) => `${javaType(t)} arg${i + 1}`).join(', ');
      return [
        annotation,
        `public void ${name}(${params}) {`,
        '    throw new io.cucumber.java.PendingException();',
        '}',
      ].join('\n');
    },
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- pythonAdapter javaAdapter`
Expected: PASS.
Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/languageAdapter.ts src/adapters/pythonAdapter.ts src/adapters/javaAdapter.ts src/adapters/__tests__/pythonAdapter.test.ts src/adapters/__tests__/javaAdapter.test.ts
git commit -m "feat: StepStubTemplate interface + Python and Java/Kotlin stub templates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Stub templates for JS/TS, Ruby, C#, Dart, Go

**Files:**
- Modify: `src/adapters/jsAdapter.ts`, `rubyAdapter.ts`, `csharpAdapter.ts`, `dartAdapter.ts`, `goAdapter.ts`
- Test: the matching `src/adapters/__tests__/*Adapter.test.ts`

**Interfaces:**
- Consumes: `StepStubTemplate` (Task 3); `inferPattern`, `deriveIdentifierWords`, `toLowerCamel`, `toUpperCamel`, `StubParamType` (Task 2).
- Produces: `stubTemplate` on `jsAdapter`, `rubyAdapter`, `csharpAdapter`, `dartAdapter`, `goAdapter`.

- [ ] **Step 1: Write the failing tests**

Append to `src/adapters/__tests__/jsAdapter.test.ts`:

```typescript
import { jsAdapter } from '../jsAdapter';

describe('jsAdapter.stubTemplate', () => {
  const t = jsAdapter.stubTemplate!;
  it('renders untyped params for .js', () => {
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin" and 3 codes', ext: 'js' })).toBe(
      [
        "When('the user enters {string} and {int} codes', function (arg1, arg2) {",
        "  return 'pending';",
        '});',
      ].join('\n'),
    );
  });
  it('renders typed params for .ts', () => {
    expect(t.render({ keyword: 'Then', stepBody: 'the total is 5', ext: 'ts' })).toBe(
      [
        "Then('the total is {int}', function (arg1: number) {",
        "  return 'pending';",
        '});',
      ].join('\n'),
    );
  });
});
```

Append to `src/adapters/__tests__/rubyAdapter.test.ts`:

```typescript
import { rubyAdapter } from '../rubyAdapter';

describe('rubyAdapter.stubTemplate', () => {
  const t = rubyAdapter.stubTemplate!;
  it('renders a block with args', () => {
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin"', ext: 'rb' })).toBe(
      ["When('the user enters {string}') do |arg1|", '  pending', 'end'].join('\n'),
    );
  });
  it('renders a block without args', () => {
    expect(t.render({ keyword: 'Given', stepBody: 'the user is logged in', ext: 'rb' })).toBe(
      ["Given('the user is logged in') do", '  pending', 'end'].join('\n'),
    );
  });
});
```

Append to `src/adapters/__tests__/csharpAdapter.test.ts`:

```typescript
import { csharpAdapter } from '../csharpAdapter';

describe('csharpAdapter.stubTemplate', () => {
  const t = csharpAdapter.stubTemplate!;
  it('is class-based and renders a PascalCase method', () => {
    expect(t.isClassBased).toBe(true);
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin" and 3 codes', ext: 'cs' })).toBe(
      [
        '[When("the user enters {string} and {int} codes")]',
        'public void TheUserEntersAndCodes(string arg1, int arg2)',
        '{',
        '    throw new NotImplementedException();',
        '}',
      ].join('\n'),
    );
  });
});
```

Append to `src/adapters/__tests__/dartAdapter.test.ts`:

```typescript
import { dartAdapter } from '../dartAdapter';

describe('dartAdapter.stubTemplate', () => {
  const t = dartAdapter.stubTemplate!;
  it('renders a flutter_gherkin step with arity suffix', () => {
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin" and 3 codes', ext: 'dart' })).toBe(
      [
        'StepDefinitionGeneric theUserEntersAndCodes() {',
        "  return when2<String, int, World>(",
        "    'the user enters {string} and {int} codes',",
        '    (arg1, arg2, context) async {',
        '      throw UnimplementedError();',
        '    },',
        '  );',
        '}',
      ].join('\n'),
    );
  });
  it('uses no numeric suffix for zero-parameter steps', () => {
    const out = t.render({ keyword: 'Given', stepBody: 'the user is logged in', ext: 'dart' });
    expect(out).toContain('return given<World>(');
    expect(out).toContain('(context) async {');
  });
});
```

Append to `src/adapters/__tests__/goAdapter.test.ts`:

```typescript
import { goAdapter } from '../goAdapter';

describe('goAdapter.stubTemplate', () => {
  const t = goAdapter.stubTemplate!;
  it('renders a godog handler with a regex registration hint', () => {
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin" and 3 codes', ext: 'go' })).toBe(
      [
        '// TODO(Cucumber Jump): register this step, e.g.',
        '//   ctx.Step(`^the user enters "([^"]*)" and (\\d+) codes$`, theUserEntersAndCodes)',
        'func theUserEntersAndCodes(arg1 string, arg2 int) error {',
        '    return godog.ErrPending',
        '}',
      ].join('\n'),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- jsAdapter rubyAdapter csharpAdapter dartAdapter goAdapter`
Expected: FAIL — `stubTemplate` undefined.

- [ ] **Step 3: Add the five templates**

`src/adapters/jsAdapter.ts` — add import `import { inferPattern, type StubParamType } from '../stepStubber';` and:

```typescript
  stubTemplate: {
    isClassBased: false,
    render({ keyword, stepBody, ext }) {
      const { cucumber, paramTypes } = inferPattern(stepBody);
      const pattern = cucumber.replace(/'/g, "\\'");
      const isTs = ext === 'ts' || ext === 'tsx';
      const tsType = (t: StubParamType) => (t === 'string' ? 'string' : 'number');
      const args = paramTypes.map((t, i) => (isTs ? `arg${i + 1}: ${tsType(t)}` : `arg${i + 1}`)).join(', ');
      return [
        `${keyword}('${pattern}', function (${args}) {`,
        "  return 'pending';",
        '});',
      ].join('\n');
    },
  },
```

`src/adapters/rubyAdapter.ts` — add import `import { inferPattern } from '../stepStubber';` and:

```typescript
  stubTemplate: {
    isClassBased: false,
    render({ keyword, stepBody }) {
      const { cucumber, paramTypes } = inferPattern(stepBody);
      const pattern = cucumber.replace(/'/g, "\\'");
      const args = paramTypes.map((_, i) => `arg${i + 1}`);
      const block = args.length ? ` |${args.join(', ')}|` : '';
      return [`${keyword}('${pattern}') do${block}`, '  pending', 'end'].join('\n');
    },
  },
```

`src/adapters/csharpAdapter.ts` — add import `import { inferPattern, deriveIdentifierWords, toUpperCamel, type StubParamType } from '../stepStubber';` and:

```typescript
  stubTemplate: {
    isClassBased: true,
    render({ keyword, stepBody }) {
      const { cucumber, paramTypes } = inferPattern(stepBody);
      const name = toUpperCamel(deriveIdentifierWords(stepBody));
      const pattern = cucumber.replace(/"/g, '\\"');
      const csType = (t: StubParamType) => (t === 'string' ? 'string' : t === 'int' ? 'int' : 'double');
      const params = paramTypes.map((t, i) => `${csType(t)} arg${i + 1}`).join(', ');
      return [
        `[${keyword}("${pattern}")]`,
        `public void ${name}(${params})`,
        '{',
        '    throw new NotImplementedException();',
        '}',
      ].join('\n');
    },
  },
```

`src/adapters/dartAdapter.ts` — add import `import { inferPattern, deriveIdentifierWords, toLowerCamel, type StubParamType } from '../stepStubber';` and:

```typescript
  stubTemplate: {
    isClassBased: false,
    render({ keyword, stepBody }) {
      const { cucumber, paramTypes } = inferPattern(stepBody);
      const name = toLowerCamel(deriveIdentifierWords(stepBody));
      const pattern = cucumber.replace(/'/g, "\\'");
      const n = paramTypes.length;
      const suffix = n > 0 ? String(n) : '';
      const dartType = (t: StubParamType) => (t === 'string' ? 'String' : t === 'int' ? 'int' : 'double');
      const generics = [...paramTypes.map(dartType), 'World'].join(', ');
      const cbArgs = [...paramTypes.map((_, i) => `arg${i + 1}`), 'context'].join(', ');
      return [
        `StepDefinitionGeneric ${name}() {`,
        `  return ${keyword.toLowerCase()}${suffix}<${generics}>(`,
        `    '${pattern}',`,
        `    (${cbArgs}) async {`,
        '      throw UnimplementedError();',
        '    },',
        '  );',
        '}',
      ].join('\n');
    },
  },
```

`src/adapters/goAdapter.ts` — add import `import { inferPattern, deriveIdentifierWords, toLowerCamel, type StubParamType } from '../stepStubber';` and:

```typescript
  stubTemplate: {
    isClassBased: false,
    render({ stepBody }) {
      const { goRegex, paramTypes } = inferPattern(stepBody);
      const name = toLowerCamel(deriveIdentifierWords(stepBody));
      const goType = (t: StubParamType) => (t === 'string' ? 'string' : t === 'int' ? 'int' : 'float64');
      const params = paramTypes.map((t, i) => `arg${i + 1} ${goType(t)}`).join(', ');
      return [
        '// TODO(Cucumber Jump): register this step, e.g.',
        '//   ctx.Step(`' + goRegex + '`, ' + name + ')',
        `func ${name}(${params}) error {`,
        '    return godog.ErrPending',
        '}',
      ].join('\n');
    },
  },
```

Note: Go ignores `keyword` (godog registration is keyword-agnostic).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- jsAdapter rubyAdapter csharpAdapter dartAdapter goAdapter`
Expected: PASS.
Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/jsAdapter.ts src/adapters/rubyAdapter.ts src/adapters/csharpAdapter.ts src/adapters/dartAdapter.ts src/adapters/goAdapter.ts src/adapters/__tests__/jsAdapter.test.ts src/adapters/__tests__/rubyAdapter.test.ts src/adapters/__tests__/csharpAdapter.test.ts src/adapters/__tests__/dartAdapter.test.ts src/adapters/__tests__/goAdapter.test.ts
git commit -m "feat: stub templates for JS/TS, Ruby, C#, Dart, Go

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `findUnmatchedSteps` in the resolver

**Files:**
- Modify: `src/resolver.ts`

**Interfaces:**
- Consumes: existing `getResolutionChainForFeature`, `getAdapterForGlob`, `getStepDefinitions`, `getBddBlocks`, `blockMatchesStep`, `bddUriForEntry`, `parseStepLine`, `normalizeStepText`, `workspaceRelativePath`, `concretePathFromFeatureAndGlobPattern`, `ensureInferenceForUri`.
- Produces:
  ```typescript
  export type FeatureDiagnosticsVerdict =
    | { eligible: false }
    | { eligible: true; unmatchedLines: number[] };
  export function findUnmatchedSteps(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<FeatureDiagnosticsVerdict>;
  ```

**Semantics (verify manually):**
- `eligible: false` when the chain is empty OR no chain entry yields a usable match source (adapter with ≥1 step file, or a readable `bddFile`). This is the "don't turn unconfigured/misconfigured features red" gate from the spec.
- Otherwise `eligible: true` with the 0-based line numbers of every step line matched by **no** entry (project + libraries, mirroring `resolveFromFeature`'s multi-entry search).

- [ ] **Step 1: Add the import**

In `src/resolver.ts`, extend the `featureParser` import to include `parseStepLine`:

```typescript
import { getStepTextAtLineNumber, normalizeStepText, parseStepLine } from "./featureParser";
```

- [ ] **Step 2: Add the function**

Append to `src/resolver.ts`:

```typescript
export type FeatureDiagnosticsVerdict =
  | { eligible: false }
  | { eligible: true; unmatchedLines: number[] };

/**
 * One scan over a feature file: builds a matcher per resolution-chain entry (adapter
 * path collects StepDefinitions across all step files; legacy path reads BddStepBlocks),
 * then reports every step line matched by no entry. Returns { eligible: false } when
 * the config is not usable enough for "missing" to be meaningful (no chain, or no entry
 * yields a match source), so unconfigured/misconfigured features are never flagged.
 */
export async function findUnmatchedSteps(
  document: vscode.TextDocument,
  token: vscode.CancellationToken,
): Promise<FeatureDiagnosticsVerdict> {
  await ensureInferenceForUri(document.uri);
  const chain = getResolutionChainForFeature(document.uri);
  if (chain.length === 0) {
    return { eligible: false };
  }

  const matchers: Array<(raw: string, norm: string) => boolean> = [];

  for (const entry of chain) {
    if (token.isCancellationRequested) {
      return { eligible: false };
    }

    if (entry.pack.bddFile) {
      const bddUri = bddUriForEntry(entry, document.uri);
      try {
        const blocks = await getBddBlocks(bddUri);
        matchers.push((raw, norm) => blocks.some((b) => blockMatchesStep(b, raw, norm)));
      } catch {
        // unreadable registry — not a match source
      }
      continue;
    }

    const adapter = getAdapterForGlob(entry.pack.stepsGlob);
    if (!adapter) {
      continue;
    }
    const featureRel = workspaceRelativePath(entry.folder, document.uri);
    const stepsGlobConcrete = entry.pack.inferred
      ? entry.pack.stepsGlob
      : concretePathFromFeatureAndGlobPattern(featureRel, entry.pack.stepsGlob);
    const pattern = new vscode.RelativePattern(entry.folder, stepsGlobConcrete);
    const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 5000, token);
    if (files.length === 0) {
      continue;
    }
    const defs: StepDefinition[] = [];
    for (const file of files) {
      if (token.isCancellationRequested) {
        return { eligible: false };
      }
      try {
        defs.push(...(await getStepDefinitions(file, adapter)));
      } catch {
        // unparseable file — skip
      }
    }
    matchers.push((raw, norm) => defs.some((d) => adapter.matchesStep(d, raw, norm)));
  }

  if (matchers.length === 0) {
    return { eligible: false };
  }

  const unmatchedLines: number[] = [];
  const lines = document.getText().split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const stepText = parseStepLine(lines[i]);
    if (!stepText) {
      continue;
    }
    const norm = normalizeStepText(stepText);
    if (!matchers.some((m) => m(stepText, norm))) {
      unmatchedLines.push(i);
    }
  }

  return { eligible: true, unmatchedLines };
}
```

- [ ] **Step 3: Verify compile**

Run: `npm run compile`
Expected: no TypeScript errors. (No unit test — resolver glue is verified end-to-end in Task 6's manual pass, matching the repo's untested-glue convention.)

- [ ] **Step 4: Commit**

```bash
git add src/resolver.ts
git commit -m "feat: findUnmatchedSteps — one-scan missing-step detection, both paths

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Diagnostics engine + setting + wiring

**Files:**
- Create: `src/diagnostics.ts`
- Modify: `package.json` (add `cucumberJump.diagnosticsEnabled`)
- Modify: `src/extension.ts` (call `registerDiagnostics`)

**Interfaces:**
- Consumes: `findUnmatchedSteps`, `FeatureDiagnosticsVerdict` (Task 5); `isFeatureUri` (`featureParser`); `findPackForStepsFile` (`config`).
- Produces:
  ```typescript
  export function registerDiagnostics(context: vscode.ExtensionContext): void;
  ```

- [ ] **Step 1: Add the setting to `package.json`**

Under `contributes.configuration.properties`, add (after `cucumberJump.libraries` or anywhere in the block):

```json
        "cucumberJump.diagnosticsEnabled": {
          "type": "boolean",
          "default": false,
          "markdownDescription": "Show a **warning** (yellow squiggle) on `.feature` steps that have no matching step definition. Only applies when a project/library matches the feature and at least one step file is found — unconfigured or mis-globbed features are never flagged. Use the **Create step definition** quick-fix (lightbulb) to generate a stub."
        }
```

- [ ] **Step 2: Create `src/diagnostics.ts`**

```typescript
import * as vscode from "vscode";
import { findPackForStepsFile } from "./config";
import { isFeatureUri } from "./featureParser";
import { findUnmatchedSteps } from "./resolver";

const DIAGNOSTIC_SOURCE = "Cucumber Jump";
const DIAGNOSTIC_CODE = "missing-step";

export function registerDiagnostics(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("cucumberJump");
  context.subscriptions.push(collection);

  const perDoc = new Map<string, vscode.CancellationTokenSource>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const enabled = (): boolean =>
    vscode.workspace.getConfiguration("cucumberJump").get<boolean>("diagnosticsEnabled") ?? false;

  const refresh = async (document: vscode.TextDocument): Promise<void> => {
    if (!isFeatureUri(document.uri)) {
      return;
    }
    const key = document.uri.toString();
    perDoc.get(key)?.cancel();
    perDoc.get(key)?.dispose();

    if (!enabled()) {
      collection.delete(document.uri);
      return;
    }

    const cts = new vscode.CancellationTokenSource();
    perDoc.set(key, cts);
    try {
      const verdict = await findUnmatchedSteps(document, cts.token);
      if (cts.token.isCancellationRequested) {
        return;
      }
      if (!verdict.eligible) {
        collection.delete(document.uri);
        return;
      }
      const diagnostics = verdict.unmatchedLines.map((line) => {
        const text = document.lineAt(line).text;
        const startCol = text.length - text.trimStart().length;
        const range = new vscode.Range(line, startCol, line, text.length);
        const d = new vscode.Diagnostic(range, "No matching step definition", vscode.DiagnosticSeverity.Warning);
        d.source = DIAGNOSTIC_SOURCE;
        d.code = DIAGNOSTIC_CODE;
        return d;
      });
      collection.set(document.uri, diagnostics);
    } catch {
      collection.delete(document.uri);
    }
  };

  const schedule = (document: vscode.TextDocument, delay = 300): void => {
    const key = document.uri.toString();
    const existing = timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void refresh(document);
      }, delay),
    );
  };

  const refreshAllOpenFeatures = (): void => {
    for (const editor of vscode.window.visibleTextEditors) {
      if (isFeatureUri(editor.document.uri)) {
        schedule(editor.document);
      }
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isFeatureUri(doc.uri)) {
        schedule(doc, 50);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isFeatureUri(e.document.uri)) {
        schedule(e.document);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isFeatureUri(doc.uri)) {
        schedule(doc, 50);
        return;
      }
      // A step-file save can newly satisfy (or break) steps in open features.
      // Delay lets extension.ts's cache-invalidation listener run first.
      if (findPackForStepsFile(doc.uri)) {
        refreshAllOpenFeatures();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cucumberJump")) {
        refreshAllOpenFeatures();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isFeatureUri(editor.document.uri)) {
        schedule(editor.document, 50);
      }
    }),
    {
      dispose: () => {
        for (const t of timers.values()) {
          clearTimeout(t);
        }
        for (const c of perDoc.values()) {
          c.dispose();
        }
      },
    },
  );

  refreshAllOpenFeatures();
}
```

- [ ] **Step 3: Wire into `src/extension.ts`**

Add the import near the other imports:

```typescript
import { registerDiagnostics } from "./diagnostics";
```

Add the call at the top of `activate`, alongside the other `register*` calls:

```typescript
  registerStepUi(context);
  registerDevMode(context);
  registerOnboarding(context);
  registerDiagnostics(context);
  scheduleConflictingExtensionHint(context);
```

- [ ] **Step 4: Verify compile + manual check**

Run: `npm run compile`
Expected: no errors.

Manual (Extension Development Host, F5 via `.vscode/launch.json`):
1. Open a workspace with a configured (or inferable) project.
2. Confirm **no squiggles** with `cucumberJump.diagnosticsEnabled` unset/false.
3. Set `cucumberJump.diagnosticsEnabled: true` → steps with no definition show yellow squiggles; matched steps do not.
4. Open a `.feature` with no matching config → no squiggles (eligibility gate).
5. Add a matching step definition in the steps file, save → the squiggle clears within ~1s.
6. Toggle the setting off → all squiggles clear.

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics.ts src/extension.ts package.json
git commit -m "feat: opt-in missing-step diagnostics (cucumberJump.diagnosticsEnabled)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Create-step quick-fix + command

**Files:**
- Create: `src/codeActions.ts`
- Modify: `package.json` (add `cucumberJump.createStepDefinition` command)
- Modify: `src/extension.ts` (call `registerStepAuthoring`)

**Interfaces:**
- Consumes: `getStepKeywordAtLine` (Task 1); `LanguageAdapter.stubTemplate` (Tasks 3–4); `getResolutionChainForFeature`, `ResolutionEntry`, `workspaceRelativePath`, `concretePathFromFeatureAndGlobPattern` (`config`); `getAdapterForGlob`, `extensionsForGlob` (`adapterRegistry`); `isFeatureUri` (`featureParser`); `showTextDocumentRevealAtTop` (`editorNavigate`).
- Produces:
  ```typescript
  export function registerStepAuthoring(context: vscode.ExtensionContext): void;
  ```

- [ ] **Step 1: Add the command to `package.json`**

Under `contributes.commands`, add:

```json
      {
        "command": "cucumberJump.createStepDefinition",
        "title": "Cucumber Jump: Create step definition"
      }
```

- [ ] **Step 2: Create `src/codeActions.ts`**

```typescript
import * as vscode from "vscode";
import {
  concretePathFromFeatureAndGlobPattern,
  getResolutionChainForFeature,
  workspaceRelativePath,
  type ResolutionEntry,
} from "./config";
import { extensionsForGlob, getAdapterForGlob } from "./adapterRegistry";
import { getStepKeywordAtLine, isFeatureUri } from "./featureParser";
import { showTextDocumentRevealAtTop } from "./editorNavigate";
import type { LanguageAdapter } from "./languageAdapter";

const DIAGNOSTIC_SOURCE = "Cucumber Jump";
const DIAGNOSTIC_CODE = "missing-step";

const FEATURE_SELECTOR: vscode.DocumentSelector = [
  { scheme: "file", pattern: "**/*.feature" },
  { scheme: "vscode-remote", pattern: "**/*.feature" },
  { scheme: "file", language: "gherkin" },
  { scheme: "file", language: "cucumber" },
  { scheme: "file", language: "feature" },
];

/** Comment prefix for the "move into your class" marker (only class-based langs use it). */
function markerComment(): string {
  return "// TODO(Cucumber Jump): move this method inside your step-definition class";
}

/** Minimal scaffold for a brand-new step file, with the stub embedded. */
function newFileContent(ext: string, stub: string): string {
  const indent = (s: string) => s.split("\n").map((l) => (l ? `    ${l}` : l)).join("\n");
  switch (ext) {
    case "py":
      return `from behave import given, when, then\n\n\n${stub}\n`;
    case "rb":
      return `${stub}\n`;
    case "js":
      return `const { Given, When, Then } = require('@cucumber/cucumber');\n\n${stub}\n`;
    case "ts":
    case "tsx":
      return `import { Given, When, Then } from '@cucumber/cucumber';\n\n${stub}\n`;
    case "go":
      return `package steps\n\nimport "github.com/cucumber/godog"\n\n${stub}\n`;
    case "java":
      return `import io.cucumber.java.en.*;\n\npublic class GeneratedSteps {\n${indent(stub)}\n}\n`;
    case "kt":
    case "kts":
      return `import io.cucumber.java.en.*\n\nclass GeneratedSteps {\n${indent(stub)}\n}\n`;
    case "cs":
      return `using Reqnroll;\n\n[Binding]\npublic class GeneratedSteps\n{\n${indent(stub)}\n}\n`;
    case "dart":
      return `${stub}\n`;
    default:
      return `${stub}\n`;
  }
}

function proposeNewFilePath(
  folder: vscode.WorkspaceFolder,
  concrete: string,
  files: vscode.Uri[],
  featureUri: vscode.Uri,
  ext: string,
): string {
  const base = (featureUri.path.split("/").pop() ?? "steps").replace(/\.feature$/i, "");
  if (files.length > 0) {
    const rel = workspaceRelativePath(folder, files[0]);
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    return dir ? `${dir}/${base}_steps.${ext}` : `${base}_steps.${ext}`;
  }
  const prefix = concrete.split("*")[0].replace(/\/$/, "");
  return prefix ? `${prefix}/${base}_steps.${ext}` : `${base}_steps.${ext}`;
}

/** First chain entry with an adapter that can generate stubs (project before libraries). */
function firstStubCapableEntry(
  featureUri: vscode.Uri,
): { adapter: LanguageAdapter; entry: ResolutionEntry } | undefined {
  for (const entry of getResolutionChainForFeature(featureUri)) {
    if (entry.pack.bddFile) {
      continue;
    }
    const adapter = getAdapterForGlob(entry.pack.stepsGlob);
    if (adapter?.stubTemplate) {
      return { adapter, entry };
    }
  }
  return undefined;
}

function bodyLineOffset(stub: string): number {
  const lines = stub.split("\n");
  const idx = lines.findIndex((l) => /pending|NotImplemented|Unimplemented|ErrPending/i.test(l));
  return idx === -1 ? 0 : idx;
}

async function createStepDefinition(uriArg?: unknown, lineArg?: unknown): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  let document: vscode.TextDocument;
  let line: number;
  if (uriArg instanceof vscode.Uri && typeof lineArg === "number") {
    document = await vscode.workspace.openTextDocument(uriArg);
    line = lineArg;
  } else if (editor && isFeatureUri(editor.document.uri)) {
    document = editor.document;
    line = editor.selection.active.line;
  } else {
    await vscode.window.showInformationMessage("Cucumber Jump: open a .feature file and put the cursor on a step.");
    return;
  }

  const kw = getStepKeywordAtLine(document.getText(), line);
  if (!kw) {
    await vscode.window.showInformationMessage("Cucumber Jump: no Gherkin step on this line.");
    return;
  }

  const chosen = firstStubCapableEntry(document.uri);
  if (!chosen) {
    await vscode.window.showInformationMessage(
      "Cucumber Jump: step generation is not available for this project's language.",
    );
    return;
  }

  const featureRel = workspaceRelativePath(chosen.entry.folder, document.uri);
  const concrete = chosen.entry.pack.inferred
    ? chosen.entry.pack.stepsGlob
    : concretePathFromFeatureAndGlobPattern(featureRel, chosen.entry.pack.stepsGlob);

  const cts = new vscode.CancellationTokenSource();
  let files: vscode.Uri[];
  try {
    files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(chosen.entry.folder, concrete),
      "**/node_modules/**",
      5000,
      cts.token,
    );
  } finally {
    cts.dispose();
  }

  interface Pick extends vscode.QuickPickItem {
    file?: vscode.Uri;
    newFile?: boolean;
  }
  const items: Pick[] = files.map((f) => ({ label: vscode.workspace.asRelativePath(f), file: f }));
  items.push({ label: "$(new-file) New file…", newFile: true, alwaysShow: true });

  const picked = await vscode.window.showQuickPick(items, {
    title: "Cucumber Jump: create step definition",
    placeHolder: "Choose a step file to add the definition to",
  });
  if (!picked) {
    return;
  }

  const ext = picked.file
    ? (picked.file.fsPath.split(".").pop() ?? "").toLowerCase()
    : (extensionsForGlob(concrete)[0] ?? "");
  const stub = chosen.adapter.stubTemplate!.render({ keyword: kw.keyword, stepBody: kw.body, ext });

  if (picked.file) {
    const doc = await vscode.workspace.openTextDocument(picked.file);
    const lastLine = doc.lineCount - 1;
    const endPos = new vscode.Position(lastLine, doc.lineAt(lastLine).text.length);
    const marker = chosen.adapter.stubTemplate!.isClassBased ? `${markerComment()}\n` : "";
    const insertText = `\n\n${marker}${stub}\n`;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(picked.file, endPos, insertText);
    await vscode.workspace.applyEdit(edit);

    const markerLines = marker ? 1 : 0;
    const bodyLine = lastLine + 2 + markerLines + bodyLineOffset(stub);
    const pos = new vscode.Position(bodyLine, 0);
    await showTextDocumentRevealAtTop(doc, { selection: new vscode.Selection(pos, pos), preview: false });
    return;
  }

  const proposed = proposeNewFilePath(chosen.entry.folder, concrete, files, document.uri, ext);
  const input = await vscode.window.showInputBox({
    title: "Cucumber Jump: new step file",
    prompt: "Path relative to the workspace folder",
    value: proposed,
  });
  if (!input) {
    return;
  }
  const target = vscode.Uri.joinPath(chosen.entry.folder.uri, input);
  const content = newFileContent(ext, stub);
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(target, { ignoreIfExists: true, contents: Buffer.from(content, "utf8") });
  await vscode.workspace.applyEdit(edit);
  await showTextDocumentRevealAtTop(target, { preview: false });
}

export function registerStepAuthoring(context: vscode.ExtensionContext): void {
  const provider: vscode.CodeActionProvider = {
    provideCodeActions(document, _range, actionContext) {
      const relevant = actionContext.diagnostics.filter(
        (d) => d.source === DIAGNOSTIC_SOURCE && d.code === DIAGNOSTIC_CODE,
      );
      if (relevant.length === 0) {
        return undefined;
      }
      return relevant.map((d) => {
        const action = new vscode.CodeAction(
          "Cucumber Jump: Create step definition",
          vscode.CodeActionKind.QuickFix,
        );
        action.diagnostics = [d];
        action.command = {
          command: "cucumberJump.createStepDefinition",
          title: "Create step definition",
          arguments: [document.uri, d.range.start.line],
        };
        return action;
      });
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(FEATURE_SELECTOR, provider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.commands.registerCommand("cucumberJump.createStepDefinition", createStepDefinition),
  );
}
```

Note on `getStepKeywordAtLine`/`isFeatureUri` import: both are exported from `src/featureParser.ts` (Task 1 added `getStepKeywordAtLine`).

- [ ] **Step 3: Wire into `src/extension.ts`**

Add the import:

```typescript
import { registerStepAuthoring } from "./codeActions";
```

Add the call in `activate` next to `registerDiagnostics`:

```typescript
  registerDiagnostics(context);
  registerStepAuthoring(context);
```

- [ ] **Step 4: Verify compile + manual check**

Run: `npm run compile`
Expected: no errors.

Manual (Extension Development Host), with `cucumberJump.diagnosticsEnabled: true`:
1. Cursor on a squiggled step → lightbulb shows **"Cucumber Jump: Create step definition"**.
2. Invoke it → quick-pick lists step files + "New file…".
3. Pick an existing **Python** file → stub appended, file opens, cursor in the body; save → squiggle clears.
4. Pick an existing **Java** file → stub appended WITH the `// TODO … move this method inside your class` marker.
5. Choose **New file…** for Java → new file created containing `public class GeneratedSteps { … }` with the method inside (no marker).
6. Run the command from the palette (cursor on an unmatched step) → same flow.

- [ ] **Step 5: Commit**

```bash
git add src/codeActions.ts src/extension.ts package.json
git commit -m "feat: Create step definition quick-fix + command

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Docs + full test run + version note

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a README section**

Add a new section after the navigation/features section (match the existing README's heading style — use `##`):

```markdown
## Authoring: create missing steps

Turn on `cucumberJump.diagnosticsEnabled` to get a warning squiggle on any
`.feature` step that has no matching step definition. Squiggles appear only when
a project/library matches the feature and at least one step file exists, so
unconfigured features stay clean.

On a squiggled step, use the lightbulb (or **Cucumber Jump: Create step
definition** from the command palette) to generate a stub in the right language.
Quoted values become `{string}`, integers `{int}`, and decimals `{float}`
(Go stubs use an anchored regex). You pick which step file receives the stub, or
create a new one.
```

- [ ] **Step 2: Add a CHANGELOG entry**

At the top of `CHANGELOG.md` (above the `## [2.1.0]` entry), add:

```markdown
## [2.2.0] - 2026-07-12

### Added

- **Missing-step diagnostics** — opt-in `cucumberJump.diagnosticsEnabled` warns (yellow squiggle) on `.feature` steps with no matching step definition. Only fires when a project/library matches the feature and ≥1 step file is found, so unconfigured or mis-globbed features are never flagged. Works for all nine languages and the legacy Go `bddFile` path.
- **"Create step definition" quick-fix** — a lightbulb on a squiggled step (also `Cucumber Jump: Create step definition` in the palette) generates a correctly-formatted stub in the target language, inferring `{string}`/`{int}`/`{float}` parameters (anchored regex for Go). Choose an existing step file or create a new one; class-based languages get a placement marker when appending and a wrapped class when creating a new file.

[2.2.0]: https://github.com/lntvan166/cucumber-jump-ext/compare/v2.1.0...v2.2.0
```

- [ ] **Step 3: Full test + compile run**

Run: `npm test`
Expected: PASS — all prior tests plus the new `featureParser`, `stepStubber`, and per-adapter `stubTemplate` tests (128 baseline + ~20 new).

Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: authoring section + 2.2.0 changelog for step diagnostics/quick-fix

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Note: the actual version bump in `package.json` and publishing are handled by the `release` skill at release time — do NOT bump `package.json`'s `version` field in this plan.

---

## Notes / known limitations (intentional, per spec)

- **Cucumber Expression for non-Go stubs** even when the target framework's native
  parameter syntax differs (e.g. behave's `parse` format, pytest-bdd). This follows
  the approved spec; refining per-framework idioms is a future iteration.
- **Legacy Go `bddFile` projects** get diagnostics but no quick-fix (stub generation
  is adapter-driven; the StepMap registry format is out of scope).
- **Class-based append** uses append + marker rather than inserting inside the class
  body (simplified per the approved design). New-file creation *does* place the method
  inside a generated class wrapper.
- **Step-file-save → open-feature refresh** relies on `extension.ts`'s cache
  invalidation running before the debounced diagnostics pass; the ~300ms debounce
  gives it room. Verify in Task 6's manual step 5.
