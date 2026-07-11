import * as path from "path";
import * as vscode from "vscode";
import { KNOWN_STEP_EXTENSIONS } from "./adapterRegistry";
import { buildProposals, type ScanFileRecord, type ScanProposal } from "./configScanner";
import type { PackConfig } from "./config";

const MAX_FILE_BYTES = 524288;
const FIND_CAP = 5000;

const cachedProposals = new Map<string, ScanProposal[]>();
const cachedPacks = new Map<string, PackConfig[]>();
const inflight = new Map<string, Promise<ScanProposal[]>>();

let scanLog: vscode.OutputChannel | undefined;

function log(message: string): void {
  scanLog ??= vscode.window.createOutputChannel("Cucumber Jump Scan");
  scanLog.appendLine(message);
}

function folderKey(folder: vscode.WorkspaceFolder): string {
  return folder.uri.toString();
}

function relPosix(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
  return path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
}

async function readSmallFile(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_FILE_BYTES) {
      return undefined;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return undefined;
  }
}

export async function scanWorkspace(
  folder: vscode.WorkspaceFolder,
  token?: vscode.CancellationToken,
): Promise<ScanProposal[]> {
  const featureUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/*.feature"),
    "**/node_modules/**",
    FIND_CAP,
    token,
  );
  if (featureUris.length === 0) {
    return [];
  }

  const stepPattern = `**/*.{${KNOWN_STEP_EXTENSIONS.join(",")}}`;
  const stepUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, stepPattern),
    "**/node_modules/**",
    FIND_CAP,
    token,
  );

  const features: ScanFileRecord[] = [];
  for (const uri of featureUris) {
    if (token?.isCancellationRequested) {
      return [];
    }
    const content = await readSmallFile(uri);
    if (content !== undefined) {
      features.push({ relPath: relPosix(folder, uri), content });
    }
  }

  const steps: ScanFileRecord[] = [];
  for (const uri of stepUris) {
    if (token?.isCancellationRequested) {
      return [];
    }
    const content = await readSmallFile(uri);
    if (content !== undefined) {
      steps.push({ relPath: relPosix(folder, uri), content });
    }
  }

  const proposals = buildProposals(features, steps);
  log(
    `Scanned ${folder.name}: ${features.length} feature file(s), ${steps.length} step-file candidate(s) → ${proposals.length} proposal(s)`,
  );
  return proposals;
}

export function getInferredPacks(folder: vscode.WorkspaceFolder): PackConfig[] {
  return cachedPacks.get(folderKey(folder)) ?? [];
}

export function getInferredProposals(folder: vscode.WorkspaceFolder): ScanProposal[] {
  return cachedProposals.get(folderKey(folder)) ?? [];
}

export function hasInferenceRun(folder: vscode.WorkspaceFolder): boolean {
  return cachedProposals.has(folderKey(folder));
}

export function clearInference(): void {
  cachedProposals.clear();
  cachedPacks.clear();
  inflight.clear();
}

export async function primeInference(folder: vscode.WorkspaceFolder): Promise<ScanProposal[]> {
  const key = folderKey(folder);
  const cached = cachedProposals.get(key);
  if (cached) {
    return cached;
  }
  const running = inflight.get(key);
  if (running) {
    return running;
  }

  const job = scanWorkspace(folder)
    .then((proposals) => {
      cachedProposals.set(key, proposals);
      cachedPacks.set(
        key,
        proposals.map((p) => ({
          name: p.name,
          featureGlob: p.featureGlob,
          stepsGlob: p.stepsGlob,
          inferred: true,
        })),
      );
      return proposals;
    })
    .catch((err) => {
      log(`Scan failed for ${folder.name}: ${err}`);
      cachedProposals.set(key, []);
      cachedPacks.set(key, []);
      return [] as ScanProposal[];
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, job);
  return job;
}
