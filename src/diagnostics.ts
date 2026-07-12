import * as vscode from "vscode";
import { findPackForStepsFile } from "./config";
import { isFeatureUri } from "./featureParser";
import { findUnmatchedSteps } from "./resolver";

const DIAGNOSTIC_SOURCE = "Cucumber Jump";
const DIAGNOSTIC_CODE = "missing-step";

export function registerDiagnostics(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("cucumberJump");
  context.subscriptions.push(collection);

  const perDoc = new Map<string, vscode.CancellationTokenSource>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const enabled = (): boolean =>
    vscode.workspace.getConfiguration("cucumberJump").get<boolean>("diagnosticsEnabled") ?? false;

  const refresh = async (document: vscode.TextDocument): Promise<void> => {
    if (!isFeatureUri(document.uri)) {
      return;
    }
    const key = document.uri.toString();
    perDoc.get(key)?.cancel();
    perDoc.get(key)?.dispose();

    if (!enabled()) {
      collection.delete(document.uri);
      return;
    }

    const cts = new vscode.CancellationTokenSource();
    perDoc.set(key, cts);
    try {
      const verdict = await findUnmatchedSteps(document, cts.token);
      if (cts.token.isCancellationRequested) {
        return;
      }
      if (!verdict.eligible) {
        collection.delete(document.uri);
        return;
      }
      const diagnostics = verdict.unmatchedLines.map((line) => {
        const text = document.lineAt(line).text;
        const startCol = text.length - text.trimStart().length;
        const range = new vscode.Range(line, startCol, line, text.length);
        const d = new vscode.Diagnostic(range, "No matching step definition", vscode.DiagnosticSeverity.Warning);
        d.source = DIAGNOSTIC_SOURCE;
        d.code = DIAGNOSTIC_CODE;
        return d;
      });
      collection.set(document.uri, diagnostics);
    } catch {
      collection.delete(document.uri);
    }
  };

  const schedule = (document: vscode.TextDocument, delay = 300): void => {
    const key = document.uri.toString();
    const existing = timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void refresh(document);
      }, delay),
    );
  };

  const refreshAllOpenFeatures = (): void => {
    for (const editor of vscode.window.visibleTextEditors) {
      if (isFeatureUri(editor.document.uri)) {
        schedule(editor.document);
      }
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isFeatureUri(doc.uri)) {
        schedule(doc, 50);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isFeatureUri(e.document.uri)) {
        schedule(e.document);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isFeatureUri(doc.uri)) {
        schedule(doc, 50);
        return;
      }
      // A step-file save can newly satisfy (or break) steps in open features.
      // Delay lets extension.ts's cache-invalidation listener run first.
      if (findPackForStepsFile(doc.uri)) {
        refreshAllOpenFeatures();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cucumberJump")) {
        refreshAllOpenFeatures();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isFeatureUri(editor.document.uri)) {
        schedule(editor.document, 50);
      }
    }),
    {
      dispose: () => {
        for (const t of timers.values()) {
          clearTimeout(t);
        }
        for (const c of perDoc.values()) {
          c.dispose();
        }
      },
    },
  );

  refreshAllOpenFeatures();
}
