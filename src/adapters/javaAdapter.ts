import { StepDefinition, LanguageAdapter } from '../languageAdapter';
import { defaultStepMatches, defaultReverseRegex, unescapeStringLiteral } from './stepMatch';
import { inferPattern, deriveIdentifierWords, toSnake, type StubParamType } from '../stepStubber';

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

    const pattern = unescapeStringLiteral(match[2]);

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

export const javaAdapter: LanguageAdapter = {
  parseStepDefinitions: parseJavaStepDefinitions,
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean {
    return defaultStepMatches(def.pattern, rawStep, normalizedStep);
  },
  reverseRegexForPattern: defaultReverseRegex,
  stubTemplate: {
    isClassBased: true,
    render({ keyword, stepBody, ext }) {
      const { cucumber, paramTypes } = inferPattern(stepBody);
      const name = toSnake(deriveIdentifierWords(stepBody));
      const pattern = cucumber.replace(/"/g, '\\"');
      const annotation = `@${keyword}("${pattern}")`;
      const isKotlin = ext === 'kt' || ext === 'kts';
      if (isKotlin) {
        const ktType = (t: StubParamType) => (t === 'string' ? 'String' : t === 'int' ? 'Int' : 'Float');
        const params = paramTypes.map((t, i) => `arg${i + 1}: ${ktType(t)}`).join(', ');
        return [
          annotation,
          `fun ${name}(${params}) {`,
          '    throw io.cucumber.java.PendingException()',
          '}',
        ].join('\n');
      }
      const javaType = (t: StubParamType) => (t === 'string' ? 'String' : t === 'int' ? 'int' : 'float');
      const params = paramTypes.map((t, i) => `${javaType(t)} arg${i + 1}`).join(', ');
      return [
        annotation,
        `public void ${name}(${params}) {`,
        '    throw new io.cucumber.java.PendingException();',
        '}',
      ].join('\n');
    },
  },
};
