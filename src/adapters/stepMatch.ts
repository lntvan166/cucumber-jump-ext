import { normalizeStepText } from '../featureParser';
import { isCucumberExpression, cucumberExpressionToRegex } from './cucumberExpression';

/**
 * Unescapes backslash escapes that quote characters need inside a source string
 * literal (\\ → \, \" → ", \' → ', \` → `). Other sequences like \d are left
 * intact — they are regex escapes, not string escapes, in the languages we parse.
 */
export function unescapeStringLiteral(raw: string): string {
  return raw.replace(/\\(.)/g, (whole, ch) =>
    ch === '\\' || ch === '"' || ch === "'" || ch === '`' ? ch : whole,
  );
}

/**
 * Shared matchesStep logic for adapters whose unanchored patterns are literals
 * (all languages except Go, where every pattern is a regex):
 * 1. normalized text equality
 * 2. Cucumber Expression
 * 3. anchored (^/$) patterns as regex; everything else as an anchored literal
 */
export function defaultStepMatches(pattern: string, rawStep: string, normalizedStep: string): boolean {
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
  if (pattern.startsWith('^') || pattern.endsWith('$')) {
    try { return new RegExp(pattern).test(rawStep.trim()); } catch { return false; }
  }
  const escaped = pattern.replace(/[.*+?^$|{}[\]\\()]/g, '\\$&');
  try { return new RegExp(`^${escaped}$`, 'i').test(rawStep.trim()); } catch { return false; }
}

/**
 * Regex to hand to reverse navigation (feature-usage search) for a pattern.
 * Plain literals return undefined — normalized equality in the feature finder
 * already covers them, and running them as an unanchored regex would produce
 * substring false positives.
 */
export function defaultReverseRegex(pattern: string): string | undefined {
  if (isCucumberExpression(pattern)) {
    try {
      return cucumberExpressionToRegex(pattern).source;
    } catch {
      return undefined;
    }
  }
  if (pattern.startsWith('^') || pattern.endsWith('$')) {
    return pattern;
  }
  return undefined;
}
