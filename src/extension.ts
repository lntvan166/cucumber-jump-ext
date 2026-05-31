import * as vscode from "vscode";
import { scheduleConflictingExtensionHint } from "./conflictHint";
import { isBddStepDeclarationPosition } from "./bddParser";
import { findPackForBddFile, findPackForStepsFile } from "./config";
import { invalidateDocument, invalidateAll } from "./documentCache";
import { showTextDocumentRevealAtTop } from "./editorNavigate";
import { registerDevMode } from "./devMode";
import { isFeatureUri } from "./featureParser";
import { resolveFromBdd, resolveFromFeature, resolveImplementationOnly, resolveRegistryOnly, resolveFeatureUsagesFromStepsAtPosition } from "./resolver";
import { registerStepUi } from "./stepUi";

/**
 * Selectors for `.feature` Go to Definition (Ctrl+click). Prefer explicit `scheme` per filter:
 * pattern-only / bare `language` selectors have behaved inconsistently in some Cursor builds.
 */
const featureStepDocumentSelector: vscode.DocumentSelector = [
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

/** Bdd map files: scoped `scheme` so registration does not collide broadly with all Go documents. */
const goBddDocumentSelector: vscode.DocumentSelector = [
  { language: "go", scheme: "file" },
  { language: "go", scheme: "vscode-remote" },
];

const adapterStepFileSelector: vscode.DocumentSelector = [
  { language: "java", scheme: "file" },
  { language: "java", scheme: "vscode-remote" },
  { language: "kotlin", scheme: "file" },
  { language: "kotlin", scheme: "vscode-remote" },
  { language: "python", scheme: "file" },
  { language: "python", scheme: "vscode-remote" },
  { language: "javascript", scheme: "file" },
  { language: "javascript", scheme: "vscode-remote" },
  { language: "typescript", scheme: "file" },
  { language: "typescript", scheme: "vscode-remote" },
  { language: "ruby", scheme: "file" },
  { language: "ruby", scheme: "vscode-remote" },
  { language: "csharp", scheme: "file" },
  { language: "csharp", scheme: "vscode-remote" },
  { language: "dart", scheme: "file" },
  { language: "dart", scheme: "vscode-remote" },
  { language: "go", scheme: "file" },
  { language: "go", scheme: "vscode-remote" },
];

function logDefinitionProviderError(err: unknown): void {
  console.error("Cucumber Jump: provideDefinition failed", err);
}

export function activate(context: vscode.ExtensionContext): void {
  registerStepUi(context);
  registerDevMode(context);
  scheduleConflictingExtensionHint(context);
  const definitionProvider: vscode.DefinitionProvider = {
    provideDefinition: async (document, position, token) => {
      try {
        if (isFeatureDocument(document)) {
          return await resolveFromFeature(document, position, token);
        }

        if (document.languageId === "go" && findPackForBddFile(document.uri)) {
          const text = document.getText();
          if (isBddStepDeclarationPosition(text, position.line, position.character)) {
            return await resolveFromBdd(document, position, token);
          }
        }
      } catch (err) {
        logDefinitionProviderError(err);
      }

      return undefined;
    },
  };

  const bddStepReferenceProvider: vscode.ReferenceProvider = {
    provideReferences: async (document, position, _context, token) => {
      try {
        if (document.languageId !== "go") {
          return undefined;
        }

        if (!findPackForBddFile(document.uri)) {
          return undefined;
        }

        return await resolveFromBdd(document, position, token);
      } catch (err) {
        logDefinitionProviderError(err);
        return undefined;
      }
    },
  };

  const implementationProvider: vscode.ImplementationProvider = {
    provideImplementation: async (document, position, token) => {
      if (!isFeatureDocument(document)) {
        return undefined;
      }

      try {
        return await resolveFromFeature(document, position, token);
      } catch (err) {
        logDefinitionProviderError(err);
        return undefined;
      }
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(featureStepDocumentSelector, definitionProvider),
    vscode.languages.registerDefinitionProvider(goBddDocumentSelector, definitionProvider),
    vscode.languages.registerReferenceProvider(goBddDocumentSelector, bddStepReferenceProvider),
    vscode.languages.registerImplementationProvider(featureStepDocumentSelector, implementationProvider),
  );

  // Reverse navigation for new-path step files (no bddFile): step definition → .feature usages
  const adapterStepDefinitionProvider: vscode.DefinitionProvider = {
    provideDefinition: async (document, position, token) => {
      try {
        const match = findPackForStepsFile(document.uri);
        if (!match || match.entry.pack.bddFile) {
          return undefined;
        }
        return await resolveFeatureUsagesFromStepsAtPosition(document, position, token);
      } catch (err) {
        logDefinitionProviderError(err);
        return undefined;
      }
    },
  };

  const adapterStepReferenceProvider: vscode.ReferenceProvider = {
    provideReferences: async (document, position, _ctx, token) => {
      try {
        const match = findPackForStepsFile(document.uri);
        if (!match || match.entry.pack.bddFile) {
          return undefined;
        }
        return await resolveFeatureUsagesFromStepsAtPosition(document, position, token);
      } catch (err) {
        logDefinitionProviderError(err);
        return undefined;
      }
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(adapterStepFileSelector, adapterStepDefinitionProvider),
    vscode.languages.registerReferenceProvider(adapterStepFileSelector, adapterStepReferenceProvider),
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
      if (e.document.languageId === "go" || isFeatureDocument(e.document) || Boolean(findPackForStepsFile(e.document.uri))) {
        invalidate(e.document.uri);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "go" || isFeatureDocument(doc) || Boolean(findPackForStepsFile(doc.uri))) {
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
  return isFeatureUri(document.uri);
}
