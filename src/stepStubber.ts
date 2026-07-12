export type StubParamType = 'string' | 'int' | 'float';

export interface InferredPattern {
  cucumber: string;
  goRegex: string;
  paramTypes: StubParamType[];
}

// A double-quoted literal, a decimal, or an integer — matched left to right.
const TOKEN_RE = /"(?:[^"\\]|\\.)*"|\d+\.\d+|\d+/g;

// Cucumber Expression special characters that must be backslash-escaped in literal text.
function escapeCucumberLiteral(text: string): string {
  return text.replace(/[\\(){}/]/g, '\\$&');
}

function escapeGoRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function inferPattern(stepBody: string): InferredPattern {
  const paramTypes: StubParamType[] = [];
  let cucumber = '';
  let goRegex = '';
  let last = 0;

  for (const m of stepBody.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    const literal = stepBody.slice(last, idx);
    cucumber += escapeCucumberLiteral(literal);
    goRegex += escapeGoRegexLiteral(literal);

    const tok = m[0];
    if (tok.startsWith('"')) {
      paramTypes.push('string');
      cucumber += '{string}';
      goRegex += '"([^"]*)"';
    } else if (tok.includes('.')) {
      paramTypes.push('float');
      cucumber += '{float}';
      goRegex += '([\\d.]+)';
    } else {
      paramTypes.push('int');
      cucumber += '{int}';
      goRegex += '(\\d+)';
    }
    last = idx + tok.length;
  }

  const tail = stepBody.slice(last);
  cucumber += escapeCucumberLiteral(tail);
  goRegex += escapeGoRegexLiteral(tail);

  return { cucumber, goRegex: `^${goRegex}$`, paramTypes };
}

export function deriveIdentifierWords(stepBody: string): string[] {
  const words = stepBody
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ') // drop quoted literals
    .replace(/\d+\.\d+|\d+/g, ' ')      // drop numeric literals
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  return words.length > 0 ? words : ['step'];
}

export function toSnake(words: string[]): string {
  return words.join('_');
}

export function toLowerCamel(words: string[]): string {
  return words
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

export function toUpperCamel(words: string[]): string {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
