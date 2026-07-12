import { StepDefinition, LanguageAdapter } from '../languageAdapter';
import { defaultStepMatches, defaultReverseRegex, unescapeStringLiteral } from './stepMatch';
import { inferPattern, type StubParamType } from '../stepStubber';

const STRING_STEP_REGEX = /^\s*(Given|When|Then|And|But)\s*\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/;
const REGEX_STEP_REGEX = /^\s*(Given|When|Then|And|But)\s*\(\s*\/([^/]+)\//;

export function parseJsStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try string form first
    const stringMatch = line.match(STRING_STEP_REGEX);
    if (stringMatch) {
      const pattern = unescapeStringLiteral(stringMatch[2] ?? stringMatch[3] ?? stringMatch[4]);

      // Determine quote character and positions
      let quoteChar: string;
      if (stringMatch[2] !== undefined) {
        quoteChar = "'";
      } else if (stringMatch[3] !== undefined) {
        quoteChar = '"';
      } else {
        quoteChar = '`';
      }

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

export const jsAdapter: LanguageAdapter = {
  parseStepDefinitions: parseJsStepDefinitions,
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean {
    return defaultStepMatches(def.pattern, rawStep, normalizedStep);
  },
  reverseRegexForPattern: defaultReverseRegex,
  stubTemplate: {
    isClassBased: false,
    render({ keyword, stepBody, ext }) {
      const { cucumber, paramTypes } = inferPattern(stepBody);
      const pattern = cucumber.replace(/'/g, "\\'");
      const isTs = ext === 'ts' || ext === 'tsx';
      const tsType = (t: StubParamType) => (t === 'string' ? 'string' : 'number');
      const args = paramTypes.map((t, i) => (isTs ? `arg${i + 1}: ${tsType(t)}` : `arg${i + 1}`)).join(', ');
      return [
        `${keyword}('${pattern}', function (${args}) {`,
        "  return 'pending';",
        '});',
      ].join('\n');
    },
  },
};
