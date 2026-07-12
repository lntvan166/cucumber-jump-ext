import * as vscode from "vscode";
import {
  concretePathFromFeatureAndGlobPattern,
  getResolutionChainForFeature,
  workspaceRelativePath,
  type ResolutionEntry,
} from "./config";
import { extensionsForGlob, getAdapterForGlob } from "./adapterRegistry";
import { getStepKeywordAtLine, isFeatureUri } from "./featureParser";
import { showTextDocumentRevealAtTop } from "./editorNavigate";
import type { LanguageAdapter } from "./languageAdapter";

const DIAGNOSTIC_SOURCE = "Cucumber Jump";
const DIAGNOSTIC_CODE = "missing-step";

const FEATURE_SELECTOR: vscode.DocumentSelector = [
  { scheme: "file", pattern: "**/*.feature" },
  { scheme: "file", pattern: "**/*.FEATURE" },
  { scheme: "vscode-remote", pattern: "**/*.feature" },
  { scheme: "vscode-remote", pattern: "**/*.FEATURE" },
  { scheme: "file", language: "gherkin" },
  { scheme: "file", language: "cucumber" },
  { scheme: "file", language: "feature" },
  { scheme: "vscode-remote", language: "gherkin" },
  { scheme: "vscode-remote", language: "cucumber" },
  { scheme: "vscode-remote", language: "feature" },
];

/** Comment prefix for the "move into your class" marker (only class-based langs use it). */
function markerComment(): string {
  return "// TODO(Cucumber Jump): move this method inside your step-definition class";
}

/** Minimal scaffold for a brand-new step file, with the stub embedded. */
function newFileContent(ext: string, stub: string): string {
  const indent = (s: string) => s.split("\n").map((l) => (l ? `    ${l}` : l)).join("\n");
  switch (ext) {
    case "py":
      return `from behave import given, when, then\n\n\n${stub}\n`;
    case "rb":
      return `${stub}\n`;
    case "js":
      return `const { Given, When, Then } = require('@cucumber/cucumber');\n\n${stub}\n`;
    case "ts":
    case "tsx":
      return `import { Given, When, Then } from '@cucumber/cucumber';\n\n${stub}\n`;
    case "go":
      return `package steps\n\nimport "github.com/cucumber/godog"\n\n${stub}\n`;
    case "java":
      return `import io.cucumber.java.en.*;\n\npublic class GeneratedSteps {\n${indent(stub)}\n}\n`;
    case "kt":
    case "kts":
      return `import io.cucumber.java.en.*\n\nclass GeneratedSteps {\n${indent(stub)}\n}\n`;
    case "cs":
      return `using Reqnroll;\n\n[Binding]\npublic class GeneratedSteps\n{\n${indent(stub)}\n}\n`;
    case "dart":
      return `${stub}\n`;
    default:
      return `${stub}\n`;
  }
}

function proposeNewFilePath(
  folder: vscode.WorkspaceFolder,
  concrete: string,
  files: vscode.Uri[],
  featureUri: vscode.Uri,
  ext: string,
): string {
  const base = (featureUri.path.split("/").pop() ?? "steps").replace(/\.feature$/i, "");
  if (files.length > 0) {
    const rel = workspaceRelativePath(folder, files[0]);
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    return dir ? `${dir}/${base}_steps.${ext}` : `${base}_steps.${ext}`;
  }
  const prefix = concrete.split("*")[0].replace(/\/$/, "");
  return prefix ? `${prefix}/${base}_steps.${ext}` : `${base}_steps.${ext}`;
}

/** First chain entry with an adapter that can generate stubs (project before libraries). */
function firstStubCapableEntry(
  featureUri: vscode.Uri,
): { adapter: LanguageAdapter; entry: ResolutionEntry } | undefined {
  for (const entry of getResolutionChainForFeature(featureUri)) {
    if (entry.pack.bddFile) {
      continue;
    }
    const adapter = getAdapterForGlob(entry.pack.stepsGlob);
    if (adapter?.stubTemplate) {
      return { adapter, entry };
    }
  }
  return undefined;
}

function bodyLineOffset(stub: string): number {
  const lines = stub.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/pending|NotImplemented|Unimplemented|ErrPending/i.test(lines[i])) {
      return i;
    }
  }
  return 0;
}

async function createStepDefinition(uriArg?: unknown, lineArg?: unknown): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  let document: vscode.TextDocument;
  let line: number;
  if (uriArg instanceof vscode.Uri && typeof lineArg === "number") {
    document = await vscode.workspace.openTextDocument(uriArg);
    line = lineArg;
  } else if (editor && isFeatureUri(editor.document.uri)) {
    document = editor.document;
    line = editor.selection.active.line;
  } else {
    await vscode.window.showInformationMessage("Cucumber Jump: open a .feature file and put the cursor on a step.");
    return;
  }

  const kw = getStepKeywordAtLine(document.getText(), line);
  if (!kw) {
    await vscode.window.showInformationMessage("Cucumber Jump: no Gherkin step on this line.");
    return;
  }

  const chosen = firstStubCapableEntry(document.uri);
  if (!chosen) {
    await vscode.window.showInformationMessage(
      "Cucumber Jump: step generation is not available for this project's language.",
    );
    return;
  }

  const featureRel = workspaceRelativePath(chosen.entry.folder, document.uri);
  const concrete = chosen.entry.pack.inferred
    ? chosen.entry.pack.stepsGlob
    : concretePathFromFeatureAndGlobPattern(featureRel, chosen.entry.pack.stepsGlob);

  const cts = new vscode.CancellationTokenSource();
  let files: vscode.Uri[];
  try {
    files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(chosen.entry.folder, concrete),
      "**/node_modules/**",
      5000,
      cts.token,
    );
  } finally {
    cts.dispose();
  }

  interface Pick extends vscode.QuickPickItem {
    file?: vscode.Uri;
    newFile?: boolean;
  }
  const items: Pick[] = files.map((f) => ({ label: vscode.workspace.asRelativePath(f), file: f }));
  items.push({ label: "$(new-file) New file…", newFile: true, alwaysShow: true });

  const picked = await vscode.window.showQuickPick(items, {
    title: "Cucumber Jump: create step definition",
    placeHolder: "Choose a step file to add the definition to",
  });
  if (!picked) {
    return;
  }

  if (picked.file) {
    const ext = (picked.file.fsPath.split(".").pop() ?? "").toLowerCase();
    const stub = chosen.adapter.stubTemplate!.render({ keyword: kw.keyword, stepBody: kw.body, ext });

    const doc = await vscode.workspace.openTextDocument(picked.file);
    const lastLine = doc.lineCount - 1;
    const endPos = new vscode.Position(lastLine, doc.lineAt(lastLine).text.length);
    const marker = chosen.adapter.stubTemplate!.isClassBased ? `${markerComment()}\n` : "";
    const insertText = `\n\n${marker}${stub}\n`;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(picked.file, endPos, insertText);
    await vscode.workspace.applyEdit(edit);

    const markerLines = marker ? 1 : 0;
    const bodyLine = lastLine + 2 + markerLines + bodyLineOffset(stub);
    const pos = new vscode.Position(bodyLine, 0);
    await showTextDocumentRevealAtTop(doc, { selection: new vscode.Selection(pos, pos), preview: false });
    return;
  }

  const provisionalExt = extensionsForGlob(concrete)[0] ?? "";
  const proposed = proposeNewFilePath(chosen.entry.folder, concrete, files, document.uri, provisionalExt);
  const input = await vscode.window.showInputBox({
    title: "Cucumber Jump: new step file",
    prompt: "Path relative to the workspace folder",
    value: proposed,
  });
  if (!input) {
    return;
  }
  const target = vscode.Uri.joinPath(chosen.entry.folder.uri, input);
  const ext = (input.split(".").pop() ?? "").toLowerCase();
  const stub = chosen.adapter.stubTemplate!.render({ keyword: kw.keyword, stepBody: kw.body, ext });
  const content = newFileContent(ext, stub);
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(target, { ignoreIfExists: true, contents: Buffer.from(content, "utf8") });
  await vscode.workspace.applyEdit(edit);
  await showTextDocumentRevealAtTop(target, { preview: false });
}

export function registerStepAuthoring(context: vscode.ExtensionContext): void {
  const provider: vscode.CodeActionProvider = {
    provideCodeActions(document, _range, actionContext) {
      const relevant = actionContext.diagnostics.filter(
        (d) => d.source === DIAGNOSTIC_SOURCE && d.code === DIAGNOSTIC_CODE,
      );
      if (relevant.length === 0) {
        return undefined;
      }
      return relevant.map((d) => {
        const action = new vscode.CodeAction(
          "Cucumber Jump: Create step definition",
          vscode.CodeActionKind.QuickFix,
        );
        action.diagnostics = [d];
        action.command = {
          command: "cucumberJump.createStepDefinition",
          title: "Create step definition",
          arguments: [document.uri, d.range.start.line],
        };
        return action;
      });
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(FEATURE_SELECTOR, provider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.commands.registerCommand("cucumberJump.createStepDefinition", createStepDefinition),
  );
}
