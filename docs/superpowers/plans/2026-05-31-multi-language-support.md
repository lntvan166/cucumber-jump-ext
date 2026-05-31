# Multi-Language Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Go (new auto-detect), Java/Kotlin, Python, JavaScript/TypeScript, Ruby, C#, and Dart step definition support to Cucumber Jump while preserving full backward compatibility for all existing users who have `bddFile` in their config.

**Architecture:** A `LanguageAdapter` interface abstracts step parsing and matching per language. An `AdapterRegistry` maps file extensions inferred from `stepsGlob` to the correct adapter. The resolver branches: if `bddFile` is set it takes the unchanged legacy path; otherwise it calls the adapter. All existing Go users with `bddFile` see zero behavior change.

**Tech Stack:** TypeScript 5.4, VS Code Extension API 1.85, Vitest 1.x (unit tests for pure adapter functions — no VS Code host needed)

**Build:** `npm run compile` (tsc)  
**Test:** `npm test` (vitest run)

> **Parallelization note for subagents:** Tasks 1–2 must run first. Tasks 3–9 (adapters) are fully independent of each other and can run in parallel after Task 2 completes. Tasks 10–14 must run after 3–9.

---

## File Map

**New files:**
| File | Responsibility |
|---|---|
| `src/languageAdapter.ts` | `StepDefinition` type, `LanguageAdapter` interface, `findDefinitionAtPosition` util |
| `src/adapterRegistry.ts` | Maps file extension → adapter instance |
| `src/adapters/cucumberExpression.ts` | Converts `{int}` / `{string}` Cucumber Expressions to `RegExp` |
| `src/adapters/goAdapter.ts` | Parses `ctx.Step(` / `s.Step(` patterns |
| `src/adapters/javaAdapter.ts` | Parses `@Given/@When/@Then` (Java + Kotlin identical syntax) |
| `src/adapters/pythonAdapter.ts` | Parses `@given/@when/@then` (behave / pytest-bdd) |
| `src/adapters/jsAdapter.ts` | Parses `Given()/When()/Then()` string + regex forms (cucumber-js) |
| `src/adapters/rubyAdapter.ts` | Parses `Given/When/Then` blocks |
| `src/adapters/csharpAdapter.ts` | Parses `[Given]/[When]/[Then]` attributes |
| `src/adapters/dartAdapter.ts` | Parses `given1()/when1()/then1()` (flutter_gherkin) |
| `src/adapters/__tests__/cucumberExpression.test.ts` | |
| `src/adapters/__tests__/goAdapter.test.ts` | |
| `src/adapters/__tests__/javaAdapter.test.ts` | |
| `src/adapters/__tests__/pythonAdapter.test.ts` | |
| `src/adapters/__tests__/jsAdapter.test.ts` | |
| `src/adapters/__tests__/rubyAdapter.test.ts` | |
| `src/adapters/__tests__/csharpAdapter.test.ts` | |
| `src/adapters/__tests__/dartAdapter.test.ts` | |
| `vitest.config.ts` | Vitest config |

**Modified files:**
| File | Change |
|---|---|
| `package.json` | Add vitest devDep + `test` script; make `bddFile` optional in JSON schema |
| `src/config.ts` | `bddFile` field becomes `bddFile?: string` in `PackConfig` |
| `src/documentCache.ts` | Add `getStepDefinitions(uri, adapter)` cache; extend invalidation |
| `src/resolver.ts` | Branch on `bddFile`: legacy path unchanged, new adapter path added |
| `src/extension.ts` | Register new step-file providers for all supported languages |

**Untouched files:** `src/bddParser.ts`, `src/goImplFinder.ts`, `src/featureParser.ts`, `src/featureFinder.ts`, `src/devMode.ts`, `src/stepUi.ts`, `src/conflictHint.ts`, `src/sameFileUri.ts`, `src/editorNavigate.ts`

---

## Task 1: Test infrastructure + Cucumber Expression utility

**Files:**
- Create: `vitest.config.ts`
- Create: `src/adapters/cucumberExpression.ts`
- Create: `src/adapters/__tests__/cucumberExpression.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest@^1.6.0
```

- [ ] **Step 2: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Add `test` script to `package.json`**

In the `"scripts"` block add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write failing test for Cucumber Expression converter**

Create `src/adapters/__tests__/cucumberExpression.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cucumberExpressionToRegex, isCucumberExpression } from '../cucumberExpression';

describe('isCucumberExpression', () => {
  it('returns true for {int}', () => expect(isCucumberExpression('I have {int} cucumbers')).toBe(true));
  it('returns false for plain regex', () => expect(isCucumberExpression('^I have (\\d+) cucumbers$')).toBe(false));
});

describe('cucumberExpressionToRegex', () => {
  it('converts {int}', () => {
    const re = cucumberExpressionToRegex('I have {int} cucumbers');
    expect(re.test('I have 5 cucumbers')).toBe(true);
    expect(re.test('I have -3 cucumbers')).toBe(true);
    expect(re.test('I have abc cucumbers')).toBe(false);
  });

  it('converts {string}', () => {
    const re = cucumberExpressionToRegex('the user is {string}');
    expect(re.test('the user is "admin"')).toBe(true);
    expect(re.test("the user is 'admin'")).toBe(true);
    expect(re.test('the user is admin')).toBe(false);
  });

  it('converts {word}', () => {
    const re = cucumberExpressionToRegex('I am a {word} user');
    expect(re.test('I am a happy user')).toBe(true);
    expect(re.test('I am a  user')).toBe(false);
  });

  it('converts {}', () => {
    const re = cucumberExpressionToRegex('I see {}');
    expect(re.test('I see anything at all')).toBe(true);
  });

  it('escapes literal dots and parens', () => {
    const re = cucumberExpressionToRegex('price is {float} USD');
    expect(re.test('price is 3.14 USD')).toBe(true);
    expect(re.test('price is 3X14 USD')).toBe(false);
  });
});
```

- [ ] **Step 5: Run test — expect FAIL (module not found)**

```bash
npm test
```

Expected: test fails with `Cannot find module '../cucumberExpression'`

- [ ] **Step 6: Create `src/adapters/cucumberExpression.ts`**

```typescript
const TYPE_PATTERNS: Record<string, string> = {
  int: '-?\\d+',
  float: '-?\\d*\\.?\\d+',
  word: '[^\\s]+',
  string: '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'',
  bigdecimal: '-?\\d*\\.?\\d+',
  double: '-?\\d*\\.?\\d+',
  long: '-?\\d+',
  short: '-?\\d+',
  byte: '-?\\d+',
  '': '[^,]+',
};

export function isCucumberExpression(pattern: string): boolean {
  return /\{[\w]*\}/.test(pattern);
}

export function cucumberExpressionToRegex(pattern: string): RegExp {
  const tokens = pattern.split(/(\{[\w]*\})/);
  const regexStr = tokens
    .map((token) => {
      if (/^\{[\w]*\}$/.test(token)) {
        const type = token.slice(1, -1);
        return `(${TYPE_PATTERNS[type] ?? '[^,]+'})`;
      }
      return token.replace(/[.*+?^$[\]\\()]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${regexStr}$`);
}
```

- [ ] **Step 7: Run tests — expect PASS**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts src/adapters/cucumberExpression.ts src/adapters/__tests__/cucumberExpression.test.ts package.json package-lock.json
git commit -m "feat: add vitest infrastructure and Cucumber Expression converter"
```

---

## Task 2: Core `LanguageAdapter` interface

**Files:**
- Create: `src/languageAdapter.ts`

- [ ] **Step 1: Create `src/languageAdapter.ts`**

```typescript
export type StepDefinition = {
  pattern: string;
  patternLine: number;
  patternStartCol: number;
  patternEndCol: number;
  implFunctionName?: string;
  implLine?: number;
  bodyEndLine?: number;
};

export interface LanguageAdapter {
  parseStepDefinitions(content: string): StepDefinition[];
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean;
}

export function findDefinitionAtPosition(
  defs: StepDefinition[],
  line: number,
): StepDefinition | undefined {
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const rangeStart = def.patternLine;
    const rangeEnd =
      def.bodyEndLine !== undefined
        ? def.bodyEndLine
        : i + 1 < defs.length
          ? defs[i + 1].patternLine - 1
          : Infinity;
    if (line >= rangeStart && line <= rangeEnd) {
      return def;
    }
  }
  return undefined;
}
```

- [ ] **Step 2: Compile to verify no errors**

```bash
npm run compile
```

Expected: exits 0, `out/` updated

- [ ] **Step 3: Commit**

```bash
git add src/languageAdapter.ts
git commit -m "feat: add LanguageAdapter interface and StepDefinition type"
```

---

## Task 3: Go adapter

**Files:**
- Create: `src/adapters/goAdapter.ts`
- Create: `src/adapters/__tests__/goAdapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/adapters/__tests__/goAdapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseGoStepDefinitions, goAdapter } from '../goAdapter';

describe('parseGoStepDefinitions', () => {
  it('parses backtick step with named handler', () => {
    const content = [
      'func InitializeScenario(ctx *godog.ScenarioContext) {',
      '\tctx.Step(`^I have (\\d+) cucumbers$`, iHaveCucumbers)',
      '}',
    ].join('\n');
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('^I have (\\d+) cucumbers$');
    expect(defs[0].implFunctionName).toBe('iHaveCucumbers');
    expect(defs[0].implLine).toBeUndefined();
    expect(defs[0].patternLine).toBe(1);
  });

  it('parses double-quoted step with named handler', () => {
    const content = 's.Step("when the user logs in", loginHandler)';
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('when the user logs in');
    expect(defs[0].implFunctionName).toBe('loginHandler');
  });

  it('parses anonymous func step', () => {
    const content = 'ctx.Step(`^pattern$`, func(ctx context.Context) error { return nil })';
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].implFunctionName).toBeUndefined();
    expect(defs[0].implLine).toBe(0);
  });

  it('parses multiple steps', () => {
    const content = [
      'ctx.Step(`^step one$`, handlerOne)',
      'ctx.Step(`^step two$`, handlerTwo)',
    ].join('\n');
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(2);
    expect(defs[0].implFunctionName).toBe('handlerOne');
    expect(defs[1].implFunctionName).toBe('handlerTwo');
  });

  it('ignores non-step lines', () => {
    const content = 'someOtherFunc()';
    expect(parseGoStepDefinitions(content)).toHaveLength(0);
  });
});

describe('goAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches via normalized text', () => {
    expect(goAdapter.matchesStep(makeDef('I have cucumbers'), 'I have cucumbers', 'i have cucumbers')).toBe(true);
  });

  it('matches via regex', () => {
    expect(goAdapter.matchesStep(makeDef('^I have (\\d+) cucumbers$'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('does not match different step', () => {
    expect(goAdapter.matchesStep(makeDef('I have cucumbers'), 'I eat cucumbers', 'i eat cucumbers')).toBe(false);
  });

  it('matches Cucumber Expression', () => {
    expect(goAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- goAdapter
```

Expected: `Cannot find module '../goAdapter'`

- [ ] **Step 3: Create `src/adapters/goAdapter.ts`**

```typescript
import type { LanguageAdapter, StepDefinition } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { regexMatchesRawStep } from '../bddParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

// Matches: <any>.Step(`pattern`, handler) or <any>.Step("pattern", handler)
const STEP_RE = /\.Step\s*\(\s*(?:`([^`]*)`|"([^"]*)")\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*|func\b)/;

export function parseGoStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = STEP_RE.exec(line);
    if (!m) {
      continue;
    }

    const isBacktick = m[1] !== undefined;
    const pattern = m[1] ?? m[2];
    const handler = m[3];
    const quote = isBacktick ? '`' : '"';
    const tickStart = line.indexOf(quote);
    const tickEnd = line.indexOf(quote, tickStart + 1);

    defs.push({
      pattern,
      patternLine: i,
      patternStartCol: tickStart >= 0 ? tickStart : 0,
      patternEndCol: tickEnd >= 0 ? tickEnd + 1 : line.length,
      implFunctionName: handler !== 'func' ? handler : undefined,
      implLine: handler === 'func' ? i : undefined,
    });
  }

  for (let i = 0; i < defs.length; i++) {
    defs[i].bodyEndLine =
      i + 1 < defs.length ? defs[i + 1].patternLine - 1 : lines.length - 1;
  }

  return defs;
}

function stepMatches(pattern: string, rawStep: string, normalizedStep: string): boolean {
  if (normalizeStepText(pattern) === normalizedStep) {
    return true;
  }
  if (isCucumberExpression(pattern)) {
    try {
      return cucumberExpressionToRegex(pattern).test(rawStep.trim());
    } catch {
      return false;
    }
  }
  return regexMatchesRawStep(pattern, rawStep);
}

export const goAdapter: LanguageAdapter = {
  parseStepDefinitions: parseGoStepDefinitions,
  matchesStep: (def, rawStep, normalizedStep) =>
    stepMatches(def.pattern, rawStep, normalizedStep),
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- goAdapter
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/adapters/goAdapter.ts src/adapters/__tests__/goAdapter.test.ts
git commit -m "feat: add Go step adapter (ctx.Step pattern)"
```

---

## Task 4: Java adapter (covers Java + Kotlin)

**Files:**
- Create: `src/adapters/javaAdapter.ts`
- Create: `src/adapters/__tests__/javaAdapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/adapters/__tests__/javaAdapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseJavaStepDefinitions, javaAdapter } from '../javaAdapter';

describe('parseJavaStepDefinitions', () => {
  it('parses @Given annotation', () => {
    const content = [
      '@Given("I have {int} cucumbers in a basket")',
      'public void iHaveCucumbers(int n) {',
      '}',
    ].join('\n');
    const defs = parseJavaStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {int} cucumbers in a basket');
    expect(defs[0].patternLine).toBe(0);
    expect(defs[0].implLine).toBe(1);
    expect(defs[0].implFunctionName).toBe('iHaveCucumbers');
  });

  it('parses Kotlin @Given annotation', () => {
    const content = [
      '@When("the user clicks submit")',
      'fun theUserClicksSubmit() {',
      '}',
    ].join('\n');
    const defs = parseJavaStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the user clicks submit');
    expect(defs[0].implFunctionName).toBe('theUserClicksSubmit');
  });

  it('parses @Then annotation', () => {
    const content = [
      '@Then("I should see {int} results")',
      'public void iShouldSeeResults(int count) {}',
    ].join('\n');
    const defs = parseJavaStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I should see {int} results');
  });

  it('parses multiple annotations', () => {
    const content = [
      '@Given("step one")',
      'public void stepOne() {}',
      '',
      '@When("step two")',
      'public void stepTwo() {}',
    ].join('\n');
    const defs = parseJavaStepDefinitions(content);
    expect(defs).toHaveLength(2);
    expect(defs[0].bodyEndLine).toBeLessThan(defs[1].patternLine);
  });

  it('ignores non-annotation lines', () => {
    expect(parseJavaStepDefinitions('public void someMethod() {}')).toHaveLength(0);
  });
});

describe('javaAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches Cucumber Expression', () => {
    expect(javaAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('matches exact text', () => {
    expect(javaAdapter.matchesStep(makeDef('the user logs in'), 'the user logs in', 'the user logs in')).toBe(true);
  });

  it('does not match different step', () => {
    expect(javaAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I eat 5 cucumbers', 'i eat 5 cucumbers')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- javaAdapter
```

- [ ] **Step 3: Create `src/adapters/javaAdapter.ts`**

```typescript
import type { LanguageAdapter, StepDefinition } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

// Matches @Given("...") / @When / @Then / @And / @But — Java and Kotlin use identical syntax
const ANNOTATION_RE = /^\s*@(Given|When|Then|And|But)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/;
// Matches Java method: `public void methodName(` or Kotlin `fun methodName(`
const METHOD_RE = /(?:public\s+|private\s+|protected\s+|override\s+)*(?:void|fun|\w+)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

export function parseJavaStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = ANNOTATION_RE.exec(lines[i]);
    if (!m) {
      continue;
    }

    const pattern = m[2];
    const quoteStart = lines[i].indexOf('"');
    const quoteEnd = lines[i].lastIndexOf('"');

    let implLine: number | undefined;
    let implFunctionName: string | undefined;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const mm = METHOD_RE.exec(lines[j]);
      if (mm) {
        implLine = j;
        implFunctionName = mm[1];
        break;
      }
    }

    defs.push({
      pattern,
      patternLine: i,
      patternStartCol: quoteStart >= 0 ? quoteStart : 0,
      patternEndCol: quoteEnd >= 0 ? quoteEnd + 1 : lines[i].length,
      implFunctionName,
      implLine,
    });
  }

  for (let i = 0; i < defs.length; i++) {
    defs[i].bodyEndLine =
      i + 1 < defs.length ? defs[i + 1].patternLine - 1 : lines.length - 1;
  }

  return defs;
}

function stepMatches(pattern: string, rawStep: string, normalizedStep: string): boolean {
  if (normalizeStepText(pattern) === normalizedStep) {
    return true;
  }
  if (isCucumberExpression(pattern)) {
    try {
      return cucumberExpressionToRegex(pattern).test(rawStep.trim());
    } catch {
      return false;
    }
  }
  try {
    return new RegExp(pattern).test(rawStep.trim());
  } catch {
    return false;
  }
}

export const javaAdapter: LanguageAdapter = {
  parseStepDefinitions: parseJavaStepDefinitions,
  matchesStep: (def, rawStep, normalizedStep) =>
    stepMatches(def.pattern, rawStep, normalizedStep),
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- javaAdapter
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/javaAdapter.ts src/adapters/__tests__/javaAdapter.test.ts
git commit -m "feat: add Java/Kotlin step adapter (@Given/@When/@Then)"
```

---

## Task 5: Python adapter

**Files:**
- Create: `src/adapters/pythonAdapter.ts`
- Create: `src/adapters/__tests__/pythonAdapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/adapters/__tests__/pythonAdapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePythonStepDefinitions, pythonAdapter } from '../pythonAdapter';

describe('parsePythonStepDefinitions', () => {
  it('parses @given decorator', () => {
    const content = [
      "@given('I have {n:d} cucumbers')",
      'def step_impl(context, n):',
      '    pass',
    ].join('\n');
    const defs = parsePythonStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {n:d} cucumbers');
    expect(defs[0].patternLine).toBe(0);
    expect(defs[0].implLine).toBe(1);
    expect(defs[0].implFunctionName).toBe('step_impl');
  });

  it('parses double-quoted @when', () => {
    const content = [
      '@when("the user clicks submit")',
      'def click_submit(context):',
      '    pass',
    ].join('\n');
    const defs = parsePythonStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the user clicks submit');
    expect(defs[0].implFunctionName).toBe('click_submit');
  });

  it('parses @step decorator', () => {
    const content = "@step('generic step')\ndef do_thing(context): pass";
    const defs = parsePythonStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('generic step');
  });

  it('parses multiple steps', () => {
    const content = [
      "@given('step one')",
      'def step_one(ctx): pass',
      '',
      "@then('step two')",
      'def step_two(ctx): pass',
    ].join('\n');
    const defs = parsePythonStepDefinitions(content);
    expect(defs).toHaveLength(2);
  });
});

describe('pythonAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches normalized text', () => {
    expect(pythonAdapter.matchesStep(makeDef('the user logs in'), 'the user logs in', 'the user logs in')).toBe(true);
  });

  it('matches Cucumber Expression', () => {
    expect(pythonAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- pythonAdapter
```

- [ ] **Step 3: Create `src/adapters/pythonAdapter.ts`**

```typescript
import type { LanguageAdapter, StepDefinition } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

// Matches @given('...') / @when("...") / @then / @step — case-insensitive
const DECORATOR_RE = /^\s*@(given|when|then|step)\s*\(\s*(?:'([^']*)'|"([^"]*)")\s*\)/i;
const DEF_RE = /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

export function parsePythonStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = DECORATOR_RE.exec(lines[i]);
    if (!m) {
      continue;
    }

    const pattern = m[2] ?? m[3];
    const quoteChar = m[2] !== undefined ? "'" : '"';
    const quoteStart = lines[i].indexOf(quoteChar);
    const quoteEnd = lines[i].lastIndexOf(quoteChar);

    let implLine: number | undefined;
    let implFunctionName: string | undefined;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const mm = DEF_RE.exec(lines[j]);
      if (mm) {
        implLine = j;
        implFunctionName = mm[1];
        break;
      }
    }

    defs.push({
      pattern,
      patternLine: i,
      patternStartCol: quoteStart >= 0 ? quoteStart : 0,
      patternEndCol: quoteEnd >= 0 ? quoteEnd + 1 : lines[i].length,
      implFunctionName,
      implLine,
    });
  }

  for (let i = 0; i < defs.length; i++) {
    defs[i].bodyEndLine =
      i + 1 < defs.length ? defs[i + 1].patternLine - 1 : lines.length - 1;
  }

  return defs;
}

function stepMatches(pattern: string, rawStep: string, normalizedStep: string): boolean {
  if (normalizeStepText(pattern) === normalizedStep) {
    return true;
  }
  if (isCucumberExpression(pattern)) {
    try {
      return cucumberExpressionToRegex(pattern).test(rawStep.trim());
    } catch {
      return false;
    }
  }
  try {
    return new RegExp(pattern, 'i').test(rawStep.trim());
  } catch {
    return false;
  }
}

export const pythonAdapter: LanguageAdapter = {
  parseStepDefinitions: parsePythonStepDefinitions,
  matchesStep: (def, rawStep, normalizedStep) =>
    stepMatches(def.pattern, rawStep, normalizedStep),
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- pythonAdapter
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/pythonAdapter.ts src/adapters/__tests__/pythonAdapter.test.ts
git commit -m "feat: add Python step adapter (@given/@when/@then)"
```

---

## Task 6: JavaScript / TypeScript adapter

**Files:**
- Create: `src/adapters/jsAdapter.ts`
- Create: `src/adapters/__tests__/jsAdapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/adapters/__tests__/jsAdapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseJsStepDefinitions, jsAdapter } from '../jsAdapter';

describe('parseJsStepDefinitions', () => {
  it('parses single-quoted string step', () => {
    const content = "Given('I have {int} cucumbers', function(n) {});";
    const defs = parseJsStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {int} cucumbers');
    expect(defs[0].patternLine).toBe(0);
  });

  it('parses double-quoted string step', () => {
    const content = 'When("the user logs in", (ctx) => {});';
    const defs = parseJsStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the user logs in');
  });

  it('parses template-literal step', () => {
    const content = 'Then(`I should see {int} results`, fn);';
    const defs = parseJsStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I should see {int} results');
  });

  it('parses regex step', () => {
    const content = 'Given(/^I have (\\d+) cucumbers$/, function(n) {});';
    const defs = parseJsStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('^I have (\\d+) cucumbers$');
  });

  it('parses multiple steps', () => {
    const content = [
      "Given('step one', fn);",
      "When('step two', fn);",
    ].join('\n');
    expect(parseJsStepDefinitions(content)).toHaveLength(2);
  });
});

describe('jsAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches Cucumber Expression', () => {
    expect(jsAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('matches regex pattern', () => {
    expect(jsAdapter.matchesStep(makeDef('^I have (\\d+) cucumbers$'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- jsAdapter
```

- [ ] **Step 3: Create `src/adapters/jsAdapter.ts`**

```typescript
import type { LanguageAdapter, StepDefinition } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

// String form: Given('...') / When("...") / Then(`...`)
const STRING_STEP_RE = /^\s*(Given|When|Then|And|But)\s*\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/;
// Regex form: Given(/.../)
const REGEX_STEP_RE = /^\s*(Given|When|Then|And|But)\s*\(\s*\/([^/]+)\//;

export function parseJsStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const sm = STRING_STEP_RE.exec(line);
    if (sm) {
      const pattern = sm[2] ?? sm[3] ?? sm[4];
      const quoteChar = sm[2] !== undefined ? "'" : sm[3] !== undefined ? '"' : '`';
      const qStart = line.indexOf(quoteChar);
      const qEnd = line.indexOf(quoteChar, qStart + 1);
      defs.push({
        pattern,
        patternLine: i,
        patternStartCol: qStart >= 0 ? qStart : 0,
        patternEndCol: qEnd >= 0 ? qEnd + 1 : line.length,
        implLine: i,
      });
      continue;
    }

    const rm = REGEX_STEP_RE.exec(line);
    if (rm) {
      const pattern = rm[2];
      const slashStart = line.indexOf('/');
      const slashEnd = line.indexOf('/', slashStart + 1);
      defs.push({
        pattern,
        patternLine: i,
        patternStartCol: slashStart >= 0 ? slashStart : 0,
        patternEndCol: slashEnd >= 0 ? slashEnd + 1 : line.length,
        implLine: i,
      });
    }
  }

  for (let i = 0; i < defs.length; i++) {
    defs[i].bodyEndLine =
      i + 1 < defs.length ? defs[i + 1].patternLine - 1 : lines.length - 1;
  }

  return defs;
}

function stepMatches(pattern: string, rawStep: string, normalizedStep: string): boolean {
  if (normalizeStepText(pattern) === normalizedStep) {
    return true;
  }
  if (isCucumberExpression(pattern)) {
    try {
      return cucumberExpressionToRegex(pattern).test(rawStep.trim());
    } catch {
      return false;
    }
  }
  try {
    return new RegExp(pattern).test(rawStep.trim());
  } catch {
    return false;
  }
}

export const jsAdapter: LanguageAdapter = {
  parseStepDefinitions: parseJsStepDefinitions,
  matchesStep: (def, rawStep, normalizedStep) =>
    stepMatches(def.pattern, rawStep, normalizedStep),
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- jsAdapter
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/jsAdapter.ts src/adapters/__tests__/jsAdapter.test.ts
git commit -m "feat: add JavaScript/TypeScript step adapter (cucumber-js)"
```

---

## Task 7: Ruby adapter

**Files:**
- Create: `src/adapters/rubyAdapter.ts`
- Create: `src/adapters/__tests__/rubyAdapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/adapters/__tests__/rubyAdapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseRubyStepDefinitions, rubyAdapter } from '../rubyAdapter';

describe('parseRubyStepDefinitions', () => {
  it('parses single-quoted step', () => {
    const content = "Given('I have {int} cucumbers') do |n|\nend";
    const defs = parseRubyStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {int} cucumbers');
    expect(defs[0].patternLine).toBe(0);
  });

  it('parses double-quoted step', () => {
    const content = 'When("the user logs in") do\nend';
    const defs = parseRubyStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the user logs in');
  });

  it('parses regex step', () => {
    const content = 'Then(/^I should see (\\d+) results$/) do |n|\nend';
    const defs = parseRubyStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('^I should see (\\d+) results$');
  });

  it('parses multiple steps', () => {
    const content = "Given('step one') do\nend\nWhen('step two') do\nend";
    expect(parseRubyStepDefinitions(content)).toHaveLength(2);
  });
});

describe('rubyAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches Cucumber Expression', () => {
    expect(rubyAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('matches regex', () => {
    expect(rubyAdapter.matchesStep(makeDef('^I have (\\d+) cucumbers$'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- rubyAdapter
```

- [ ] **Step 3: Create `src/adapters/rubyAdapter.ts`**

```typescript
import type { LanguageAdapter, StepDefinition } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

// String form: Given('...') do  /  When("...") do
const STRING_RE = /^\s*(Given|When|Then|And|But)\s*\(\s*(?:'([^']*)'|"([^"]*)")\s*\)/;
// Regex form: Given(/.../) do
const REGEX_RE = /^\s*(Given|When|Then|And|But)\s*\(\s*\/([^/]+)\//;

export function parseRubyStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const sm = STRING_RE.exec(line);
    if (sm) {
      const pattern = sm[2] ?? sm[3];
      const q = sm[2] !== undefined ? "'" : '"';
      const qStart = line.indexOf(q);
      const qEnd = line.indexOf(q, qStart + 1);
      defs.push({
        pattern,
        patternLine: i,
        patternStartCol: qStart >= 0 ? qStart : 0,
        patternEndCol: qEnd >= 0 ? qEnd + 1 : line.length,
        implLine: i,
      });
      continue;
    }

    const rm = REGEX_RE.exec(line);
    if (rm) {
      const pattern = rm[2];
      const sStart = line.indexOf('/');
      const sEnd = line.indexOf('/', sStart + 1);
      defs.push({
        pattern,
        patternLine: i,
        patternStartCol: sStart >= 0 ? sStart : 0,
        patternEndCol: sEnd >= 0 ? sEnd + 1 : line.length,
        implLine: i,
      });
    }
  }

  for (let i = 0; i < defs.length; i++) {
    defs[i].bodyEndLine =
      i + 1 < defs.length ? defs[i + 1].patternLine - 1 : lines.length - 1;
  }

  return defs;
}

function stepMatches(pattern: string, rawStep: string, normalizedStep: string): boolean {
  if (normalizeStepText(pattern) === normalizedStep) {
    return true;
  }
  if (isCucumberExpression(pattern)) {
    try {
      return cucumberExpressionToRegex(pattern).test(rawStep.trim());
    } catch {
      return false;
    }
  }
  try {
    return new RegExp(pattern).test(rawStep.trim());
  } catch {
    return false;
  }
}

export const rubyAdapter: LanguageAdapter = {
  parseStepDefinitions: parseRubyStepDefinitions,
  matchesStep: (def, rawStep, normalizedStep) =>
    stepMatches(def.pattern, rawStep, normalizedStep),
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- rubyAdapter
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/rubyAdapter.ts src/adapters/__tests__/rubyAdapter.test.ts
git commit -m "feat: add Ruby step adapter"
```

---

## Task 8: C# adapter

**Files:**
- Create: `src/adapters/csharpAdapter.ts`
- Create: `src/adapters/__tests__/csharpAdapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/adapters/__tests__/csharpAdapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseCsharpStepDefinitions, csharpAdapter } from '../csharpAdapter';

describe('parseCsharpStepDefinitions', () => {
  it('parses [Given] attribute', () => {
    const content = [
      '[Given("I have {int} cucumbers")]',
      'public void IHaveCucumbers(int n) {}',
    ].join('\n');
    const defs = parseCsharpStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {int} cucumbers');
    expect(defs[0].patternLine).toBe(0);
    expect(defs[0].implLine).toBe(1);
    expect(defs[0].implFunctionName).toBe('IHaveCucumbers');
  });

  it('parses [When] attribute', () => {
    const content = '[When("the user clicks")]\npublic void TheUserClicks() {}';
    const defs = parseCsharpStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].implFunctionName).toBe('TheUserClicks');
  });

  it('parses [StepDefinition] attribute', () => {
    const content = '[StepDefinition("any step")]\npublic void AnyStep() {}';
    const defs = parseCsharpStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('any step');
  });

  it('parses multiple attributes', () => {
    const content = [
      '[Given("step one")]',
      'public void StepOne() {}',
      '[Then("step two")]',
      'public void StepTwo() {}',
    ].join('\n');
    expect(parseCsharpStepDefinitions(content)).toHaveLength(2);
  });
});

describe('csharpAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches Cucumber Expression', () => {
    expect(csharpAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- csharpAdapter
```

- [ ] **Step 3: Create `src/adapters/csharpAdapter.ts`**

```typescript
import type { LanguageAdapter, StepDefinition } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

// Matches [Given("...")] / [When] / [Then] / [And] / [But] / [StepDefinition("...")]
const ATTR_RE = /^\s*\[\s*(Given|When|Then|And|But|StepDefinition)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*\]/;
// Matches C# method declaration
const METHOD_RE = /(?:public|private|protected|internal|static|\s)+\w+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

export function parseCsharpStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = ATTR_RE.exec(lines[i]);
    if (!m) {
      continue;
    }

    const pattern = m[2];
    const qStart = lines[i].indexOf('"');
    const qEnd = lines[i].lastIndexOf('"');

    let implLine: number | undefined;
    let implFunctionName: string | undefined;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const mm = METHOD_RE.exec(lines[j]);
      if (mm) {
        implLine = j;
        implFunctionName = mm[1];
        break;
      }
    }

    defs.push({
      pattern,
      patternLine: i,
      patternStartCol: qStart >= 0 ? qStart : 0,
      patternEndCol: qEnd >= 0 ? qEnd + 1 : lines[i].length,
      implFunctionName,
      implLine,
    });
  }

  for (let i = 0; i < defs.length; i++) {
    defs[i].bodyEndLine =
      i + 1 < defs.length ? defs[i + 1].patternLine - 1 : lines.length - 1;
  }

  return defs;
}

function stepMatches(pattern: string, rawStep: string, normalizedStep: string): boolean {
  if (normalizeStepText(pattern) === normalizedStep) {
    return true;
  }
  if (isCucumberExpression(pattern)) {
    try {
      return cucumberExpressionToRegex(pattern).test(rawStep.trim());
    } catch {
      return false;
    }
  }
  try {
    return new RegExp(pattern).test(rawStep.trim());
  } catch {
    return false;
  }
}

export const csharpAdapter: LanguageAdapter = {
  parseStepDefinitions: parseCsharpStepDefinitions,
  matchesStep: (def, rawStep, normalizedStep) =>
    stepMatches(def.pattern, rawStep, normalizedStep),
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- csharpAdapter
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/csharpAdapter.ts src/adapters/__tests__/csharpAdapter.test.ts
git commit -m "feat: add C# step adapter ([Given]/[When]/[Then] SpecFlow/Reqnroll)"
```

---

## Task 9: Dart adapter

**Files:**
- Create: `src/adapters/dartAdapter.ts`
- Create: `src/adapters/__tests__/dartAdapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/adapters/__tests__/dartAdapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseDartStepDefinitions, dartAdapter } from '../dartAdapter';

describe('parseDartStepDefinitions', () => {
  it('parses given1 with generic type', () => {
    const content = "given1<int>('I have {int} cucumbers', (world, n) async {});";
    const defs = parseDartStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {int} cucumbers');
    expect(defs[0].patternLine).toBe(0);
  });

  it('parses given without generic type', () => {
    const content = "given('the app is running', (world) async {});";
    const defs = parseDartStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the app is running');
  });

  it('parses when1', () => {
    const content = 'when1<String>("the user enters {string}", (world, s) async {});';
    const defs = parseDartStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the user enters {string}');
  });

  it('parses then1', () => {
    const content = "then1<int>('I should see {int} items', (world, n) async {});";
    const defs = parseDartStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I should see {int} items');
  });

  it('parses multiple steps', () => {
    const content = [
      "given('step one', (world) async {});",
      "when('step two', (world) async {});",
    ].join('\n');
    expect(parseDartStepDefinitions(content)).toHaveLength(2);
  });
});

describe('dartAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches Cucumber Expression', () => {
    expect(dartAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- dartAdapter
```

- [ ] **Step 3: Create `src/adapters/dartAdapter.ts`**

```typescript
import type { LanguageAdapter, StepDefinition } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

// Matches: given1<Type>('pattern', ...) or given('pattern', ...) — single or double quotes
const DART_STEP_RE =
  /^\s*(given\d*|when\d*|then\d*|and\d*|but\d*)\s*(?:<[^>]*>)?\s*\(\s*(?:'([^']*)'|"([^"]*)")/i;

export function parseDartStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = DART_STEP_RE.exec(lines[i]);
    if (!m) {
      continue;
    }

    const pattern = m[2] ?? m[3];
    const q = m[2] !== undefined ? "'" : '"';
    const qStart = lines[i].indexOf(q);
    const qEnd = lines[i].indexOf(q, qStart + 1);

    defs.push({
      pattern,
      patternLine: i,
      patternStartCol: qStart >= 0 ? qStart : 0,
      patternEndCol: qEnd >= 0 ? qEnd + 1 : lines[i].length,
      implLine: i,
    });
  }

  for (let i = 0; i < defs.length; i++) {
    defs[i].bodyEndLine =
      i + 1 < defs.length ? defs[i + 1].patternLine - 1 : lines.length - 1;
  }

  return defs;
}

function stepMatches(pattern: string, rawStep: string, normalizedStep: string): boolean {
  if (normalizeStepText(pattern) === normalizedStep) {
    return true;
  }
  if (isCucumberExpression(pattern)) {
    try {
      return cucumberExpressionToRegex(pattern).test(rawStep.trim());
    } catch {
      return false;
    }
  }
  try {
    return new RegExp(pattern).test(rawStep.trim());
  } catch {
    return false;
  }
}

export const dartAdapter: LanguageAdapter = {
  parseStepDefinitions: parseDartStepDefinitions,
  matchesStep: (def, rawStep, normalizedStep) =>
    stepMatches(def.pattern, rawStep, normalizedStep),
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- dartAdapter
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/dartAdapter.ts src/adapters/__tests__/dartAdapter.test.ts
git commit -m "feat: add Dart step adapter (flutter_gherkin given1/when1/then1)"
```

---

## Task 10: Adapter registry

**Files:**
- Create: `src/adapterRegistry.ts`

- [ ] **Step 1: Create `src/adapterRegistry.ts`**

```typescript
import type { LanguageAdapter } from './languageAdapter';
import { goAdapter } from './adapters/goAdapter';
import { javaAdapter } from './adapters/javaAdapter';
import { pythonAdapter } from './adapters/pythonAdapter';
import { jsAdapter } from './adapters/jsAdapter';
import { rubyAdapter } from './adapters/rubyAdapter';
import { csharpAdapter } from './adapters/csharpAdapter';
import { dartAdapter } from './adapters/dartAdapter';

const EXT_MAP: Record<string, LanguageAdapter> = {
  go: goAdapter,
  java: javaAdapter,
  kt: javaAdapter,
  py: pythonAdapter,
  ts: jsAdapter,
  js: jsAdapter,
  rb: rubyAdapter,
  cs: csharpAdapter,
  dart: dartAdapter,
};

/**
 * Returns the adapter for the given stepsGlob pattern by inspecting its file extension.
 * Examples: "**\/*Steps.java" → javaAdapter, "**\/*_steps.go" → goAdapter
 * Falls back to goAdapter for unknown extensions.
 */
export function getAdapterForGlob(stepsGlob: string): LanguageAdapter {
  const m = stepsGlob.match(/\.([a-zA-Z]+)(?:[^a-zA-Z]|$)/);
  const ext = m ? m[1].toLowerCase() : '';
  return EXT_MAP[ext] ?? goAdapter;
}

/**
 * Returns the adapter for a file by its extension (used for reverse navigation).
 */
export function getAdapterForUri(uri: { fsPath: string }): LanguageAdapter {
  const ext = uri.fsPath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? goAdapter;
}
```

- [ ] **Step 2: Compile**

```bash
npm run compile
```

Expected: exits 0

- [ ] **Step 3: Commit**

```bash
git add src/adapterRegistry.ts
git commit -m "feat: add adapter registry (extension → language adapter map)"
```

---

## Task 11: Make `bddFile` optional in `config.ts`

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Open `src/config.ts` and change `bddFile` to optional**

Find the `PackConfig` type (line ~5–10):

```typescript
// BEFORE
export type PackConfig = {
  name?: string;
  featureGlob: string;
  bddFile: string;
  stepsGlob: string;
};
```

Change to:

```typescript
// AFTER
export type PackConfig = {
  name?: string;
  featureGlob: string;
  bddFile?: string;
  stepsGlob: string;
};
```

- [ ] **Step 2: Compile — verify no type errors**

```bash
npm run compile
```

Expected: exits 0. TypeScript will flag any places that assumed `bddFile` is always defined — fix those by adding `entry.pack.bddFile &&` guards (the resolver changes in Task 13 will handle this properly).

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "refactor: make bddFile optional in PackConfig (backward-compat)"
```

---

## Task 12: Extend `documentCache.ts` for `StepDefinition[]`

**Files:**
- Modify: `src/documentCache.ts`

- [ ] **Step 1: Read current `src/documentCache.ts`** (already read above — content is ~45 lines with `bddCache`, `getBddBlocks`, `invalidateDocument`, `invalidateAll`)

- [ ] **Step 2: Add `StepDefinition` cache alongside existing `BddStepBlock` cache**

Replace the entire content of `src/documentCache.ts` with:

```typescript
import * as vscode from "vscode";
import { parseBddFile, type BddStepBlock } from "./bddParser";
import type { LanguageAdapter, StepDefinition } from "./languageAdapter";
import { isSameLocalFile } from "./sameFileUri";

// ── Legacy Go BDD block cache ─────────────────────────────────────────────────

type BddCacheEntry = {
  mtime: number;
  blocks: BddStepBlock[];
};

const bddCache = new Map<string, BddCacheEntry>();

function openDocForUri(uri: vscode.Uri): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((d) => isSameLocalFile(d.uri, uri));
}

export async function getBddBlocks(uri: vscode.Uri): Promise<BddStepBlock[]> {
  const open = openDocForUri(uri);
  if (open) {
    return parseBddFile(open.getText());
  }

  const stat = await vscode.workspace.fs.stat(uri);
  const mtime = typeof stat.mtime === "number" ? stat.mtime : Number(stat.mtime);
  const key = uri.toString();
  const existing = bddCache.get(key);
  if (existing && existing.mtime === mtime) {
    return existing.blocks;
  }

  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder("utf-8").decode(bytes);
  const blocks = parseBddFile(text);
  bddCache.set(key, { mtime, blocks });

  return blocks;
}

// ── New adapter-based StepDefinition cache ────────────────────────────────────

type StepDefCacheEntry = {
  mtime: number;
  defs: StepDefinition[];
};

const stepDefCache = new Map<string, StepDefCacheEntry>();

export async function getStepDefinitions(
  uri: vscode.Uri,
  adapter: LanguageAdapter,
): Promise<StepDefinition[]> {
  const open = openDocForUri(uri);
  if (open) {
    return adapter.parseStepDefinitions(open.getText());
  }

  const stat = await vscode.workspace.fs.stat(uri);
  const mtime = typeof stat.mtime === "number" ? stat.mtime : Number(stat.mtime);
  const key = uri.toString();
  const existing = stepDefCache.get(key);
  if (existing && existing.mtime === mtime) {
    return existing.defs;
  }

  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder("utf-8").decode(bytes);
  const defs = adapter.parseStepDefinitions(text);
  stepDefCache.set(key, { mtime, defs });

  return defs;
}

// ── Invalidation ──────────────────────────────────────────────────────────────

export function invalidateDocument(uri: vscode.Uri): void {
  const key = uri.toString();
  bddCache.delete(key);
  stepDefCache.delete(key);
}

export function invalidateAll(): void {
  bddCache.clear();
  stepDefCache.clear();
}
```

- [ ] **Step 3: Compile**

```bash
npm run compile
```

Expected: exits 0

- [ ] **Step 4: Commit**

```bash
git add src/documentCache.ts
git commit -m "feat: add StepDefinition cache to documentCache alongside legacy BddBlock cache"
```

---

## Task 13: Refactor `resolver.ts` — add adapter path

**Files:**
- Modify: `src/resolver.ts`

This is the largest change. Read the current file carefully before editing. The strategy: wrap the existing logic inside an `if (entry.pack.bddFile)` guard, and add the new adapter path in the `else` branch.

- [ ] **Step 1: Add new imports at the top of `src/resolver.ts`**

After the existing imports, add:

```typescript
import { getAdapterForGlob, getAdapterForUri } from "./adapterRegistry";
import { getStepDefinitions } from "./documentCache";
import { findDefinitionAtPosition } from "./languageAdapter";
import type { StepDefinition } from "./languageAdapter";
import { isCucumberExpression, cucumberExpressionToRegex } from "./adapters/cucumberExpression";
```

- [ ] **Step 2: Add helper `resolveFromFeatureViaAdapter` to `src/resolver.ts`**

Add this new private function after the existing `dedupeDefinitionsOutsideSourceDoc` function:

```typescript
async function resolveFromFeatureViaAdapter(
  entry: ResolutionEntry,
  document: vscode.TextDocument,
  stepText: string,
  normalizedStep: string,
  token: vscode.CancellationToken,
): Promise<vscode.Location[] | undefined> {
  const adapter = getAdapterForGlob(entry.pack.stepsGlob);
  const featureRel = workspaceRelativePath(entry.folder, document.uri);
  const stepsGlobConcrete = concretePathFromFeatureAndGlobPattern(featureRel, entry.pack.stepsGlob);
  const pattern = new vscode.RelativePattern(entry.folder, stepsGlobConcrete);
  const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 200, token);

  for (const file of files) {
    if (token.isCancellationRequested) {
      return undefined;
    }

    let defs: StepDefinition[];
    try {
      defs = await getStepDefinitions(file, adapter);
    } catch {
      continue;
    }

    const def = defs.find((d) => adapter.matchesStep(d, stepText, normalizedStep));
    if (!def) {
      continue;
    }

    if (def.implLine !== undefined) {
      const pos = new vscode.Position(def.implLine, 0);
      return [new vscode.Location(file, new vscode.Range(pos, pos))];
    }

    if (def.implFunctionName) {
      const impl = await findImplementationLocation(entry, def.implFunctionName, token, document.uri);
      if (impl) {
        return [impl];
      }
    }

    const start = new vscode.Position(def.patternLine, def.patternStartCol);
    const end = new vscode.Position(def.patternLine, def.patternEndCol);
    return [new vscode.Location(file, new vscode.Range(start, end))];
  }

  return undefined;
}
```

- [ ] **Step 3: Update `resolveFromFeature` to branch on `bddFile`**

In `resolveFromFeature`, the inner `for (const entry of chain)` loop currently starts with `const bddUri = bddUriForEntry(...)`. Wrap the entire body of that loop with a `bddFile` guard:

```typescript
// REPLACE the loop body (lines ~64-105 in original resolver.ts) with:
for (const entry of chain) {
  if (token.isCancellationRequested) {
    return undefined;
  }

  // ── Legacy path: bddFile registry present ──────────────────────────────
  if (entry.pack.bddFile) {
    const bddUri = bddUriForEntry(entry, document.uri);
    let blocks: BddStepBlock[];
    try {
      blocks = await getBddBlocks(bddUri);
    } catch {
      continue;
    }

    const block = blocks.find((b) => blockMatchesStep(b, stepText, normalized));
    if (!block) {
      continue;
    }

    const locations: vscode.Location[] = [];
    if (block.implFunctionName) {
      const impl = await findImplementationLocation(entry, block.implFunctionName, token, document.uri);
      if (impl) {
        locations.push(impl);
      }
    }

    if (shouldIncludeStepRegistryInDefinition()) {
      locations.push(bddLocationForBlock(bddUri, block));
    }

    if (locations.length === 0) {
      locations.push(bddLocationForBlock(bddUri, block));
    }

    const filtered = dedupeDefinitionsOutsideSourceDoc(document, locations);
    return filtered.length === 0 ? locations : filtered;
  }

  // ── New adapter path: no bddFile ───────────────────────────────────────
  const result = await resolveFromFeatureViaAdapter(entry, document, stepText, normalized, token);
  if (result) {
    return dedupeDefinitionsOutsideSourceDoc(document, result).length > 0
      ? dedupeDefinitionsOutsideSourceDoc(document, result)
      : result;
  }
}
```

- [ ] **Step 4: Update `resolveFeatureUsagesFromStepsAtPosition` to branch on `bddFile`**

Find the function `resolveFeatureUsagesFromStepsAtPosition` (currently ~line 191). Replace its body with:

```typescript
export async function resolveFeatureUsagesFromStepsAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
): Promise<vscode.Location[] | undefined> {
  const match = findPackForStepsFile(document.uri);
  if (!match) {
    return undefined;
  }

  // ── Legacy path ────────────────────────────────────────────────────────
  if (match.entry.pack.bddFile) {
    const funcName = functionNameAtOrAboveLine(document, position.line);
    if (!funcName) {
      return undefined;
    }

    const bddUri = bddUriForStepsEntry(match.entry, document.uri);
    let blocks: BddStepBlock[];
    try {
      blocks = await getBddBlocks(bddUri);
    } catch {
      return undefined;
    }

    const block = blocks.find((b) => b.implFunctionName === funcName);
    if (!block) {
      return undefined;
    }

    const canonical = stepTextFromBlock(block);
    const bddMatch = { entry: match.entry, fromProject: match.fromProject };
    const globs = getFeatureGlobsForBddReverse(bddMatch);

    return findFeatureUsages(match.entry.folder, globs, canonical, block.regexPattern, token);
  }

  // ── New adapter path ───────────────────────────────────────────────────
  const adapter = getAdapterForUri(document.uri);
  const defs = adapter.parseStepDefinitions(document.getText());
  const def = findDefinitionAtPosition(defs, position.line);
  if (!def) {
    return undefined;
  }

  const bddMatch = { entry: match.entry, fromProject: match.fromProject };
  const globs = getFeatureGlobsForBddReverse(bddMatch);

  let regexPattern: string | undefined;
  if (isCucumberExpression(def.pattern)) {
    try {
      regexPattern = cucumberExpressionToRegex(def.pattern).source;
    } catch {
      regexPattern = undefined;
    }
  } else {
    regexPattern = def.pattern;
  }

  return findFeatureUsages(match.entry.folder, globs, def.pattern, regexPattern, token);
}
```

- [ ] **Step 5: Update `explainFeatureStepResolution` to handle missing bddFile**

Find `explainFeatureStepResolution` (currently ~line 110). Add a guard so it reports cleanly for new-path configs:

```typescript
// In the loop, replace `const bddUri = bddUriForEntry(...)` and subsequent block with:
for (const entry of chain) {
  if (token.isCancellationRequested) {
    return out;
  }

  out.push("");
  out.push(`Pack: ${entry.pack.name ?? "(unnamed)"}  featureGlob=${entry.pack.featureGlob}`);

  if (!entry.pack.bddFile) {
    out.push(`  Adapter path (no bddFile) — stepsGlob=${entry.pack.stepsGlob}`);
    const result = await resolveFromFeatureViaAdapter(entry, document, stepText, normalized, token);
    if (result && result.length > 0) {
      out.push(`  → ${vscode.workspace.asRelativePath(result[0].uri)}:${result[0].range.start.line + 1}`);
      return out;
    }
    out.push("  No match found in step files.");
    continue;
  }

  // existing bddFile explain logic unchanged below...
  const bddUri = bddUriForEntry(entry, document.uri);
  out.push(`  bdd → ${vscode.workspace.asRelativePath(bddUri)}`);
  // ... (keep remainder of existing logic here)
}
```

- [ ] **Step 6: Compile**

```bash
npm run compile
```

Fix any type errors. Common ones: `BddStepBlock` import still needed at top of file (keep it), `bddFile` property access needs `entry.pack.bddFile &&` guard.

- [ ] **Step 7: Run all tests**

```bash
npm test
```

Expected: all adapter tests pass

- [ ] **Step 8: Commit**

```bash
git add src/resolver.ts
git commit -m "feat: add adapter-based resolution path to resolver (legacy bddFile path unchanged)"
```

---

## Task 14: Wire `extension.ts` + update `package.json` schema

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add new step-file document selector to `src/extension.ts`**

After the existing `goBddDocumentSelector` constant, add:

```typescript
/** All step file languages supported via the new adapter path (no bddFile required). */
const adapterStepFileSelector: vscode.DocumentSelector = [
  { language: "java", scheme: "file" },
  { language: "java", scheme: "vscode-remote" },
  { language: "kotlin", scheme: "file" },
  { language: "kotlin", scheme: "vscode-remote" },
  { language: "python", scheme: "file" },
  { language: "python", scheme: "vscode-remote" },
  { language: "javascript", scheme: "file" },
  { language: "javascript", scheme: "vscode-remote" },
  { language: "typescript", scheme: "file" },
  { language: "typescript", scheme: "vscode-remote" },
  { language: "ruby", scheme: "file" },
  { language: "ruby", scheme: "vscode-remote" },
  { language: "csharp", scheme: "file" },
  { language: "csharp", scheme: "vscode-remote" },
  { language: "dart", scheme: "file" },
  { language: "dart", scheme: "vscode-remote" },
  { language: "go", scheme: "file" },        // new-path Go (no bddFile)
  { language: "go", scheme: "vscode-remote" },
];
```

- [ ] **Step 2: Add providers for new-path step files in `activate()`**

In `activate()`, after registering the existing providers, add:

```typescript
// New-path step file providers: reverse navigation (step definition → .feature usages)
const adapterStepDefinitionProvider: vscode.DefinitionProvider = {
  provideDefinition: async (document, position, token) => {
    try {
      const match = findPackForStepsFile(document.uri);
      if (!match || match.entry.pack.bddFile) {
        return undefined; // not a new-path step file
      }
      return await resolveFeatureUsagesFromStepsAtPosition(document, position, token);
    } catch (err) {
      logDefinitionProviderError(err);
      return undefined;
    }
  },
};

const adapterStepReferenceProvider: vscode.ReferenceProvider = {
  provideReferences: async (document, position, _ctx, token) => {
    try {
      const match = findPackForStepsFile(document.uri);
      if (!match || match.entry.pack.bddFile) {
        return undefined;
      }
      return await resolveFeatureUsagesFromStepsAtPosition(document, position, token);
    } catch (err) {
      logDefinitionProviderError(err);
      return undefined;
    }
  },
};

context.subscriptions.push(
  vscode.languages.registerDefinitionProvider(adapterStepFileSelector, adapterStepDefinitionProvider),
  vscode.languages.registerReferenceProvider(adapterStepFileSelector, adapterStepReferenceProvider),
);
```

- [ ] **Step 3: Add import for `findPackForStepsFile` in `extension.ts`** if not already imported

Check the top of `extension.ts`. If `findPackForStepsFile` is not imported from `./config`, add it to that import line:

```typescript
import { findPackForBddFile, findPackForStepsFile } from "./config";
```

- [ ] **Step 4: Make `bddFile` optional in `package.json` JSON schema**

In `package.json`, find `cucumberJump.projects` → `items` → `properties`. Change:

```json
"required": [
  "featureGlob",
  "bddFile",
  "stepsGlob"
],
```

to:

```json
"required": [
  "featureGlob",
  "stepsGlob"
],
```

Do the same for `cucumberJump.libraries` → `items` → `required`.

Also update `bddFile`'s description in both places:

```json
"bddFile": {
  "type": "string",
  "description": "Optional. Path or glob to a Go BDD step registry file (e.g. bdd.go). Only required for the legacy Go godog StepMap pattern. Omit for all other languages — the adapter auto-detects from stepsGlob extension."
}
```

- [ ] **Step 5: Compile**

```bash
npm run compile
```

Expected: exits 0

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: register adapter step-file providers for all supported languages; make bddFile optional in schema"
```

---

## Self-review checklist

After completing all tasks, verify:

- [ ] `npm test` passes with no failures
- [ ] `npm run compile` exits 0
- [ ] Open a `.feature` file in a project configured with a Java `stepsGlob` (`**/*.java`) → F12 on a step navigates to the `@Given` annotation
- [ ] From inside a Java `@Given` method → Find References shows `.feature` usages
- [ ] Open a project that has `bddFile` configured → navigation still works exactly as before (regression test)
- [ ] New Go project without `bddFile` (using `ctx.Step(...)`) → navigation works
