import { StepDefinition, LanguageAdapter } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

const ATTRIBUTE_REGEX = /^\s*\[\s*(Given|When|Then|And|But|StepDefinition)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*\]/;
const METHOD_REGEX = /(?:public|private|protected|internal|static|\s)+\w+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

export function parseCsharpStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(ATTRIBUTE_REGEX);
    if (!match) {
      continue;
    }

    const pattern = match[2];

    const firstQuote = line.indexOf('"');
    const lastQuote = line.lastIndexOf('"');

    const def: StepDefinition = {
      pattern,
      patternLine: i,
      patternStartCol: firstQuote,
      patternEndCol: lastQuote,
    };

    // Look ahead up to 5 lines for a method declaration
    for (let j = i + 1; j <= Math.min(i + 5, lines.length - 1); j++) {
      const methodMatch = lines[j].match(METHOD_REGEX);
      if (methodMatch) {
        def.implLine = j;
        def.implFunctionName = methodMatch[1];
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
  try {
    return new RegExp(pattern).test(rawStep.trim());
  } catch {
    return false;
  }
}

export const csharpAdapter: LanguageAdapter = {
  parseStepDefinitions: parseCsharpStepDefinitions,
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean {
    return stepMatches(def.pattern, rawStep, normalizedStep);
  },
};
