import * as vscode from "vscode";
import { parseBddFile, type BddStepBlock } from "./bddParser";
import type { LanguageAdapter, StepDefinition } from "./languageAdapter";
import { isSameLocalFile } from "./sameFileUri";

// ── Legacy Go BDD block cache ─────────────────────────────────────────────────

type BddCacheEntry = {
  mtime: number;
  blocks: BddStepBlock[];
};

const bddCache = new Map<string, BddCacheEntry>();

function openDocForUri(uri: vscode.Uri): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((d) => isSameLocalFile(d.uri, uri));
}

export async function getBddBlocks(uri: vscode.Uri): Promise<BddStepBlock[]> {
  const open = openDocForUri(uri);
  if (open) {
    return parseBddFile(open.getText());
  }

  const stat = await vscode.workspace.fs.stat(uri);
  const mtime = typeof stat.mtime === "number" ? stat.mtime : Number(stat.mtime);
  const key = uri.toString();
  const existing = bddCache.get(key);
  if (existing && existing.mtime === mtime) {
    return existing.blocks;
  }

  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder("utf-8").decode(bytes);
  const blocks = parseBddFile(text);
  bddCache.set(key, { mtime, blocks });

  return blocks;
}

// ── New adapter-based StepDefinition cache ────────────────────────────────────

type StepDefCacheEntry = {
  mtime: number;
  defs: StepDefinition[];
};

const stepDefCache = new Map<string, StepDefCacheEntry>();

export async function getStepDefinitions(
  uri: vscode.Uri,
  adapter: LanguageAdapter,
): Promise<StepDefinition[]> {
  const open = openDocForUri(uri);
  if (open) {
    return adapter.parseStepDefinitions(open.getText());
  }

  const stat = await vscode.workspace.fs.stat(uri);
  const mtime = typeof stat.mtime === "number" ? stat.mtime : Number(stat.mtime);
  const key = uri.toString();
  const existing = stepDefCache.get(key);
  if (existing && existing.mtime === mtime) {
    return existing.defs;
  }

  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder("utf-8").decode(bytes);
  const defs = adapter.parseStepDefinitions(text);
  stepDefCache.set(key, { mtime, defs });

  return defs;
}

// ── Invalidation ──────────────────────────────────────────────────────────────

export function invalidateDocument(uri: vscode.Uri): void {
  const key = uri.toString();
  bddCache.delete(key);
  stepDefCache.delete(key);
}

export function invalidateAll(): void {
  bddCache.clear();
  stepDefCache.clear();
}
