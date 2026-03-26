import * as vscode from "vscode";
import type { ResolutionEntry } from "./config";
import {
  concretePathFromFeatureAndGlobPattern,
  concretePathFromStepsAndGlobPattern,
  resolvePathUri,
  workspaceRelativePath,
} from "./config";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function findImplementationLocation(
  entry: ResolutionEntry,
  functionName: string,
  token: vscode.CancellationToken,
  featureSourceUri: vscode.Uri,
): Promise<vscode.Location | undefined> {
  const featureRel = workspaceRelativePath(entry.folder, featureSourceUri);
  const stepsGlob = concretePathFromFeatureAndGlobPattern(featureRel, entry.pack.stepsGlob);
  const pattern = new vscode.RelativePattern(entry.folder, stepsGlob);
  const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 200, token);

  const re = new RegExp(`^\\s*func\\s+${escapeRegExp(functionName)}\\s*\\(`);

  for (const file of files) {
    if (token.isCancellationRequested) {
      return undefined;
    }

    const doc = await vscode.workspace.openTextDocument(file);
    const lineCount = doc.lineCount;

    for (let i = 0; i < lineCount; i++) {
      const lineText = doc.lineAt(i).text;
      if (!re.test(lineText)) {
        continue;
      }

      const funcIdx = lineText.search(/\bfunc\s+/);
      const nameIdx = lineText.indexOf(functionName, funcIdx >= 0 ? funcIdx : 0);
      const startCol = nameIdx >= 0 ? nameIdx : 0;
      const start = new vscode.Position(i, startCol);
      const end = new vscode.Position(i, startCol + functionName.length);

      return new vscode.Location(file, new vscode.Range(start, end));
    }
  }

  return undefined;
}

export function bddUriForEntry(entry: ResolutionEntry, featureSourceUri: vscode.Uri): vscode.Uri {
  const featureRel = workspaceRelativePath(entry.folder, featureSourceUri);
  const bddRel = concretePathFromFeatureAndGlobPattern(featureRel, entry.pack.bddFile);

  return resolvePathUri(entry.folder, bddRel);
}

export function bddUriForStepsEntry(entry: ResolutionEntry, stepsSourceUri: vscode.Uri): vscode.Uri {
  const stepsRel = workspaceRelativePath(entry.folder, stepsSourceUri);
  const bddRel = concretePathFromStepsAndGlobPattern(stepsRel, entry.pack.bddFile);

  return resolvePathUri(entry.folder, bddRel);
}
