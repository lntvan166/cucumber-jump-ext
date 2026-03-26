import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

function pathsEqualForOs(a: string, b: string): boolean {
  if (process.platform === "win32") {
    return a.toLowerCase() === b.toLowerCase();
  }

  return a === b;
}

/**
 * True when both URIs refer to the same file on disk.
 * Uses realpath so symlink / duplicate path spellings still match; avoids
 * missing self-dedupe when document.uri.toString() !== loc.uri.toString().
 */
export function isSameLocalFile(a: vscode.Uri, b: vscode.Uri): boolean {
  if (a.scheme !== "file" || b.scheme !== "file") {
    return a.toString() === b.toString();
  }

  try {
    const ra = fs.realpathSync.native(a.fsPath);
    const rb = fs.realpathSync.native(b.fsPath);

    return pathsEqualForOs(ra, rb);
  } catch {
    const na = path.normalize(a.fsPath);
    const nb = path.normalize(b.fsPath);

    return pathsEqualForOs(na, nb);
  }
}
