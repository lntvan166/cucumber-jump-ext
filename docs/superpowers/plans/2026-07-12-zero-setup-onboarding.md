# Zero-Setup Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Navigation works with zero setup — opening a `.feature` file in an unconfigured workspace triggers a background match-driven scan whose results act as in-memory config; a `Create configuration` command, a one-time save toast, a Get-Started walkthrough, and GitHub Actions CI round out the onboarding phase (spec: `docs/superpowers/specs/2026-07-12-zero-setup-onboarding-design.md`).

**Architecture:** A pure-TypeScript scanner (`configScanner.ts`, no vscode import, Vitest-covered) scores (feature-root, steps-root, language) pairs by real step↔definition matches using the existing adapters. `inferredConfig.ts` runs the scan lazily per workspace folder and caches results; `config.ts`'s two lookup functions fall back to the cached inferred packs when no explicit config exists. `onboarding.ts` owns the commands and notifications.

**Tech Stack:** TypeScript, VS Code extension API, Vitest, GitHub Actions. No new dependencies, no shell/python for users.

## Global Constraints

- All user-facing logic is in-extension TypeScript — no `.sh`/`.py` scripts for end users.
- Explicit `cucumberJump.projects`/`libraries` settings always win; inference never runs when either is non-empty and never writes settings by itself.
- Inference must never throw into the resolver path; failures log to the "Cucumber Jump" output channel and behave as empty results.
- Scan caps: 5000 files per `findFiles`, skip files > 524288 bytes, sample ≤ 40 steps per feature root.
- One onboarding notification per workspace, remembered in `workspaceState` key `cucumberJump.onboarding.dismissed`.
- New setting `cucumberJump.autoConfigure` (boolean, default `true`) disables inference entirely.
- Run `npm test` and `npm run compile` before every commit; both must be green.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Scanner pure core — `configScanner.ts`

**Files:**
- Create: `src/configScanner.ts`
- Modify: `src/adapterRegistry.ts` (export `KNOWN_STEP_EXTENSIONS`)
- Test: `src/__tests__/configScanner.test.ts`

**Interfaces:**
- Consumes: `getAdapterForUri(uri: {fsPath: string}): LanguageAdapter | undefined` from `src/adapterRegistry.ts`; `parseStepLine(line: string): string | undefined` and `normalizeStepText(s: string): string` from `src/featureParser.ts`. None of these import vscode — `configScanner.ts` MUST NOT import vscode either, or the Vitest suite dies at import time.
- Produces (used by Tasks 2 and 4):
  - `type ScanFileRecord = { relPath: string; content: string }`
  - `type ScanProposal = { name: string; featureGlob: string; stepsGlob: string; language: string; matchedSteps: number; totalSteps: number }`
  - `function buildProposals(featureFiles: ScanFileRecord[], stepFiles: ScanFileRecord[]): ScanProposal[]`
  - `const KNOWN_STEP_EXTENSIONS: string[]` (from adapterRegistry — `["go","java","kt","py","ts","js","rb","cs","dart"]`)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/configScanner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildProposals,
  extractStepTexts,
  featureRootFor,
  stepsRootFor,
} from '../configScanner';
import { KNOWN_STEP_EXTENSIONS } from '../adapterRegistry';

const ORDERS_FEATURE = [
  'Feature: Orders',
  '  Scenario: Pay',
  '    Given I have 3 orders',
  '    When I pay 25 dollars',
].join('\n');

// Java source containing @Given("I have {int} orders") and @When("^I pay (\d+) dollars$")
const ORDERS_JAVA = [
  'public class OrderSteps {',
  '  @Given("I have {int} orders")',
  '  public void iHaveOrders(int n) {}',
  '  @When("^I pay (\\\\d+) dollars$")',
  '  public void iPay(int a) {}',
  '}',
].join('\n');

const PLAIN_JAVA = 'public class Util { public void helper() {} }';

describe('KNOWN_STEP_EXTENSIONS', () => {
  it('lists every adapter extension', () => {
    expect([...KNOWN_STEP_EXTENSIONS].sort()).toEqual(
      ['cs', 'dart', 'go', 'java', 'js', 'kt', 'py', 'rb', 'ts'],
    );
  });
});

describe('featureRootFor / stepsRootFor', () => {
  it('roots at the marker directory when present', () => {
    expect(featureRootFor('orders/features/checkout/pay.feature')).toBe('orders/features');
    expect(featureRootFor('go-legacy/feature/login.feature')).toBe('go-legacy/feature');
    expect(stepsRootFor('orders/steps/java/OrderSteps.java')).toBe('orders/steps');
    expect(stepsRootFor('ruby/step_definitions/visit_steps.rb')).toBe('ruby/step_definitions');
    expect(stepsRootFor('svc/testing/login_steps.go')).toBe('svc/testing');
  });

  it('falls back to the file directory when no marker exists', () => {
    expect(featureRootFor('specs/pay.feature')).toBe('specs');
    expect(stepsRootFor('src/glue/OrderSteps.java')).toBe('src/glue');
  });

  it('handles files at the workspace root', () => {
    expect(featureRootFor('pay.feature')).toBe('');
  });
});

describe('extractStepTexts', () => {
  it('returns the step bodies, keywords stripped', () => {
    expect(extractStepTexts(ORDERS_FEATURE)).toEqual(['I have 3 orders', 'I pay 25 dollars']);
  });
});

describe('buildProposals', () => {
  it('pairs a feature tree with the steps tree that matches its steps', () => {
    const proposals = buildProposals(
      [{ relPath: 'orders/features/pay.feature', content: ORDERS_FEATURE }],
      [{ relPath: 'orders/steps/OrderSteps.java', content: ORDERS_JAVA }],
    );
    expect(proposals).toEqual([
      {
        name: 'orders',
        featureGlob: 'orders/features/**/*.feature',
        stepsGlob: 'orders/steps/**/*.java',
        language: 'java',
        matchedSteps: 2,
        totalSteps: 2,
      },
    ]);
  });

  it('produces one proposal per project for two same-language projects', () => {
    const featureA = 'Feature: A\n  Scenario: s\n    Given alpha runs';
    const featureB = 'Feature: B\n  Scenario: s\n    Given beta runs';
    const stepsA = '@Given("alpha runs")\npublic void a() {}';
    const stepsB = '@Given("beta runs")\npublic void b() {}';
    const proposals = buildProposals(
      [
        { relPath: 'a/features/a.feature', content: featureA },
        { relPath: 'b/features/b.feature', content: featureB },
      ],
      [
        { relPath: 'a/steps/A.java', content: stepsA },
        { relPath: 'b/steps/B.java', content: stepsB },
      ],
    );
    expect(proposals.map((p) => `${p.featureGlob} -> ${p.stepsGlob}`)).toEqual([
      'a/features/**/*.feature -> a/steps/**/*.java',
      'b/features/**/*.feature -> b/steps/**/*.java',
    ]);
  });

  it('pairs by match evidence, not directory proximity', () => {
    // b/steps sits "closer" alphabetically/structurally, but only far/steps matches.
    const feature = 'Feature: X\n  Scenario: s\n    Given the widget spins';
    const near = '@Given("something unrelated")\npublic void u() {}';
    const far = '@Given("the widget spins")\npublic void w() {}';
    const proposals = buildProposals(
      [{ relPath: 'x/features/x.feature', content: feature }],
      [
        { relPath: 'x/steps/Near.java', content: near },
        { relPath: 'shared/steps/Far.java', content: far },
      ],
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].stepsGlob).toBe('shared/steps/**/*.java');
    expect(proposals[0].matchedSteps).toBe(1);
  });

  it('returns [] when nothing matches', () => {
    const proposals = buildProposals(
      [{ relPath: 'x/features/x.feature', content: 'Feature: X\n  Scenario: s\n    Given nothing resolves here' }],
      [{ relPath: 'x/steps/Util.java', content: PLAIN_JAVA }],
    );
    expect(proposals).toEqual([]);
  });

  it('ignores files with unknown extensions', () => {
    const proposals = buildProposals(
      [{ relPath: 'x/features/x.feature', content: 'Feature: X\n  Scenario: s\n    Given alpha runs' }],
      [{ relPath: 'x/steps/notes.txt', content: '@Given("alpha runs")' }],
    );
    expect(proposals).toEqual([]);
  });

  it('samples at most 40 steps per feature root', () => {
    const manySteps = ['Feature: big', '  Scenario: s']
      .concat(Array.from({ length: 60 }, (_, i) => `    Given step number ${i}`))
      .join('\n');
    const defs = '@Given("step number {int}")\npublic void s(int i) {}';
    const proposals = buildProposals(
      [{ relPath: 'big/features/big.feature', content: manySteps }],
      [{ relPath: 'big/steps/S.java', content: defs }],
    );
    expect(proposals[0].totalSteps).toBe(40);
    expect(proposals[0].matchedSteps).toBe(40);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- configScanner`
Expected: FAIL — `Cannot find module '../configScanner'` (and `KNOWN_STEP_EXTENSIONS` not exported).

- [ ] **Step 3: Export the extension list from the registry**

In `src/adapterRegistry.ts`, add directly below the `EXT_MAP` declaration:

```typescript
/** Every file extension a language adapter exists for (used by the workspace scanner). */
export const KNOWN_STEP_EXTENSIONS: string[] = Object.keys(EXT_MAP);
```

- [ ] **Step 4: Implement the pure scanner core**

Create `src/configScanner.ts` (NO vscode import — this file must stay Vitest-loadable):

```typescript
import { getAdapterForUri } from './adapterRegistry';
import { normalizeStepText, parseStepLine } from './featureParser';
import type { LanguageAdapter, StepDefinition } from './languageAdapter';

export type ScanFileRecord = { relPath: string; content: string };

export type ScanProposal = {
  name: string;          // derived from the feature root, e.g. "orders"
  featureGlob: string;   // e.g. "orders/features/**/*.feature"
  stepsGlob: string;     // e.g. "orders/steps/**/*.java"
  language: string;      // file extension, e.g. "java"
  matchedSteps: number;
  totalSteps: number;    // sampled (≤ MAX_SAMPLED_STEPS)
};

const MAX_SAMPLED_STEPS = 40;
const FEATURE_DIR_MARKERS = ['features', 'feature'];
const STEPS_DIR_MARKERS = ['steps', 'step_definitions', 'stepdefinitions', 'testing'];

function dirOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

function rootByMarker(relPath: string, markers: string[]): string {
  const dir = dirOf(relPath);
  if (dir === '') {
    return '';
  }
  const segs = dir.split('/');
  for (let i = 0; i < segs.length; i++) {
    if (markers.includes(segs[i].toLowerCase())) {
      return segs.slice(0, i + 1).join('/');
    }
  }
  return dir;
}

export function featureRootFor(relPath: string): string {
  return rootByMarker(relPath, FEATURE_DIR_MARKERS);
}

export function stepsRootFor(relPath: string): string {
  return rootByMarker(relPath, STEPS_DIR_MARKERS);
}

export function extractStepTexts(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const step = parseStepLine(line);
    if (step) {
      out.push(step);
    }
  }
  return out;
}

type StepsGroup = {
  root: string;
  language: string;
  adapter: LanguageAdapter;
  defs: StepDefinition[];
};

function sharedSegments(a: string, b: string): number {
  const as = a.split('/');
  const bs = b.split('/');
  let n = 0;
  while (n < as.length && n < bs.length && as[n] === bs[n]) {
    n++;
  }
  return n;
}

function proposalName(featureRoot: string): string {
  const segs = featureRoot.split('/').filter((s) => s.length > 0);
  const meaningful = segs.filter((s) => !FEATURE_DIR_MARKERS.includes(s.toLowerCase()));
  return meaningful.length > 0 ? meaningful[meaningful.length - 1] : 'workspace';
}

function globFor(root: string, suffix: string): string {
  return root === '' ? `**/*.${suffix}` : `${root}/**/*.${suffix}`;
}

export function buildProposals(
  featureFiles: ScanFileRecord[],
  stepFiles: ScanFileRecord[],
): ScanProposal[] {
  // Sampled step texts per feature root
  const stepsByFeatureRoot = new Map<string, string[]>();
  for (const f of featureFiles) {
    const root = featureRootFor(f.relPath);
    const arr = stepsByFeatureRoot.get(root) ?? [];
    if (arr.length < MAX_SAMPLED_STEPS) {
      for (const s of extractStepTexts(f.content)) {
        if (arr.length >= MAX_SAMPLED_STEPS) {
          break;
        }
        arr.push(s);
      }
    }
    stepsByFeatureRoot.set(root, arr);
  }

  // Parsed definitions grouped by (steps root, language)
  const groups = new Map<string, StepsGroup>();
  for (const f of stepFiles) {
    const adapter = getAdapterForUri({ fsPath: f.relPath });
    if (!adapter) {
      continue;
    }
    let defs: StepDefinition[];
    try {
      defs = adapter.parseStepDefinitions(f.content);
    } catch {
      continue;
    }
    if (defs.length === 0) {
      continue;
    }
    const language = f.relPath.split('.').pop()!.toLowerCase();
    const root = stepsRootFor(f.relPath);
    const key = `${root} ${language}`;
    const g = groups.get(key) ?? { root, language, adapter, defs: [] };
    g.defs.push(...defs);
    groups.set(key, g);
  }

  const proposals: ScanProposal[] = [];
  for (const [featureRoot, steps] of stepsByFeatureRoot) {
    if (steps.length === 0) {
      continue;
    }
    let best: { group: StepsGroup; matched: number } | undefined;
    for (const group of groups.values()) {
      let matched = 0;
      for (const s of steps) {
        const norm = normalizeStepText(s);
        if (group.defs.some((d) => group.adapter.matchesStep(d, s, norm))) {
          matched++;
        }
      }
      if (matched === 0) {
        continue;
      }
      const better =
        !best ||
        matched > best.matched ||
        (matched === best.matched &&
          sharedSegments(featureRoot, group.root) > sharedSegments(featureRoot, best.group.root));
      if (better) {
        best = { group, matched };
      }
    }
    if (!best) {
      continue;
    }
    proposals.push({
      name: proposalName(featureRoot),
      featureGlob: globFor(featureRoot, 'feature'),
      stepsGlob: globFor(best.group.root, best.group.language),
      language: best.group.language,
      matchedSteps: best.matched,
      totalSteps: steps.length,
    });
  }

  const seen = new Set<string>();
  return proposals
    .filter((p) => {
      const k = `${p.featureGlob} ${p.stepsGlob}`;
      if (seen.has(k)) {
        return false;
      }
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.featureGlob.localeCompare(b.featureGlob));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- configScanner`
Expected: PASS (all describe blocks). Then run the full suite: `npm test` — expected 117 existing + new tests, all passing. Also `npm run compile` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/configScanner.ts src/adapterRegistry.ts src/__tests__/configScanner.test.ts
git commit -m "feat: add match-driven workspace scanner core (pure, adapter-backed)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Inference cache + config fallback — `inferredConfig.ts`, `config.ts` hook

**Files:**
- Create: `src/inferredConfig.ts`
- Modify: `src/config.ts` (add `autoConfigureEnabled`, `effectivePackConfigs`; use it in `getResolutionChainForFeature` and `findPackForStepsFile`; add optional `inferred` field to `PackConfig`)
- Modify: `src/resolver.ts` (annotate inferred packs in `explainFeatureStepResolution`)
- Modify: `src/extension.ts` (clear inference on config change)
- Modify: `package.json` (add `cucumberJump.autoConfigure` setting)

**Interfaces:**
- Consumes: `buildProposals`, `ScanFileRecord`, `ScanProposal` from Task 1; `KNOWN_STEP_EXTENSIONS` from adapterRegistry.
- Produces (used by Tasks 3–4):
  - `function scanWorkspace(folder: vscode.WorkspaceFolder, token?: vscode.CancellationToken): Promise<ScanProposal[]>`
  - `function primeInference(folder: vscode.WorkspaceFolder): Promise<ScanProposal[]>` (idempotent, deduped in-flight)
  - `function getInferredPacks(folder: vscode.WorkspaceFolder): PackConfig[]` (sync, `[]` until primed)
  - `function getInferredProposals(folder: vscode.WorkspaceFolder): ScanProposal[]`
  - `function hasInferenceRun(folder: vscode.WorkspaceFolder): boolean`
  - `function clearInference(): void`
  - In config.ts: `function autoConfigureEnabled(): boolean`
  - `PackConfig` gains `inferred?: boolean` (present + true only on inferred packs)

No Vitest here (everything touches vscode); verification is `npm run compile` + full existing suite staying green.

- [ ] **Step 1: Add the setting to `package.json`**

In `contributes.configuration.properties`, after `cucumberJump.notifyConflictingExtensions`:

```json
"cucumberJump.autoConfigure": {
  "type": "boolean",
  "default": true,
  "markdownDescription": "When **true** (default) and no `cucumberJump.projects`/`libraries` are configured, Cucumber Jump scans the workspace once and navigates using the detected projects (nothing is written to settings). Set **false** to disable inference."
}
```

- [ ] **Step 2: Create `src/inferredConfig.ts`**

```typescript
import * as path from "path";
import * as vscode from "vscode";
import { KNOWN_STEP_EXTENSIONS } from "./adapterRegistry";
import { buildProposals, type ScanFileRecord, type ScanProposal } from "./configScanner";
import type { PackConfig } from "./config";

const MAX_FILE_BYTES = 524288;
const FIND_CAP = 5000;

const cachedProposals = new Map<string, ScanProposal[]>();
const cachedPacks = new Map<string, PackConfig[]>();
const inflight = new Map<string, Promise<ScanProposal[]>>();

let scanLog: vscode.OutputChannel | undefined;

function log(message: string): void {
  scanLog ??= vscode.window.createOutputChannel("Cucumber Jump Scan");
  scanLog.appendLine(message);
}

function folderKey(folder: vscode.WorkspaceFolder): string {
  return folder.uri.toString();
}

function relPosix(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
  return path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
}

async function readSmallFile(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_FILE_BYTES) {
      return undefined;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return undefined;
  }
}

export async function scanWorkspace(
  folder: vscode.WorkspaceFolder,
  token?: vscode.CancellationToken,
): Promise<ScanProposal[]> {
  const featureUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/*.feature"),
    "**/node_modules/**",
    FIND_CAP,
    token,
  );
  if (featureUris.length === 0) {
    return [];
  }

  const stepPattern = `**/*.{${KNOWN_STEP_EXTENSIONS.join(",")}}`;
  const stepUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, stepPattern),
    "**/node_modules/**",
    FIND_CAP,
    token,
  );

  const features: ScanFileRecord[] = [];
  for (const uri of featureUris) {
    if (token?.isCancellationRequested) {
      return [];
    }
    const content = await readSmallFile(uri);
    if (content !== undefined) {
      features.push({ relPath: relPosix(folder, uri), content });
    }
  }

  const steps: ScanFileRecord[] = [];
  for (const uri of stepUris) {
    if (token?.isCancellationRequested) {
      return [];
    }
    const content = await readSmallFile(uri);
    if (content !== undefined) {
      steps.push({ relPath: relPosix(folder, uri), content });
    }
  }

  const proposals = buildProposals(features, steps);
  log(
    `Scanned ${folder.name}: ${features.length} feature file(s), ${steps.length} step-file candidate(s) → ${proposals.length} proposal(s)`,
  );
  return proposals;
}

export function getInferredPacks(folder: vscode.WorkspaceFolder): PackConfig[] {
  return cachedPacks.get(folderKey(folder)) ?? [];
}

export function getInferredProposals(folder: vscode.WorkspaceFolder): ScanProposal[] {
  return cachedProposals.get(folderKey(folder)) ?? [];
}

export function hasInferenceRun(folder: vscode.WorkspaceFolder): boolean {
  return cachedProposals.has(folderKey(folder));
}

export function clearInference(): void {
  cachedProposals.clear();
  cachedPacks.clear();
  inflight.clear();
}

export async function primeInference(folder: vscode.WorkspaceFolder): Promise<ScanProposal[]> {
  const key = folderKey(folder);
  const cached = cachedProposals.get(key);
  if (cached) {
    return cached;
  }
  const running = inflight.get(key);
  if (running) {
    return running;
  }

  const job = scanWorkspace(folder)
    .then((proposals) => {
      cachedProposals.set(key, proposals);
      cachedPacks.set(
        key,
        proposals.map((p) => ({
          name: p.name,
          featureGlob: p.featureGlob,
          stepsGlob: p.stepsGlob,
          inferred: true,
        })),
      );
      return proposals;
    })
    .catch((err) => {
      log(`Scan failed for ${folder.name}: ${err}`);
      cachedProposals.set(key, []);
      cachedPacks.set(key, []);
      return [] as ScanProposal[];
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, job);
  return job;
}
```

- [ ] **Step 3: Hook the fallback into `config.ts`**

Add `inferred?: boolean` to `PackConfig`:

```typescript
export type PackConfig = {
  name?: string;
  featureGlob: string;
  bddFile?: string;
  stepsGlob: string;
  /** Present and true only on packs produced by workspace inference (never persisted). */
  inferred?: boolean;
};
```

Add below `readPackConfigs` (plus `import { getInferredPacks } from "./inferredConfig";` at the top — type-only import in inferredConfig.ts keeps the cycle compile-safe):

```typescript
export function autoConfigureEnabled(): boolean {
  return vscode.workspace.getConfiguration("cucumberJump").get<boolean>("autoConfigure") ?? true;
}

function effectivePackConfigs(folder: vscode.WorkspaceFolder): { projects: PackConfig[]; libraries: PackConfig[] } {
  const cfg = readPackConfigs();
  if (cfg.projects.length > 0 || cfg.libraries.length > 0 || !autoConfigureEnabled()) {
    return cfg;
  }
  return { projects: getInferredPacks(folder), libraries: [] };
}
```

In `getResolutionChainForFeature`, replace `const { projects, libraries } = readPackConfigs();` with `const { projects, libraries } = effectivePackConfigs(folder);`.
In `findPackForStepsFile`, replace `const { projects, libraries } = readPackConfigs();` with `const { projects, libraries } = effectivePackConfigs(folder);`.
(`findPackForBddFile` and `getFeatureGlobsForBddReverse` stay on `readPackConfigs` — inference never proposes a bddFile, and reverse globs come from the matched pack itself.)

- [ ] **Step 4: Annotate inferred packs in diagnostics**

In `src/resolver.ts`, in `explainFeatureStepResolution`, change the pack header line

```typescript
    out.push(`Pack: ${entry.pack.name ?? "(unnamed)"}  featureGlob=${entry.pack.featureGlob}`);
```

to

```typescript
    const inferredTag = entry.pack.inferred ? "  (inferred — not saved to settings)" : "";
    out.push(`Pack: ${entry.pack.name ?? "(unnamed)"}  featureGlob=${entry.pack.featureGlob}${inferredTag}`);
```

- [ ] **Step 5: Clear inference when config changes**

In `src/extension.ts`, add to the imports: `import { clearInference } from "./inferredConfig";` and in the existing `onDidChangeConfiguration` handler:

```typescript
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cucumberJump")) {
        invalidateAll();
        clearInference();
      }
    }),
```

- [ ] **Step 6: Verify**

Run: `npm run compile` — clean. Run: `npm test` — all suites green (nothing in this task is unit-tested, but nothing may break).

- [ ] **Step 7: Commit**

```bash
git add src/inferredConfig.ts src/config.ts src/resolver.ts src/extension.ts package.json
git commit -m "feat: inferred config — resolution falls back to scanned projects when no settings exist

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Onboarding commands + notifications — `onboarding.ts`

**Files:**
- Create: `src/onboarding.ts`
- Modify: `src/extension.ts` (call `registerOnboarding(context)` inside `activate`)
- Modify: `package.json` (two new commands)

**Interfaces:**
- Consumes: `scanWorkspace`, `primeInference`, `getInferredProposals`, `hasInferenceRun`, `clearInference` from Task 2; `readPackConfigs`, `autoConfigureEnabled`, `getWorkspaceFolderForUri`, `PackConfig` from config.ts; `isFeatureUri` from featureParser.ts; `parseStepLine` from featureParser.ts; `ScanProposal` from Task 1.
- Produces: commands `cucumberJump.createConfiguration` and `cucumberJump.rescanWorkspace`; `registerOnboarding(context: vscode.ExtensionContext): void`.

- [ ] **Step 1: Add the commands to `package.json`**

In `contributes.commands`, after the `showStepResolution` entry:

```json
{
  "command": "cucumberJump.createConfiguration",
  "title": "Cucumber Jump: Create configuration (scan workspace)"
},
{
  "command": "cucumberJump.rescanWorkspace",
  "title": "Cucumber Jump: Rescan workspace for step definitions"
},
```

- [ ] **Step 2: Create `src/onboarding.ts`**

```typescript
import * as vscode from "vscode";
import {
  autoConfigureEnabled,
  getWorkspaceFolderForUri,
  readPackConfigs,
  type PackConfig,
} from "./config";
import { isFeatureUri, parseStepLine } from "./featureParser";
import {
  clearInference,
  getInferredProposals,
  hasInferenceRun,
  primeInference,
  scanWorkspace,
} from "./inferredConfig";
import type { ScanProposal } from "./configScanner";

const DISMISSED_KEY = "cucumberJump.onboarding.dismissed";
const WALKTHROUGH_ID = "lntvan166.cucumber-jump-ext#cucumberJump.gettingStarted";
const offeredThisSession = new Set<string>();

function hasExplicitConfig(): boolean {
  const { projects, libraries } = readPackConfigs();
  return projects.length > 0 || libraries.length > 0;
}

function packsFromProposals(proposals: ScanProposal[]): PackConfig[] {
  return proposals.map((p) => ({ name: p.name, featureGlob: p.featureGlob, stepsGlob: p.stepsGlob }));
}

async function writeProjectsToSettings(folder: vscode.WorkspaceFolder, packs: PackConfig[]): Promise<void> {
  const config = vscode.workspace.getConfiguration("cucumberJump", folder.uri);
  const existing = config.get<PackConfig[]>("projects") ?? [];
  const existingGlobs = new Set(existing.map((p) => p.featureGlob));
  const additions = packs.filter((p) => !existingGlobs.has(p.featureGlob));
  if (additions.length === 0) {
    void vscode.window.showInformationMessage("Cucumber Jump: settings already cover these projects.");
    return;
  }
  try {
    await config.update("projects", [...existing, ...additions], vscode.ConfigurationTarget.Workspace);
    void vscode.window.showInformationMessage(
      `Cucumber Jump: saved ${additions.length} project(s) to .vscode/settings.json.`,
    );
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Cucumber Jump: could not write settings (${err}). Add this to .vscode/settings.json manually: ` +
        JSON.stringify({ "cucumberJump.projects": additions }),
    );
  }
}

/** Open the first feature the pack matches and jump, so the user sees it work. */
async function demonstrateJump(folder: vscode.WorkspaceFolder, pack: PackConfig): Promise<void> {
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, pack.featureGlob), "**/node_modules/**", 1);
  if (files.length === 0) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument(files[0]);
  const lines = doc.getText().split(/\r?\n/);
  const stepLine = lines.findIndex((l) => Boolean(parseStepLine(l)));
  if (stepLine === -1) {
    return;
  }
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const pos = new vscode.Position(stepLine, lines[stepLine].length);
  editor.selection = new vscode.Selection(pos, pos);
  await vscode.commands.executeCommand("cucumberJump.goToPrimaryStepTarget");
}

async function pickScanFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showInformationMessage("Cucumber Jump: open a folder first.");
    return undefined;
  }
  const active = vscode.window.activeTextEditor;
  if (active) {
    const f = getWorkspaceFolderForUri(active.document.uri);
    if (f) {
      return f;
    }
  }
  if (folders.length === 1) {
    return folders[0];
  }
  return vscode.window.showWorkspaceFolderPick({ placeHolder: "Scan which folder for Cucumber projects?" });
}

async function createConfiguration(): Promise<void> {
  const folder = await pickScanFolder();
  if (!folder) {
    return;
  }

  const proposals = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Cucumber Jump: scanning workspace…", cancellable: true },
    (_progress, token) => scanWorkspace(folder, token),
  );

  if (proposals.length === 0) {
    const pick = await vscode.window.showInformationMessage(
      "Cucumber Jump: no matching feature/step-definition pairs found. Insert a template to fill in?",
      "Insert template",
    );
    if (pick === "Insert template") {
      await writeProjectsToSettings(folder, [
        { name: "example", featureGlob: "path/to/features/**/*.feature", stepsGlob: "path/to/steps/**/*.ts" },
      ]);
      await vscode.commands.executeCommand("workbench.action.openWorkspaceSettingsFile");
    }
    return;
  }

  type Item = vscode.QuickPickItem & { proposal: ScanProposal };
  const items: Item[] = proposals.map((p) => ({
    label: `${p.name} (${p.language})`,
    description: `${p.matchedSteps}/${p.totalSteps} steps matched`,
    detail: `${p.featureGlob} → ${p.stepsGlob}`,
    picked: true,
    proposal: p,
  }));
  const chosen = await vscode.window.showQuickPick(items, {
    title: "Cucumber Jump · detected projects",
    placeHolder: "These will be written to .vscode/settings.json",
    canPickMany: true,
  });
  if (!chosen || chosen.length === 0) {
    return;
  }

  const packs = packsFromProposals(chosen.map((c) => c.proposal));
  await writeProjectsToSettings(folder, packs);
  clearInference();
  await demonstrateJump(folder, packs[0]);
}

async function rescanWorkspace(): Promise<void> {
  const folder = await pickScanFolder();
  if (!folder) {
    return;
  }
  clearInference();
  if (hasExplicitConfig()) {
    void vscode.window.showInformationMessage(
      "Cucumber Jump: explicit settings are configured — they take precedence. Use 'Create configuration' to add detected projects.",
    );
    return;
  }
  const proposals = await primeInference(folder);
  void vscode.window.showInformationMessage(
    `Cucumber Jump: rescan found ${proposals.length} project(s). Navigation uses them automatically.`,
  );
}

async function maybeOfferSetup(context: vscode.ExtensionContext, doc: vscode.TextDocument): Promise<void> {
  if (!isFeatureUri(doc.uri) || !autoConfigureEnabled() || hasExplicitConfig()) {
    return;
  }
  const folder = getWorkspaceFolderForUri(doc.uri);
  if (!folder) {
    return;
  }

  const alreadyRan = hasInferenceRun(folder);
  const proposals = alreadyRan ? getInferredProposals(folder) : await primeInference(folder);

  if (context.workspaceState.get<boolean>(DISMISSED_KEY) || offeredThisSession.has(folder.uri.toString())) {
    return;
  }
  offeredThisSession.add(folder.uri.toString());

  if (proposals.length > 0) {
    const pick = await vscode.window.showInformationMessage(
      `Cucumber Jump configured itself — ${proposals.length} project(s) detected. F12 on a step already works.`,
      "Save to settings",
      "Adjust…",
      "Don't ask again",
    );
    if (pick === "Save to settings") {
      await writeProjectsToSettings(folder, packsFromProposals(proposals));
    } else if (pick === "Adjust…") {
      await vscode.commands.executeCommand("cucumberJump.createConfiguration");
    } else if (pick === "Don't ask again") {
      await context.workspaceState.update(DISMISSED_KEY, true);
    }
  } else {
    const pick = await vscode.window.showInformationMessage(
      "Cucumber Jump couldn't detect step definitions for this workspace.",
      "Set up manually",
      "Open walkthrough",
      "Don't ask again",
    );
    if (pick === "Set up manually") {
      await vscode.commands.executeCommand("cucumberJump.createConfiguration");
    } else if (pick === "Open walkthrough") {
      await vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH_ID);
    } else if (pick === "Don't ask again") {
      await context.workspaceState.update(DISMISSED_KEY, true);
    }
  }
}

export function registerOnboarding(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cucumberJump.createConfiguration", () => void createConfiguration()),
    vscode.commands.registerCommand("cucumberJump.rescanWorkspace", () => void rescanWorkspace()),
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (e) {
        void maybeOfferSetup(context, e.document);
      }
    }),
  );

  if (vscode.window.activeTextEditor) {
    void maybeOfferSetup(context, vscode.window.activeTextEditor.document);
  }
}
```

- [ ] **Step 3: Register in `extension.ts`**

Add import `import { registerOnboarding } from "./onboarding";` and call `registerOnboarding(context);` inside `activate` next to the other `register*` calls (`registerDevMode(context)` / `registerStepUi(context)` — match the existing pattern at the top of `activate`).

- [ ] **Step 4: Verify**

`npm run compile` — clean. `npm test` — green.
Manual spot check (Extension Development Host): open `~/cucumber-jump-manual-test` seeded with `--no-config` (Task 6 adds the flag — until then, temporarily delete `.vscode/settings.json` in a copy), open a `.feature`, confirm F12 works and the toast appears once.

- [ ] **Step 5: Commit**

```bash
git add src/onboarding.ts src/extension.ts package.json
git commit -m "feat: Create-configuration command, rescan command, one-time zero-setup toast

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Get-Started walkthrough

**Files:**
- Modify: `package.json` (`contributes.walkthroughs`)
- Create: `media/walkthrough/setup.md`, `media/walkthrough/jump.md`, `media/walkthrough/extras.md`

**Interfaces:**
- Consumes: commands `cucumberJump.createConfiguration` (Task 3) and `cucumberJump.goToPrimaryStepTarget` (existing). Walkthrough id `cucumberJump.gettingStarted` is what Task 3's `WALKTHROUGH_ID` references — do not rename.

- [ ] **Step 1: Add the contribution to `package.json`**

Inside `contributes`, after `"menus"`:

```json
"walkthroughs": [
  {
    "id": "cucumberJump.gettingStarted",
    "title": "Get started with Cucumber Jump",
    "description": "Jump between Gherkin steps and step definitions in three steps.",
    "steps": [
      {
        "id": "setup",
        "title": "Set up navigation",
        "description": "Scan the workspace and detect your feature/step-definition projects — or let zero-setup inference do it automatically the first time you open a .feature file.\n[Create configuration](command:cucumberJump.createConfiguration)",
        "media": { "markdown": "media/walkthrough/setup.md" },
        "completionEvents": ["onCommand:cucumberJump.createConfiguration"]
      },
      {
        "id": "jump",
        "title": "Try a jump",
        "description": "Open a .feature file, put the cursor on a Given/When/Then line, and press F12.",
        "media": { "markdown": "media/walkthrough/jump.md" },
        "completionEvents": ["onCommand:cucumberJump.goToPrimaryStepTarget"]
      },
      {
        "id": "extras",
        "title": "Optional extras",
        "description": "Dev mode pairs code and feature side by side; CodeLens and the status-bar hint show resolution inline.\n[Open settings](command:workbench.action.openSettings?%22cucumberJump%22)",
        "media": { "markdown": "media/walkthrough/extras.md" },
        "completionEvents": ["onSettingChanged:cucumberJump.codeLensEnabled", "onCommand:cucumberJump.toggleDevMode"]
      }
    ]
  }
]
```

- [ ] **Step 2: Write the three markdown files**

`media/walkthrough/setup.md`:

```markdown
# Set up navigation

Cucumber Jump connects `.feature` files to step definitions in **Java, Kotlin,
Python, JavaScript, TypeScript, Ruby, C#, Dart, and Go**.

**Zero setup:** open any `.feature` file — the extension scans the workspace
and starts navigating automatically when it can match your steps to
definitions.

**Explicit setup:** run **Cucumber Jump: Create configuration** from the
command palette. It shows the detected projects with evidence
(`23/31 steps matched`) and writes the ones you confirm to
`.vscode/settings.json`.

If detection finds nothing, the command inserts a template — fill in
`featureGlob` and `stepsGlob` (the file extension of `stepsGlob` selects the
language).
```

`media/walkthrough/jump.md`:

```markdown
# Try a jump

1. Open a `.feature` file.
2. Put the cursor on a step line (`Given …`, `When …`, `Then …`).
3. Press **F12** — you land on the step definition.

From a step definition, **F12** goes the other way: it lists every feature
line that uses it.

If a jump does not work, run **Cucumber Jump: Show step resolution** — it
prints exactly which projects, globs, and files were tried.
```

`media/walkthrough/extras.md`:

```markdown
# Optional extras

- **Dev mode** — click the Cucumber icon on a `.feature` editor tab: code on
  the left, feature on the right, both panes follow your cursor.
- **CodeLens** — `cucumberJump.codeLensEnabled` shows an *Implementation*
  link above every step line.
- **Status-bar hint** — `cucumberJump.statusBarHintEnabled` shows where the
  current step resolves.
```

- [ ] **Step 3: Verify**

`npm run compile` — clean (package.json is schema-validated at package time; also run `npx vsce ls > /dev/null` which validates the manifest and must exit 0).
Manual: in the Extension Development Host, run "Welcome: Open Walkthrough…" → "Get started with Cucumber Jump" appears with three steps.

- [ ] **Step 4: Commit**

```bash
git add package.json media/walkthrough/
git commit -m "feat: add Get Started walkthrough (setup, jump, extras)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: GitHub Actions CI + README badge

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md` (badge under the title)

**Interfaces:** none consumed/produced; the workflow runs `npm ci`, `npm test`, `npm run compile`.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run compile
```

- [ ] **Step 2: Add the badge to `README.md`**

Directly under the top-level `# Cucumber Jump` heading line, add:

```markdown
[![CI](https://github.com/lntvan166/cucumber-jump-ext/actions/workflows/ci.yml/badge.svg)](https://github.com/lntvan166/cucumber-jump-ext/actions/workflows/ci.yml)
```

- [ ] **Step 3: Verify locally**

Run exactly what CI will run: `npm ci && npm test && npm run compile` — all green. (`npm ci` wipes node_modules; if the local install used `--allow-scripts` prompts, rerun `npm install` afterwards if needed.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: run tests and compile on push/PR via GitHub Actions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

After the branch is pushed, confirm the workflow runs: `gh run list --workflow=ci.yml --limit 1` shows a run with status `completed`/`success`.

---

### Task 6: Manual-test seed `--no-config` + TESTPLAN rows + CHANGELOG

**Files:**
- Modify: `manual-test-seed.py`

**Interfaces:** consumes nothing from other tasks at code level; the TESTPLAN rows reference the Task 2–4 behaviors by their user-visible names.

- [ ] **Step 1: Add the `--no-config` flag**

In `manual-test-seed.py`: the docstring usage block gains
`python3 manual-test-seed.py --no-config      # seed WITHOUT cucumberJump.projects (zero-setup testing)`.
Below the `CLEAN = "--clean" in argv` line add:

```python
NO_CONFIG = "--no-config" in argv
```

(and exclude it from positional-arg detection: change `pos = [a for a in argv if not a.startswith("--")]` — already correct since the flag starts with `--`).

In `main()`, replace the settings write with:

```python
    os.makedirs(os.path.join(WS, ".vscode"), exist_ok=True)
    settings = dict(SETTINGS)
    if NO_CONFIG:
        settings.pop("cucumberJump.projects", None)
    with open(os.path.join(WS, ".vscode", "settings.json"), "w") as f:
        json.dump(settings, f, indent=2)
```

and add to the summary print: `print(f"  - cucumberJump.projects: {'OMITTED (zero-setup mode)' if NO_CONFIG else '11 projects'}")`.

- [ ] **Step 2: Add zero-setup rows to the TESTPLAN string**

Append to the `TESTPLAN` string, before the final "Clean up afterwards" line:

```markdown
## Zero-setup (seed with `python3 manual-test-seed.py --no-config`)

| # | Action | Expect |
|---|---|---|
| 29 | Open java/features/orders.feature, wait ~2s, F12 on `I have 3 orders` | jumps to OrderSteps.java with NO configuration present |
| 30 | Same session | one toast: "Cucumber Jump configured itself — N project(s) detected" with Save / Adjust… / Don't ask again |
| 31 | Toast → "Save to settings" | .vscode/settings.json gains cucumberJump.projects matching the seeded layout (go-legacy is NOT detected — bddFile inference is out of scope) |
| 32 | Command "Create configuration (scan workspace)" (fresh --no-config seed) | quick-pick lists detected projects with `matched X/Y steps` evidence, all pre-checked; confirming writes settings and demonstrates a jump |
| 33 | Command "Rescan workspace for step definitions" | reruns inference and reports the project count |
| 34 | "Show step resolution" on a zero-setup jump | pack line ends with `(inferred — not saved to settings)` |
| 35 | Set `cucumberJump.autoConfigure: false` (fresh --no-config seed) | no inference, no toast; F12 does nothing (as before 2.1.0) |
| 36 | "Welcome: Open Walkthrough…" → Get started with Cucumber Jump | three steps render; Create configuration button works |
```

- [ ] **Step 3: Add the CHANGELOG entry**

At the top of `CHANGELOG.md` (below the format preamble, above `## [2.0.0]`):

```markdown
## [Unreleased]

### Added

- **Zero-setup navigation** — with no `cucumberJump` configuration, opening a `.feature` file triggers a one-time background scan that matches your Gherkin steps against step definitions (all 9 languages) and navigation just works. A single toast offers to save the detected projects to settings. Disable with `cucumberJump.autoConfigure: false`.
- **`Cucumber Jump: Create configuration (scan workspace)`** — detects projects with match evidence, shows them for confirmation, writes `.vscode/settings.json`, then demonstrates a live jump. Falls back to a template when nothing is detected.
- **`Cucumber Jump: Rescan workspace for step definitions`** command.
- **Get Started walkthrough** (three steps: set up, jump, extras).
- **GitHub Actions CI** — tests + compile on every push/PR.
- `Show step resolution` labels inferred packs with `(inferred — not saved to settings)`.
```

- [ ] **Step 4: Verify**

Run: `python3 manual-test-seed.py --no-config` → prints `cucumberJump.projects: OMITTED (zero-setup mode)`; `python3 -c "import json; s=json.load(open('$HOME/cucumber-jump-manual-test/.vscode/settings.json')); assert 'cucumberJump.projects' not in s; print('OK')"` prints OK. Re-seed without the flag and assert the key IS present. `npm test` still green.

- [ ] **Step 5: Commit**

```bash
git add manual-test-seed.py CHANGELOG.md
git commit -m "test: --no-config seed mode + zero-setup TESTPLAN rows; changelog for 2.1.0 features

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end verification pass

**Files:** none created — this is the integration gate before review/merge.

- [ ] **Step 1: Full automated pass**

Run: `npm test` (expect every suite green, including the new `configScanner` tests) and `npm run compile` (clean).

- [ ] **Step 2: Manual zero-setup pass**

`python3 manual-test-seed.py --no-config`, launch the Extension Development Host on `~/cucumber-jump-manual-test`, walk TESTPLAN rows 29–36. Every row must pass; anything that fails becomes a fix commit before proceeding.

- [ ] **Step 3: Manual regression spot-check**

Re-seed with config (`python3 manual-test-seed.py`) and re-check TESTPLAN rows 1, 6, 16, 25 (legacy Go, Java escape, C# verbatim, Dev mode from Java) to prove explicit-config behavior is untouched.

- [ ] **Step 4: Request code review**

Use superpowers:requesting-code-review with BASE_SHA = the commit before Task 1 and HEAD_SHA = current, spec + this plan as requirements. Fix Critical/Important findings before merge.
