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
import { extensionsForGlob, getAdapterForGlob, getAdapterForUri } from "./adapterRegistry";
import { getStepDefinitions } from "./documentCache";
import { findDefinitionAtPosition } from "./languageAdapter";
import type { StepDefinition } from "./languageAdapter";
import { concretePathFromFeatureAndGlobPattern, workspaceRelativePath } from "./config";

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

async function resolveFromFeatureViaAdapter(
  entry: import("./config").ResolutionEntry,
  document: vscode.TextDocument,
  stepText: string,
  normalizedStep: string,
  token: vscode.CancellationToken,
): Promise<vscode.Location[] | undefined> {
  const adapter = getAdapterForGlob(entry.pack.stepsGlob);
  if (!adapter) {
    return undefined;
  }
  const featureRel = workspaceRelativePath(entry.folder, document.uri);
  const stepsGlobConcrete = concretePathFromFeatureAndGlobPattern(featureRel, entry.pack.stepsGlob);
  const pattern = new vscode.RelativePattern(entry.folder, stepsGlobConcrete);
  const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 5000, token);

  for (const file of files) {
    if (token.isCancellationRequested) {
      return undefined;
    }

    let defs: StepDefinition[];
    try {
      defs = await getStepDefinitions(file, adapter);
    } catch {
      continue;
    }

    const def = defs.find((d) => adapter.matchesStep(d, stepText, normalizedStep));
    if (!def) {
      continue;
    }

    if (def.implLine !== undefined) {
      const pos = new vscode.Position(def.implLine, 0);
      return [new vscode.Location(file, new vscode.Range(pos, pos))];
    }

    if (def.implFunctionName) {
      const impl = await findImplementationLocation(entry, def.implFunctionName, token, document.uri);
      if (impl) {
        return [impl];
      }
    }

    const start = new vscode.Position(def.patternLine, def.patternStartCol);
    const end = new vscode.Position(def.patternLine, def.patternEndCol);
    return [new vscode.Location(file, new vscode.Range(start, end))];
  }

  return undefined;
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

    // ── Legacy path: bddFile registry present ──────────────────────────────
    if (entry.pack.bddFile) {
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
      return filtered.length === 0 ? locations : filtered;
    }

    // ── New adapter path: no bddFile ───────────────────────────────────────
    const result = await resolveFromFeatureViaAdapter(entry, document, stepText, normalized, token);
    if (result) {
      const filtered = dedupeDefinitionsOutsideSourceDoc(document, result);
      return filtered.length === 0 ? result : filtered;
    }
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

    out.push("");
    out.push(`Pack: ${entry.pack.name ?? "(unnamed)"}  featureGlob=${entry.pack.featureGlob}`);

    if (!entry.pack.bddFile) {
      out.push(`  stepsGlob=${entry.pack.stepsGlob} (adapter path — no bddFile)`);
      const exts = extensionsForGlob(entry.pack.stepsGlob);
      if (!getAdapterForGlob(entry.pack.stepsGlob)) {
        out.push(
          exts.length === 0
            ? "  ⚠ No file extension detectable in stepsGlob — add one (e.g. **/*.steps.ts) so the language adapter can be selected."
            : `  ⚠ No language adapter for extension(s) .${exts.join(" / .")} — supported: .go .java .kt .py .ts .js .rb .cs .dart (one language per glob).`,
        );
        continue;
      }
      out.push(`  Language adapter: .${exts.join(" / .")}`);
      // Report how many step files are visible
      const stepsGlobConcrete = concretePathFromFeatureAndGlobPattern(
        workspaceRelativePath(entry.folder, document.uri),
        entry.pack.stepsGlob,
      );
      const diagPattern = new vscode.RelativePattern(entry.folder, stepsGlobConcrete);
      const diagFiles = await vscode.workspace.findFiles(diagPattern, "**/node_modules/**", 5000, token);
      out.push(`  Step files found: ${diagFiles.length} (glob: ${stepsGlobConcrete})`);
      if (diagFiles.length === 0) {
        out.push("  ⚠ No step files match this glob — check stepsGlob in your cucumberJump settings.");
        continue;
      }
      const result = await resolveFromFeatureViaAdapter(entry, document, stepText, normalized, token);
      if (result && result.length > 0) {
        out.push(`  → ${vscode.workspace.asRelativePath(result[0].uri)}:${result[0].range.start.line + 1}`);
        return out;
      }
      out.push("  No matching step definition found in these files.");
      continue;
    }

    // existing bddFile logic follows unchanged...
    const bddUri = bddUriForEntry(entry, document.uri);
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
        out.push(`  Fallback: **Go to Implementation** opens this registry line (${block.regexLine + 1}).`);
      }
    } else {
      out.push("  No active `return handler(state, …)` in the map body (inline func or delegation only in comments).");
      out.push(`  **Go to Implementation** opens the registry line (${block.regexLine + 1}).`);
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

  // ── Legacy path: bddFile present ───────────────────────────────────────
  if (match.entry.pack.bddFile) {
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

  // ── New adapter path: no bddFile ───────────────────────────────────────
  const adapter = getAdapterForUri(document.uri);
  if (!adapter) {
    return undefined;
  }
  const defs = await getStepDefinitions(document.uri, adapter);
  const def = findDefinitionAtPosition(defs, position.line);
  if (!def) {
    return undefined;
  }

  const bddMatch = { entry: match.entry, fromProject: match.fromProject };
  const globs = getFeatureGlobsForBddReverse(bddMatch);

  return findFeatureUsages(
    match.entry.folder,
    globs,
    def.pattern,
    adapter.reverseRegexForPattern(def.pattern),
    token,
  );
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

    if (!entry.pack.bddFile) {
      continue;
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

    if (!entry.pack.bddFile) {
      const result = await resolveFromFeatureViaAdapter(entry, document, stepText, normalized, token);
      if (result && result.length > 0) {
        return result[0];
      }
      continue;
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

    if (block.implFunctionName) {
      const impl = await findImplementationLocation(entry, block.implFunctionName, token, document.uri);
      if (impl) {
        return impl;
      }
    }

    return bddLocationForBlock(bddUri, block);
  }

  return undefined;
}
