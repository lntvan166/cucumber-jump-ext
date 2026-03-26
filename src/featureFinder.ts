import * as vscode from "vscode";
import { regexMatchesRawStep } from "./bddParser";
import { normalizeStepText, parseStepLine } from "./featureParser";

function stepLineMatches(
  stepBody: string,
  normalizedTarget: string,
  goRegexPattern: string | undefined,
): boolean {
  if (normalizeStepText(stepBody) === normalizedTarget) {
    return true;
  }

  if (goRegexPattern && regexMatchesRawStep(goRegexPattern, stepBody)) {
    return true;
  }

  return false;
}

export async function findFeatureUsages(
  folder: vscode.WorkspaceFolder,
  featureGlobs: string[],
  canonicalStepText: string,
  goRegexPattern: string | undefined,
  token: vscode.CancellationToken,
): Promise<vscode.Location[]> {
  const normalizedTarget = normalizeStepText(canonicalStepText);
  const locations: vscode.Location[] = [];
  const seen = new Set<string>();

  for (const glob of featureGlobs) {
    if (token.isCancellationRequested) {
      break;
    }

    const pattern = new vscode.RelativePattern(folder, glob);
    const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 200, token);

    for (const file of files) {
      if (token.isCancellationRequested) {
        break;
      }

      const doc = await vscode.workspace.openTextDocument(file);
      const lineCount = doc.lineCount;

      for (let i = 0; i < lineCount; i++) {
        const lineText = doc.lineAt(i).text;
        const stepBody = parseStepLine(lineText);
        if (!stepBody) {
          continue;
        }

        if (!stepLineMatches(stepBody, normalizedTarget, goRegexPattern)) {
          continue;
        }

        const key = `${file.toString()}:${i}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        const trimmed = lineText.trimStart();
        const kwMatch = trimmed.match(/^(Given|When|Then|And|But)\s+/);
        const kwLen = kwMatch ? kwMatch[0].length : 0;
        const leadingWs = lineText.length - trimmed.length;
        const bodyStart = leadingWs + kwLen;
        const bodyEnd = lineText.length;
        const start = new vscode.Position(i, bodyStart);
        const end = new vscode.Position(i, bodyEnd);
        locations.push(new vscode.Location(file, new vscode.Range(start, end)));
      }
    }
  }

  return locations;
}
