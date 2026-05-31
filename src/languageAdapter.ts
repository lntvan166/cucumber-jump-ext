export type StepDefinition = {
  pattern: string;
  patternLine: number;
  patternStartCol: number;
  patternEndCol: number;
  implFunctionName?: string;
  implLine?: number;
  bodyEndLine?: number;
};

export interface LanguageAdapter {
  parseStepDefinitions(content: string): StepDefinition[];
  matchesStep(def: StepDefinition, rawStep: string, normalizedStep: string): boolean;
}

export function findDefinitionAtPosition(
  defs: StepDefinition[],
  line: number,
): StepDefinition | undefined {
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const rangeStart = def.patternLine;
    const rangeEnd =
      def.bodyEndLine !== undefined
        ? def.bodyEndLine
        : i + 1 < defs.length
          ? defs[i + 1].patternLine - 1
          : Infinity;
    if (line >= rangeStart && line <= rangeEnd) {
      return def;
    }
  }
  return undefined;
}
