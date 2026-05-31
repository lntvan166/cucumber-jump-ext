import { StepDefinition, LanguageAdapter } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

const STEP_REGEX = /^\s*(given\d*|when\d*|then\d*|and\d*|but\d*)\s*(?:<[^>]*>)?\s*\(\s*(?:'([^']*)'|"([^"]*)")/i;

export function parseDartStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(STEP_REGEX);
    if (!match) {
      continue;
    }

    const pattern = match[2] ?? match[3];

    const quoteChar = match[2] !== undefined ? "'" : '"';
    const firstQuote = line.indexOf(quoteChar);
    const lastQuote = line.lastIndexOf(quoteChar);

    const def: StepDefinition = {
      pattern,
      patternLine: i,
      patternStartCol: firstQuote,
      patternEndCol: lastQuote,
      implLine: i,
    };

    defs.push(def);
  }

  for (let i = 0; i < defs.length; i++) {
    defs[i].bodyEndLine = i + 1 < defs.length ? defs[i + 1].patternLine - 1 : lines.length - 1;
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
  // If pattern is already anchored with ^ or $, treat as intentional regex
  if (pattern.startsWith('^') || pattern.endsWith('$')) {
    try { return new RegExp(pattern).test(rawStep.trim()); } catch { return false; }
  }
  // Otherwise treat as a literal string — escape special chars and anchor it
  const escaped = pattern.replace(/[.*+?^$|{}[\]\\()]/g, '\\$&');
  try { return new RegExp(`^${escaped}$`, 'i').test(rawStep.trim()); } catch { return false; }
}

export const dartAdapter: LanguageAdapter = {
  parseStepDefinitions: parseDartStepDefinitions,
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean {
    return stepMatches(def.pattern, rawStep, normalizedStep);
  },
};
