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
    const key = `${root}|${language}`;
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
      const k = `${p.featureGlob}|${p.stepsGlob}`;
      if (seen.has(k)) {
        return false;
      }
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.featureGlob.localeCompare(b.featureGlob));
}
