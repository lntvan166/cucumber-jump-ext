import { StepDefinition, LanguageAdapter } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

const DECORATOR_REGEX = /^\s*@(given|when|then|step)\s*\(\s*(?:'([^']*)'|"([^"]*)")\s*\)/i;
const DEF_REGEX = /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

export function parsePythonStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(DECORATOR_REGEX);
    if (!match) {
      continue;
    }

    const pattern = match[2] ?? match[3];

    // Find positions of the quote characters
    const isDouble = match[2] === undefined;
    const quoteChar = isDouble ? '"' : "'";
    const firstQuote = line.indexOf(quoteChar);
    const lastQuote = line.lastIndexOf(quoteChar);

    const def: StepDefinition = {
      pattern,
      patternLine: i,
      patternStartCol: firstQuote,
      patternEndCol: lastQuote,
    };

    // Look ahead up to 4 lines for a def statement
    for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j++) {
      const defMatch = lines[j].match(DEF_REGEX);
      if (defMatch) {
        def.implLine = j;
        def.implFunctionName = defMatch[1];
        break;
      }
    }

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

export const pythonAdapter: LanguageAdapter = {
  parseStepDefinitions: parsePythonStepDefinitions,
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean {
    return stepMatches(def.pattern, rawStep, normalizedStep);
  },
};
