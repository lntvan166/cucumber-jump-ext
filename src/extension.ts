import * as vscode from "vscode";
import { isBddStepDeclarationPosition } from "./bddParser";
import { findPackForBddFile } from "./config";
import { invalidateDocument, invalidateAll } from "./documentCache";
import { showTextDocumentRevealAtTop } from "./editorNavigate";
import { registerDevMode } from "./devMode";
import { resolveFromBdd, resolveFromFeature, resolveImplementationOnly, resolveRegistryOnly } from "./resolver";
import { registerStepUi } from "./stepUi";

export function activate(context: vscode.ExtensionContext): void {
  registerStepUi(context);
  registerDevMode(context);
  const definitionProvider: vscode.DefinitionProvider = {
    provideDefinition: async (document, position, token) => {
      if (isFeatureDocument(document)) {
        return resolveFromFeature(document, position, token);
      }

      if (document.languageId === "go" && findPackForBddFile(document.uri)) {
        const text = document.getText();
        if (isBddStepDeclarationPosition(text, position.line, position.character)) {
          return resolveFromBdd(document, position, token);
        }
      }

      return undefined;
    },
  };

  const bddStepReferenceProvider: vscode.ReferenceProvider = {
    provideReferences: async (document, position, _context, token) => {
      if (document.languageId !== "go") {
        return undefined;
      }

      if (!findPackForBddFile(document.uri)) {
        return undefined;
      }

      return resolveFromBdd(document, position, token);
    },
  };

  const implementationProvider: vscode.ImplementationProvider = {
    provideImplementation: (document, position, token) => {
      if (!isFeatureDocument(document)) {
        return undefined;
      }

      return resolveFromFeature(document, position, token);
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider({ scheme: "file", pattern: "**/*.feature" }, definitionProvider),
    vscode.languages.registerDefinitionProvider({ language: "go", scheme: "file" }, definitionProvider),
    vscode.languages.registerReferenceProvider({ language: "go", scheme: "file" }, bddStepReferenceProvider),
    vscode.languages.registerImplementationProvider({ scheme: "file", pattern: "**/*.feature" }, implementationProvider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cucumberJump.goToPrimaryStepTarget", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isFeatureDocument(editor.document)) {
        return;
      }

      const cts = new vscode.CancellationTokenSource();
      try {
        const locations = await resolveFromFeature(editor.document, editor.selection.active, cts.token);
        if (!locations || locations.length === 0) {
          await vscode.window.showInformationMessage("Cucumber Jump: no step definition found for this line.");
          return;
        }

        const primary = locations[0];
        await showTextDocumentRevealAtTop(primary.uri, { selection: primary.range, preview: false });
      } finally {
        cts.dispose();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand("cucumberJump.goToStepRegistry", async (editor) => {
      const cts = new vscode.CancellationTokenSource();
      try {
        const loc = await resolveRegistryOnly(editor.document, editor.selection.active, cts.token);
        if (loc) {
          await showTextDocumentRevealAtTop(loc.uri, { selection: loc.range });
        }
      } finally {
        cts.dispose();
      }
    }),
    vscode.commands.registerTextEditorCommand("cucumberJump.goToImplementation", async (editor) => {
      const cts = new vscode.CancellationTokenSource();
      try {
        const loc = await resolveImplementationOnly(editor.document, editor.selection.active, cts.token);
        if (loc) {
          await showTextDocumentRevealAtTop(loc.uri, { selection: loc.range });
        }
      } finally {
        cts.dispose();
      }
    }),
  );

  const invalidate = (uri: vscode.Uri) => {
    invalidateDocument(uri);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === "go" || isFeatureDocument(e.document)) {
        invalidate(e.document.uri);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "go" || isFeatureDocument(doc)) {
        invalidate(doc.uri);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cucumberJump")) {
        invalidateAll();
      }
    }),
  );
}

export function deactivate(): void {
  invalidateAll();
}

function isFeatureDocument(document: vscode.TextDocument): boolean {
  return document.uri.fsPath.toLowerCase().endsWith(".feature");
}
