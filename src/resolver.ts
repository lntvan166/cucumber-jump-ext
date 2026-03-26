import * as vscode from "vscode";
import { blockMatchesStep, findBlockAtPosition, stepTextFromBlock, type BddStepBlock } from "./bddParser";
import {
  findPackForBddFile,
  findPackForStepsFile,
  getFeatureGlobsForBddReverse,
  getResolutionChainForFeature,
} from "./config";
import { bddUriForEntry, bddUriForStepsEntry } from "./goImplFinder";
import { getBddBlocks } from "./documentCache";
import { findFeatureUsages } from "./featureFinder";
import { getStepTextAtLineNumber, normalizeStepText } from "./featureParser";
import { findImplementationLocation } from "./goImplFinder";
import { isSameLocalFile } from "./sameFileUri";

function bddLocationForBlock(uri: vscode.Uri, block: BddStepBlock): vscode.Location {
  const start = new vscode.Position(block.regexLine, block.regexStartColumn);
  const end = new vscode.Position(block.regexLine, block.regexEndColumn);

  return new vscode.Location(uri, new vscode.Range(start, end));
}

function shouldIncludeStepRegistryInDefinition(): boolean {
  return vscode.workspace.getConfiguration("cucumberJump").get<boolean>("includeStepRegistryInDefinition") ?? false;
}

function dedupeDefinitionsOutsideSourceDoc(source: vscode.TextDocument, locations: vscode.Location[]): vscode.Location[] {
  const seen = new Set<string>();
  const out: vscode.Location[] = [];

  for (const loc of locations) {
    if (isSameLocalFile(loc.uri, source.uri)) {
      continue;
    }

    const key = `${loc.uri.toString()}\0${loc.range.start.line}\0${loc.range.start.character}\0${loc.range.end.line}\0${loc.range.end.character}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(loc);
  }

  return out;
}

export async function resolveFromFeature(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
): Promise<vscode.Location[] | undefined> {
  const stepText = getStepTextAtLineNumber(document.getText(), position.line);
  if (!stepText) {
    return undefined;
  }

  const normalized = normalizeStepText(stepText);
  const chain = getResolutionChainForFeature(document.uri);
  if (chain.length === 0) {
    return undefined;
  }

  for (const entry of chain) {
    if (token.isCancellationRequested) {
      return undefined;
    }

    const bddUri = bddUriForEntry(entry, document.uri);
    let blocks: BddStepBlock[];
    try {
      blocks = await getBddBlocks(bddUri);
    } catch {
      continue;
    }

    const block = blocks.find((b) => blockMatchesStep(b, stepText, normalized));
    if (!block) {
      continue;
    }

    const locations: vscode.Location[] = [];
    if (block.implFunctionName) {
      const impl = await findImplementationLocation(entry, block.implFunctionName, token, document.uri);
      if (impl) {
        locations.push(impl);
      }
    }

    if (shouldIncludeStepRegistryInDefinition()) {
      locations.push(bddLocationForBlock(bddUri, block));
    }

    if (locations.length === 0) {
      locations.push(bddLocationForBlock(bddUri, block));
    }

    const filtered = dedupeDefinitionsOutsideSourceDoc(document, locations);
    if (filtered.length === 0) {
      return undefined;
    }

    return filtered;
  }

  return undefined;
}

export async function explainFeatureStepResolution(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
): Promise<string[]> {
  const out: string[] = [];
  const stepText = getStepTextAtLineNumber(document.getText(), position.line);
  if (!stepText) {
    return ["No Gherkin step on this line (Given / When / Then / And / But + text)."];
  }

  out.push(`Step: ${stepText}`);
  const normalized = normalizeStepText(stepText);
  const chain = getResolutionChainForFeature(document.uri);
  if (chain.length === 0) {
    return [...out, "", "No cucumberJump.projects entry matches this feature path (check workspace folder and featureGlob)."];
  }

  out.push(`Search order: ${chain.map((e) => e.pack.name ?? e.pack.featureGlob).join(" → ")}`);

  for (const entry of chain) {
    if (token.isCancellationRequested) {
      return out;
    }

    const bddUri = bddUriForEntry(entry, document.uri);
    out.push("");
    out.push(`Pack: ${entry.pack.name ?? "(unnamed)"}  featureGlob=${entry.pack.featureGlob}`);
    out.push(`  bdd → ${vscode.workspace.asRelativePath(bddUri)}`);

    let blocks: BddStepBlock[];
    try {
      blocks = await getBddBlocks(bddUri);
    } catch (err) {
      out.push(`  (cannot read bdd: ${err})`);
      continue;
    }

    const block = blocks.find((b) => blockMatchesStep(b, stepText, normalized));
    if (!block) {
      out.push("  No StepMap entry matches (comment line + regex).");
      continue;
    }

    out.push(`  Matched map key at line ${block.regexLine + 1}`);
    if (block.implFunctionName) {
      out.push(`  Handler: ${block.implFunctionName}()`);
      const impl = await findImplementationLocation(entry, block.implFunctionName, token, document.uri);
      if (impl) {
        out.push(`  Implementation → ${vscode.workspace.asRelativePath(impl.uri)}:${impl.range.start.line + 1}`);
      } else {
        out.push("  Implementation: not found (stepsGlob / function name).");
      }
    } else {
      out.push("  No return <func>(state) found after this map entry.");
    }

    return out;
  }

  return [...out, "", "No pack produced a match."];
}

const goFuncDeclRe = /^\s*func\s+([a-zA-Z0-9_]+)\s*\(/;

export function functionNameAtOrAboveLine(document: vscode.TextDocument, zeroBasedLine: number): string | undefined {
  const maxLookback = 80;
  const start = Math.max(0, zeroBasedLine - maxLookback);

  for (let i = zeroBasedLine; i >= start; i--) {
    const m = document.lineAt(i).text.match(goFuncDeclRe);
    if (m) {
      return m[1];
    }
  }

  return undefined;
}

export async function resolveFeatureUsagesFromStepsAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
): Promise<vscode.Location[] | undefined> {
  const match = findPackForStepsFile(document.uri);
  if (!match) {
    return undefined;
  }

  const funcName = functionNameAtOrAboveLine(document, position.line);
  if (!funcName) {
    return undefined;
  }

  const bddUri = bddUriForStepsEntry(match.entry, document.uri);
  let blocks: BddStepBlock[];
  try {
    blocks = await getBddBlocks(bddUri);
  } catch {
    return undefined;
  }

  const block = blocks.find((b) => b.implFunctionName === funcName);
  if (!block) {
    return undefined;
  }

  const canonical = stepTextFromBlock(block);
  const bddMatch = { entry: match.entry, fromProject: match.fromProject };
  const globs = getFeatureGlobsForBddReverse(bddMatch);

  return findFeatureUsages(match.entry.folder, globs, canonical, block.regexPattern, token);
}

export async function resolveFromBdd(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
): Promise<vscode.Location[] | undefined> {
  const match = findPackForBddFile(document.uri);
  if (!match) {
    return undefined;
  }

  const text = document.getText();
  const block = findBlockAtPosition(text, position.line, position.character);
  if (!block) {
    return undefined;
  }

  const canonical = stepTextFromBlock(block);
  const globs = getFeatureGlobsForBddReverse(match);

  return findFeatureUsages(match.entry.folder, globs, canonical, block.regexPattern, token);
}

export async function resolveRegistryOnly(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
): Promise<vscode.Location | undefined> {
  const stepText = getStepTextAtLineNumber(document.getText(), position.line);
  if (!stepText) {
    return undefined;
  }

  const normalized = normalizeStepText(stepText);
  const chain = getResolutionChainForFeature(document.uri);

  for (const entry of chain) {
    if (token.isCancellationRequested) {
      return undefined;
    }

    const bddUri = bddUriForEntry(entry, document.uri);
    let blocks: BddStepBlock[];
    try {
      blocks = await getBddBlocks(bddUri);
    } catch {
      continue;
    }

    const block = blocks.find((b) => blockMatchesStep(b, stepText, normalized));
    if (!block) {
      continue;
    }

    return bddLocationForBlock(bddUri, block);
  }

  return undefined;
}

export async function resolveImplementationOnly(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
): Promise<vscode.Location | undefined> {
  const stepText = getStepTextAtLineNumber(document.getText(), position.line);
  if (!stepText) {
    return undefined;
  }

  const normalized = normalizeStepText(stepText);
  const chain = getResolutionChainForFeature(document.uri);

  for (const entry of chain) {
    if (token.isCancellationRequested) {
      return undefined;
    }

    const bddUri = bddUriForEntry(entry, document.uri);
    let blocks: BddStepBlock[];
    try {
      blocks = await getBddBlocks(bddUri);
    } catch {
      continue;
    }

    const block = blocks.find((b) => blockMatchesStep(b, stepText, normalized));
    if (!block || !block.implFunctionName) {
      continue;
    }

    return findImplementationLocation(entry, block.implFunctionName, token, document.uri);
  }

  return undefined;
}
