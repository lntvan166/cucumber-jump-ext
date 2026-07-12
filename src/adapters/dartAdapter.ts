import { StepDefinition, LanguageAdapter } from '../languageAdapter';
import { defaultStepMatches, defaultReverseRegex, unescapeStringLiteral } from './stepMatch';
import { inferPattern, deriveIdentifierWords, toLowerCamel, type StubParamType } from '../stepStubber';

const STEP_REGEX = /^\s*(given\d*|when\d*|then\d*|and\d*|but\d*)\s*(?:<[^>]*>)?\s*\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/i;

export function parseDartStepDefinitions(content: string): StepDefinition[] {
  const lines = content.split(/\r?\n/);
  const defs: StepDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(STEP_REGEX);
    if (!match) {
      continue;
    }

    const pattern = unescapeStringLiteral(match[2] ?? match[3]);

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

export const dartAdapter: LanguageAdapter = {
  parseStepDefinitions: parseDartStepDefinitions,
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean {
    return defaultStepMatches(def.pattern, rawStep, normalizedStep);
  },
  reverseRegexForPattern: defaultReverseRegex,
  stubTemplate: {
    isClassBased: false,
    render({ keyword, stepBody }) {
      const { cucumber, paramTypes } = inferPattern(stepBody);
      const name = toLowerCamel(deriveIdentifierWords(stepBody));
      const pattern = cucumber.replace(/'/g, "\\'");
      const n = paramTypes.length;
      const suffix = n > 0 ? String(n) : '';
      const dartType = (t: StubParamType) => (t === 'string' ? 'String' : t === 'int' ? 'int' : 'double');
      const generics = [...paramTypes.map(dartType), 'World'].join(', ');
      const cbArgs = [...paramTypes.map((_, i) => `arg${i + 1}`), 'context'].join(', ');
      return [
        `StepDefinitionGeneric ${name}() {`,
        `  return ${keyword.toLowerCase()}${suffix}<${generics}>(`,
        `    '${pattern}',`,
        `    (${cbArgs}) async {`,
        '      throw UnimplementedError();',
        '    },',
        '  );',
        '}',
      ].join('\n');
    },
  },
};
