import { StepDefinition, LanguageAdapter } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';
import { regexMatchesRawStep } from '../bddParser';

const STEP_REGEX = /\.Step\s*\(\s*(?:`([^`]*)`|"([^"]*)")\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*|func\b)/;

export function parseGoStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(STEP_REGEX);
    if (!match) {
      continue;
    }

    const pattern = match[1] ?? match[2];
    const handler = match[3];

    // Find positions of the quote characters
    let quoteChar: string;
    let quoteIdx: number;
    if (match[1] !== undefined) {
      quoteChar = '`';
      quoteIdx = line.indexOf('`');
    } else {
      quoteChar = '"';
      quoteIdx = line.indexOf('"');
    }
    const patternStartCol = quoteIdx;
    const patternEndCol = line.indexOf(quoteChar, quoteIdx + 1);

    const def: StepDefinition = {
      pattern,
      patternLine: i,
      patternStartCol,
      patternEndCol,
    };

    if (handler === 'func') {
      def.implLine = i;
    } else {
      def.implFunctionName = handler;
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
  return regexMatchesRawStep(pattern, rawStep);
}

export const goAdapter: LanguageAdapter = {
  parseStepDefinitions: parseGoStepDefinitions,
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean {
    return stepMatches(def.pattern, rawStep, normalizedStep);
  },
};
