import * as vscode from "vscode";
import { showTextDocumentRevealAtTop } from "./editorNavigate";
import { getStepTextAtLineNumber, isFeatureFilePath } from "./featureParser";
import { explainFeatureStepResolution, resolveFromFeature, resolveImplementationOnly } from "./resolver";

type TargetPickItem = vscode.QuickPickItem & { loc: vscode.Location };

function stepTargetKindLabel(uri: vscode.Uri): string {
  const p = uri.fsPath.toLowerCase();
  if (p.endsWith("bdd.go") || p.includes("_bdd.go")) {
    return "Step registry (bdd)";
  }

  return "Implementation";
}

export function registerStepUi(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Cucumber Jump", { log: true });
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand("cucumberJump.showStepResolution", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isFeatureFilePath(editor.document.uri.fsPath)) {
        await vscode.window.showInformationMessage("Open a .feature file and put the cursor on a step line.");
        return;
      }

      const cts = new vscode.CancellationTokenSource();
      try {
        const lines = await explainFeatureStepResolution(editor.document, editor.selection.active, cts.token);
        output.clear();
        output.appendLine(lines.join("\n"));
        output.show(true);
      } finally {
        cts.dispose();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cucumberJump.peekStepTargets", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isFeatureFilePath(editor.document.uri.fsPath)) {
        await vscode.window.showInformationMessage("Open a .feature file and put the cursor on a step line.");
        return;
      }

      const cts = new vscode.CancellationTokenSource();
      try {
        const locs = await resolveFromFeature(editor.document, editor.selection.active, cts.token);
        if (!locs || locs.length === 0) {
          await vscode.window.showInformationMessage("Cucumber Jump: no targets for this line.");
          return;
        }

        const items: TargetPickItem[] = locs.map((loc, i) => {
          const rel = vscode.workspace.asRelativePath(loc.uri);

          return {
            label: `${i + 1}. ${stepTargetKindLabel(loc.uri)}`,
            description: `${rel}:${loc.range.start.line + 1}`,
            loc,
          };
        });

        const picked = await vscode.window.showQuickPick(items, {
          title: "Cucumber Jump",
          placeHolder: "Pick a target (extension-only list)",
        });

        if (!picked) {
          return;
        }

        await showTextDocumentRevealAtTop(picked.loc.uri, { selection: picked.loc.range, preview: false });
      } finally {
        cts.dispose();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cucumberJump._codeLensStepNavigate",
      async (uriStr: string, line: number, which: "impl" | "registry") => {
        const uri = vscode.Uri.parse(uriStr);
        const doc = await vscode.workspace.openTextDocument(uri);
        const pos = new vscode.Position(line, 0);
        await showTextDocumentRevealAtTop(doc, { selection: new vscode.Selection(pos, pos) });

        if (which === "impl") {
          await vscode.commands.executeCommand("cucumberJump.goToImplementation");
          return;
        }

        await vscode.commands.executeCommand("cucumberJump.goToStepRegistry");
      },
    ),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file", pattern: "**/*.feature" }, {
      provideCodeLenses: async (document, token) => {
        const enabled = vscode.workspace.getConfiguration("cucumberJump").get<boolean>("codeLensEnabled") ?? false;
        if (!enabled) {
          return [];
        }

        const text = document.getText();
        const lenses: vscode.CodeLens[] = [];
        const lineCount = document.lineCount;

        for (let i = 0; i < lineCount; i++) {
          if (token.isCancellationRequested) {
            return [];
          }

          if (!getStepTextAtLineNumber(text, i)) {
            continue;
          }

          const range = document.lineAt(i).range;
          const uriStr = document.uri.toString();

          lenses.push(
            new vscode.CodeLens(range, {
              title: "$(symbol-method) Implementation",
              command: "cucumberJump._codeLensStepNavigate",
              arguments: [uriStr, i, "impl"],
            }),
          );

          lenses.push(
            new vscode.CodeLens(range, {
              title: "$(symbol-interface) Registry",
              command: "cucumberJump._codeLensStepNavigate",
              arguments: [uriStr, i, "registry"],
            }),
          );
        }

        return lenses;
      },
    }),
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "cucumberJump.showStepResolution";
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let statusRefreshGeneration = 0;

  const refreshStatus = async (): Promise<void> => {
    const generation = ++statusRefreshGeneration;
    const enabled = vscode.workspace.getConfiguration("cucumberJump").get<boolean>("statusBarHintEnabled") ?? false;
    const editor = vscode.window.activeTextEditor;

    if (!enabled || !editor || !isFeatureFilePath(editor.document.uri.fsPath)) {
      if (generation === statusRefreshGeneration) {
        status.hide();
      }
      return;
    }

    const stepText = getStepTextAtLineNumber(editor.document.getText(), editor.selection.active.line);
    if (!stepText) {
      if (generation === statusRefreshGeneration) {
        status.hide();
      }
      return;
    }

    const cts = new vscode.CancellationTokenSource();
    try {
      const impl = await resolveImplementationOnly(editor.document, editor.selection.active, cts.token);
      if (generation !== statusRefreshGeneration || cts.token.isCancellationRequested) {
        return;
      }

      if (impl) {
        const rel = vscode.workspace.asRelativePath(impl.uri);
        status.text = `$(debug-breakpoint-log) ${rel}:${impl.range.start.line + 1}`;
        status.tooltip = new vscode.MarkdownString(
          "Cucumber Jump: **primary implementation** — click for the full resolution log.\n\nSame line as the CodeLens / Go to Implementation target.",
          true,
        );
        status.show();
        return;
      }

      status.text = "$(question) Cucumber Jump: no impl";
      status.tooltip = new vscode.MarkdownString(
        "No `*_steps.go` match for this step yet — **click** for the step-by-step resolution log.",
        true,
      );
      status.show();
    } finally {
      cts.dispose();
    }
  };

  const scheduleStatusRefresh = (): void => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void refreshStatus();
    }, 300);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!isFeatureFilePath(e.textEditor.document.uri.fsPath)) {
        status.hide();
        return;
      }

      scheduleStatusRefresh();
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (!e || !isFeatureFilePath(e.document.uri.fsPath)) {
        if (debounceTimer !== undefined) {
          clearTimeout(debounceTimer);
          debounceTimer = undefined;
        }
        statusRefreshGeneration += 1;
        status.hide();
        return;
      }

      scheduleStatusRefresh();
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cucumberJump.statusBarHintEnabled")) {
        scheduleStatusRefresh();
      }
    }),
  );

  context.subscriptions.push(status, {
    dispose: () => {
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
      }
      statusRefreshGeneration += 1;
    },
  });
}
