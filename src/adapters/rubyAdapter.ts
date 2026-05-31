import { StepDefinition, LanguageAdapter } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

const STRING_STEP_REGEX = /^\s*(Given|When|Then|And|But)\s*\(\s*(?:'([^']*)'|"([^"]*)")\s*\)/;
const REGEX_STEP_REGEX = /^\s*(Given|When|Then|And|But)\s*\(\s*\/([^/]+)\//;

export function parseRubyStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try string form first
    const stringMatch = line.match(STRING_STEP_REGEX);
    if (stringMatch) {
      const pattern = stringMatch[2] ?? stringMatch[3];

      const quoteChar = stringMatch[2] !== undefined ? "'" : '"';
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
      continue;
    }

    // Try regex form
    const regexMatch = line.match(REGEX_STEP_REGEX);
    if (regexMatch) {
      const pattern = regexMatch[2];

      const slashIdx = line.indexOf('/');
      const endSlash = line.indexOf('/', slashIdx + 1);

      const def: StepDefinition = {
        pattern,
        patternLine: i,
        patternStartCol: slashIdx,
        patternEndCol: endSlash,
        implLine: i,
      };

      defs.push(def);
    }
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

export const rubyAdapter: LanguageAdapter = {
  parseStepDefinitions: parseRubyStepDefinitions,
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean {
    return stepMatches(def.pattern, rawStep, normalizedStep);
  },
};
