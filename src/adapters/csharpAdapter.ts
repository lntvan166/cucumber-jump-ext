import { StepDefinition, LanguageAdapter } from '../languageAdapter';
import { defaultStepMatches, defaultReverseRegex, unescapeStringLiteral } from './stepMatch';
import { inferPattern, deriveIdentifierWords, toUpperCamel, type StubParamType } from '../stepStubber';

// Group 2: verbatim prefix (@" / $@" / @$"), group 3: verbatim content ("" = escaped quote)
// Group 4: regular string content (backslash escapes)
const ATTRIBUTE_REGEX = /^\s*\[\s*(Given|When|Then|And|But|StepDefinition)\s*\(\s*(?:(@\$?|\$@)"((?:[^"]|"")*)"|\$?"((?:[^"\\]|\\.)*)")\s*\)\s*\]/;
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

    const pattern =
      match[3] !== undefined
        ? match[3].replace(/""/g, '"')
        : unescapeStringLiteral(match[4]);

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

export const csharpAdapter: LanguageAdapter = {
  parseStepDefinitions: parseCsharpStepDefinitions,
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean {
    return defaultStepMatches(def.pattern, rawStep, normalizedStep);
  },
  reverseRegexForPattern: defaultReverseRegex,
  stubTemplate: {
    isClassBased: true,
    render({ keyword, stepBody }) {
      const { cucumber, paramTypes } = inferPattern(stepBody);
      const name = toUpperCamel(deriveIdentifierWords(stepBody));
      const pattern = cucumber.replace(/"/g, '\\"');
      const csType = (t: StubParamType) => (t === 'string' ? 'string' : t === 'int' ? 'int' : 'double');
      const params = paramTypes.map((t, i) => `${csType(t)} arg${i + 1}`).join(', ');
      return [
        `[${keyword}("${pattern}")]`,
        `public void ${name}(${params})`,
        '{',
        '    throw new NotImplementedException();',
        '}',
      ].join('\n');
    },
  },
};
