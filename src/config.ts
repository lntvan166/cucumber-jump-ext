import { minimatch } from "minimatch";
import * as path from "path";
import * as vscode from "vscode";

export type PackConfig = {
  name?: string;
  featureGlob: string;
  bddFile: string;
  stepsGlob: string;
};

function posixRelative(folder: vscode.WorkspaceFolder, fileUri: vscode.Uri): string {
  const folderPath = folder.uri.fsPath;
  const filePath = fileUri.fsPath;
  const rel = path.relative(folderPath, filePath);

  return rel.split(path.sep).join("/");
}

function pathMatchesConfigPath(relativePosixPath: string, configPath: string): boolean {
  const normalized = relativePosixPath.replace(/\\/g, "/");
  const p = configPath.replace(/\\/g, "/");

  if (p.includes("*") || p.includes("?")) {
    return minimatch(normalized, p, { dot: true });
  }

  return normalized === p;
}

export function getWorkspaceFolderForUri(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(uri);
}

export function workspaceRelativePath(folder: vscode.WorkspaceFolder, fileUri: vscode.Uri): string {
  return posixRelative(folder, fileUri);
}

export function readPackConfigs(): { projects: PackConfig[]; libraries: PackConfig[] } {
  const config = vscode.workspace.getConfiguration("cucumberJump");

  return {
    projects: config.get<PackConfig[]>("projects") ?? [],
    libraries: config.get<PackConfig[]>("libraries") ?? [],
  };
}

function matchesGlob(relativePosixPath: string, pattern: string): boolean {
  const normalized = relativePosixPath.replace(/\\/g, "/");

  return minimatch(normalized, pattern, { dot: true });
}

/**
 * Repo-root globs like "testing/.../feature/..." often fail when the workspace folder is
 * opened one level down (e.g. only the testing directory): relative paths omit that prefix.
 * Also match "workspaceFolderName/relativePath" against the same glob in that case.
 */
export function relMatchesFeatureGlob(
  relativePosixPath: string,
  featureGlob: string,
  folder: vscode.WorkspaceFolder,
): boolean {
  const rel = relativePosixPath.replace(/\\/g, "/");
  if (matchesGlob(rel, featureGlob)) {
    return true;
  }

  const folderSeg = path.basename(folder.uri.fsPath);
  if (!folderSeg || rel.length === 0) {
    return false;
  }

  const prefixed = `${folderSeg}/${rel}`;
  if (prefixed === rel) {
    return false;
  }

  return matchesGlob(prefixed, featureGlob);
}

export type ResolutionEntry = {
  folder: vscode.WorkspaceFolder;
  pack: PackConfig;
};

export function featurePackageRoot(rel: string): string | undefined {
  const needle = "/feature/";
  const idx = rel.indexOf(needle);
  if (idx === -1) {
    return undefined;
  }

  return rel.slice(0, idx);
}

export function concretePathFromFeatureAndGlobPattern(featureWorkspaceRel: string, pattern: string): string {
  const norm = pattern.replace(/\\/g, "/");
  if (!norm.includes("*") && !norm.includes("?")) {
    return norm;
  }

  const root = featurePackageRoot(featureWorkspaceRel);
  if (!root) {
    return norm;
  }

  const i = norm.indexOf("**");
  if (i === -1) {
    return norm;
  }

  let rest = norm.slice(i + 2).replace(/^\//, "");
  if (rest.length === 0) {
    return root;
  }

  return `${root}/${rest}`;
}

function globWildcardScore(glob: string): number {
  const stars = (glob.match(/\*/g) ?? []).length;
  const qs = (glob.match(/\?/g) ?? []).length;

  return stars * 10 + qs;
}

function sortProjectsBySpecificity(packs: PackConfig[]): PackConfig[] {
  return [...packs].sort((a, b) => globWildcardScore(a.featureGlob) - globWildcardScore(b.featureGlob));
}

function pickBestProjectForFeature(rel: string, candidates: PackConfig[]): PackConfig | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const root = featurePackageRoot(rel);
  if (root) {
    const bddUnderSameRoot = candidates.filter((p) => {
      const concrete = concretePathFromFeatureAndGlobPattern(rel, p.bddFile);
      const c = concrete.replace(/\\/g, "/");

      return c.startsWith(`${root}/`) || c === root;
    });

    if (bddUnderSameRoot.length > 0) {
      return sortProjectsBySpecificity(bddUnderSameRoot)[0];
    }
  }

  return sortProjectsBySpecificity(candidates)[0];
}

export function getResolutionChainForFeature(featureUri: vscode.Uri): ResolutionEntry[] {
  const folder = getWorkspaceFolderForUri(featureUri);
  if (!folder) {
    return [];
  }

  const { projects, libraries } = readPackConfigs();
  const rel = posixRelative(folder, featureUri);
  const chain: ResolutionEntry[] = [];

  const matchingProjects = projects.filter((p) => relMatchesFeatureGlob(rel, p.featureGlob, folder));
  const best = pickBestProjectForFeature(rel, matchingProjects);
  if (best) {
    chain.push({ folder, pack: best });
  }

  for (const pack of libraries) {
    chain.push({ folder, pack });
  }

  return chain;
}

export function resolvePathUri(folder: vscode.WorkspaceFolder, relativePath: string): vscode.Uri {
  const norm = relativePath.replace(/\\/g, "/").replace(/^\//, "");
  const segments = norm.split("/").filter((s) => s.length > 0);
  const base = path.basename(folder.uri.fsPath);
  if (segments.length > 0 && segments[0] === base) {
    return vscode.Uri.joinPath(folder.uri, ...segments.slice(1));
  }

  return vscode.Uri.joinPath(folder.uri, ...segments);
}

export type BddPackMatch = {
  entry: ResolutionEntry;
  fromProject: boolean;
};

export function findPackForBddFile(bddUri: vscode.Uri): BddPackMatch | undefined {
  const folder = getWorkspaceFolderForUri(bddUri);
  if (!folder) {
    return undefined;
  }

  const rel = posixRelative(folder, bddUri);
  const { projects, libraries } = readPackConfigs();

  for (const pack of projects) {
    if (pathMatchesConfigPath(rel, pack.bddFile)) {
      return { entry: { folder, pack }, fromProject: true };
    }
  }

  for (const pack of libraries) {
    if (pathMatchesConfigPath(rel, pack.bddFile)) {
      return { entry: { folder, pack }, fromProject: false };
    }
  }

  return undefined;
}

export function getFeatureGlobsForBddReverse(match: BddPackMatch): string[] {
  const { libraries } = readPackConfigs();
  const globs = [match.entry.pack.featureGlob];

  if (match.fromProject) {
    for (const lib of libraries) {
      if (!globs.includes(lib.featureGlob)) {
        globs.push(lib.featureGlob);
      }
    }
  }

  return globs;
}

/** Package root for a *_steps.go path: segment before `/testing/` or `/steps/`. */
export function stepsPackageRoot(rel: string): string | undefined {
  const r = rel.replace(/\\/g, "/");
  const testingIdx = r.indexOf("/testing/");
  if (testingIdx !== -1) {
    return r.slice(0, testingIdx);
  }

  const stepsIdx = r.indexOf("/steps/");
  if (stepsIdx !== -1) {
    return r.slice(0, stepsIdx);
  }

  return undefined;
}

export function concretePathFromStepsAndGlobPattern(stepsWorkspaceRel: string, pattern: string): string {
  const norm = pattern.replace(/\\/g, "/");
  if (!norm.includes("*") && !norm.includes("?")) {
    return norm;
  }

  const root = stepsPackageRoot(stepsWorkspaceRel);
  if (!root) {
    return norm;
  }

  const i = norm.indexOf("**");
  if (i === -1) {
    return norm;
  }

  let rest = norm.slice(i + 2).replace(/^\//, "");
  if (rest.length === 0) {
    return root;
  }

  return `${root}/${rest}`;
}

export function relMatchesStepsGlob(
  relativePosixPath: string,
  stepsGlob: string,
  folder: vscode.WorkspaceFolder,
): boolean {
  const rel = relativePosixPath.replace(/\\/g, "/");
  if (pathMatchesConfigPath(rel, stepsGlob)) {
    return true;
  }

  const folderSeg = path.basename(folder.uri.fsPath);
  if (!folderSeg || rel.length === 0) {
    return false;
  }

  const prefixed = `${folderSeg}/${rel}`;
  if (prefixed === rel) {
    return false;
  }

  return pathMatchesConfigPath(prefixed, stepsGlob);
}

function sortPacksByStepsGlobSpecificity(packs: PackConfig[]): PackConfig[] {
  return [...packs].sort((a, b) => globWildcardScore(a.stepsGlob) - globWildcardScore(b.stepsGlob));
}

export type StepsPackMatch = {
  entry: ResolutionEntry;
  fromProject: boolean;
};

export function findPackForStepsFile(stepsUri: vscode.Uri): StepsPackMatch | undefined {
  const folder = getWorkspaceFolderForUri(stepsUri);
  if (!folder) {
    return undefined;
  }

  const rel = posixRelative(folder, stepsUri);
  const { projects, libraries } = readPackConfigs();
  const projectMatches = projects.filter((p) => relMatchesStepsGlob(rel, p.stepsGlob, folder));
  if (projectMatches.length > 0) {
    const best = sortPacksByStepsGlobSpecificity(projectMatches)[0];

    return { entry: { folder, pack: best }, fromProject: true };
  }

  for (const pack of libraries) {
    if (relMatchesStepsGlob(rel, pack.stepsGlob, folder)) {
      return { entry: { folder, pack }, fromProject: false };
    }
  }

  return undefined;
}
