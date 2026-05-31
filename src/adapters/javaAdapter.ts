import { StepDefinition, LanguageAdapter } from '../languageAdapter';
import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

const ANNOTATION_REGEX = /^\s*@(Given|When|Then|And|But)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/;
const METHOD_REGEX = /(?:public|private|protected|override\s+)*(?:void|fun|\w+)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

export function parseJavaStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(ANNOTATION_REGEX);
    if (!match) {
      continue;
    }

    const pattern = match[2];

    // Find positions of the first and last " on the annotation line
    const firstQuote = line.indexOf('"');
    const lastQuote = line.lastIndexOf('"');

    const def: StepDefinition = {
      pattern,
      patternLine: i,
      patternStartCol: firstQuote,
      patternEndCol: lastQuote,
    };

    // Look ahead up to 10 lines for a method declaration
    for (let j = i + 1; j <= Math.min(i + 10, lines.length - 1); j++) {
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
  // If pattern is already anchored with ^ or $, treat as intentional regex
  if (pattern.startsWith('^') || pattern.endsWith('$')) {
    try { return new RegExp(pattern).test(rawStep.trim()); } catch { return false; }
  }
  // Otherwise treat as a literal string — escape special chars and anchor it
  const escaped = pattern.replace(/[.*+?^$|{}[\]\\()]/g, '\\$&');
  try { return new RegExp(`^${escaped}$`, 'i').test(rawStep.trim()); } catch { return false; }
}

export const javaAdapter: LanguageAdapter = {
  parseStepDefinitions: parseJavaStepDefinitions,
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean {
    return stepMatches(def.pattern, rawStep, normalizedStep);
  },
};
