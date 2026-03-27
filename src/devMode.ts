import * as vscode from "vscode";
import { findPackForBddFile, findPackForStepsFile, getResolutionChainForFeature } from "./config";
import { showTextDocumentRevealAtTop } from "./editorNavigate";
import { findNearestStepLineIndex, isFeatureUri } from "./featureParser";
import { bddUriForEntry } from "./goImplFinder";
import {
  resolveFeatureUsagesFromStepsAtPosition,
  resolveFromBdd,
  resolveFromFeature,
  resolveImplementationOnly,
  resolveRegistryOnly,
} from "./resolver";
import { isSameLocalFile } from "./sameFileUri";

const CODE_COLUMN = vscode.ViewColumn.One;
const FEATURE_COLUMN = vscode.ViewColumn.Two;

type DevModeSession = {
  featureUri: vscode.Uri;
  codeViewColumn: vscode.ViewColumn;
  featureViewColumn: vscode.ViewColumn;
  lastCodeUri: vscode.Uri;
  disposables: vscode.Disposable[];
};

let session: DevModeSession | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let applyingSync = false;
let devModeStatusItem: vscode.StatusBarItem | undefined;
const devModeFileDecorationEmitter = new vscode.EventEmitter<undefined | vscode.Uri | vscode.Uri[]>();

function devModeDebounceMs(): number {
  return vscode.workspace.getConfiguration("cucumberJump").get<number>("devModeDebounceMs") ?? 200;
}

function featureDisplayName(featureUri: vscode.Uri): string {
  const parts = featureUri.fsPath.split(/[/\\]/);
  const base = parts.pop();

  if (base) {
    return base;
  }

  return ".feature";
}

function refreshDevModeStatusBar(): void {
  if (!devModeStatusItem) {
    return;
  }

  if (!session) {
    devModeStatusItem.backgroundColor = undefined;
    devModeStatusItem.color = undefined;
    devModeStatusItem.hide();
    return;
  }

  const rel = vscode.workspace.asRelativePath(session.featureUri);
  const base = featureDisplayName(session.featureUri);
  devModeStatusItem.text = `$(pinned) DEV · ${base}`;
  devModeStatusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.prominentBackground");
  devModeStatusItem.color = new vscode.ThemeColor("statusBarItem.prominentForeground");
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown("**Cucumber Jump · Dev mode**\n\n");
  md.appendMarkdown(`**Active feature:** \`${rel}\`\n\n`);
  md.appendMarkdown("The paired `.feature` tab gets a **file decoration** (colored marker next to the title).\n\n");
  md.appendMarkdown("Layout: **Go left** · **Feature right**\n\n");
  md.appendMarkdown("Click for actions.");
  devModeStatusItem.tooltip = md;
  devModeStatusItem.show();
}

function positionForNearestStep(doc: vscode.TextDocument, cursorLine: number): vscode.Position | undefined {
  const stepLine = findNearestStepLineIndex(doc.getText(), cursorLine);
  if (stepLine === undefined) {
    return undefined;
  }

  return new vscode.Position(stepLine, 0);
}

function notifyPairedFeatureDecoration(uri: vscode.Uri | undefined): void {
  devModeFileDecorationEmitter.fire(uri);
}

/** True if the paired `.feature` still has a tab in Dev mode’s feature column (not only open elsewhere). */
function isPairedFeatureTabInFeatureColumn(): boolean {
  if (!session) {
    return false;
  }

  for (const group of vscode.window.tabGroups.all) {
    if (group.viewColumn !== session.featureViewColumn) {
      continue;
    }

    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && isSameLocalFile(input.uri, session.featureUri)) {
        return true;
      }
    }
  }

  return false;
}

/** End Dev mode when the paired feature no longer lives in the pinned feature column (e.g. user closed that group). */
function clearDevModeIfPairedFeatureLeftPinnedColumn(): void {
  if (!session || applyingSync) {
    return;
  }

  if (!isPairedFeatureTabInFeatureColumn()) {
    clearSession();
  }
}

async function syncDevModeEditorTitleContexts(): Promise<void> {
  const pairedUriStr = session ? session.featureUri.toString() : "";
  await vscode.commands.executeCommand("setContext", "cucumberJump.devModePairedResource", pairedUriStr);
}

function clearSession(): void {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }

  const previousPairedFeature = session?.featureUri;
  session?.disposables.forEach((d) => d.dispose());
  session = undefined;
  refreshDevModeStatusBar();
  notifyPairedFeatureDecoration(previousPairedFeature);
  void syncDevModeEditorTitleContexts();
}

function scheduleSync(run: () => void | Promise<void>): void {
  if (!session) {
    return;
  }

  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void run();
  }, devModeDebounceMs());
}

async function applyDevModeLayout(
  featureUri: vscode.Uri,
  featureRange: vscode.Range,
  codeUri: vscode.Uri,
  codeRange: vscode.Range,
): Promise<void> {
  const codeDoc = await vscode.workspace.openTextDocument(codeUri);
  await showTextDocumentRevealAtTop(codeDoc, {
    viewColumn: CODE_COLUMN,
    selection: codeRange,
    preview: false,
  });

  const featureDoc = await vscode.workspace.openTextDocument(featureUri);
  await showTextDocumentRevealAtTop(featureDoc, {
    viewColumn: FEATURE_COLUMN,
    selection: featureRange,
    preview: false,
    preserveFocus: true,
  });

  await showTextDocumentRevealAtTop(codeDoc, {
    viewColumn: CODE_COLUMN,
    selection: codeRange,
    preview: false,
  });
}

async function openDevModeFromGoEditorWithFeature(
  featureLocation: vscode.Location,
  goEditor: vscode.TextEditor,
): Promise<void> {
  await applyDevModeLayout(featureLocation.uri, featureLocation.range, goEditor.document.uri, goEditor.selection);
  startSession(featureLocation.uri, {
    codeViewColumn: CODE_COLUMN,
    featureViewColumn: FEATURE_COLUMN,
    lastCodeUri: goEditor.document.uri,
  });
}

async function revealCodeInSession(uri: vscode.Uri, range: vscode.Range, preserveFocus: boolean): Promise<void> {
  if (!session) {
    return;
  }

  const col = session.codeViewColumn;
  const existingInPinned = vscode.window.visibleTextEditors.find(
    (ed) => isSameLocalFile(ed.document.uri, uri) && ed.viewColumn === col,
  );

  if (existingInPinned) {
    await showTextDocumentRevealAtTop(existingInPinned.document, {
      selection: range,
      viewColumn: col,
      preview: false,
      preserveFocus,
    });
    session.lastCodeUri = uri;
    return;
  }

  await showTextDocumentRevealAtTop(uri, {
    selection: range,
    viewColumn: col,
    preview: false,
    preserveFocus,
  });
  session.lastCodeUri = uri;
}

async function revealFeatureInSession(uri: vscode.Uri, range: vscode.Range, preserveFocus: boolean): Promise<void> {
  if (!session) {
    return;
  }

  const col = session.featureViewColumn;
  const existingInPinned = vscode.window.visibleTextEditors.find(
    (ed) => isSameLocalFile(ed.document.uri, uri) && ed.viewColumn === col,
  );

  if (existingInPinned) {
    await showTextDocumentRevealAtTop(existingInPinned.document, {
      selection: range,
      viewColumn: col,
      preview: false,
      preserveFocus,
    });

    return;
  }

  await showTextDocumentRevealAtTop(uri, {
    selection: range,
    viewColumn: col,
    preview: false,
    preserveFocus,
  });
}

async function syncFromEditor(editor: vscode.TextEditor | undefined): Promise<void> {
  if (!editor || !session || applyingSync) {
    return;
  }

  const doc = editor.document;
  const pos = editor.selection.active;
  const cts = new vscode.CancellationTokenSource();

  try {
    if (isSameLocalFile(doc.uri, session.featureUri)) {
      const stepPos = positionForNearestStep(doc, pos.line);
      if (!stepPos) {
        return;
      }

      let loc = await resolveImplementationOnly(doc, stepPos, cts.token);

      if (!loc) {
        loc = await resolveRegistryOnly(doc, stepPos, cts.token);
      }

      if (!loc || !session) {
        return;
      }

      applyingSync = true;

      try {
        await revealCodeInSession(loc.uri, loc.range, true);
      } finally {
        applyingSync = false;
      }

      return;
    }

    if (doc.languageId !== "go") {
      return;
    }

    let locs: vscode.Location[] | undefined;
    const hasBddPack = Boolean(findPackForBddFile(doc.uri));

    if (hasBddPack) {
      locs = await resolveFromBdd(doc, pos, cts.token);
    }

    if (!hasBddPack && findPackForStepsFile(doc.uri)) {
      locs = await resolveFeatureUsagesFromStepsAtPosition(doc, pos, cts.token);
    }

    if (!session) {
      return;
    }

    const activeSession = session;

    if (!locs || locs.length === 0) {
      return;
    }

    const pick = locs.find((l) => isSameLocalFile(l.uri, activeSession.featureUri));

    if (!pick) {
      return;
    }

    if (!isPairedFeatureTabInFeatureColumn()) {
      clearSession();
      return;
    }

    applyingSync = true;

    try {
      await revealFeatureInSession(activeSession.featureUri, pick.range, true);
    } finally {
      applyingSync = false;
    }
  } finally {
    cts.dispose();
  }
}

function startSession(
  featureUri: vscode.Uri,
  layout: { codeViewColumn: vscode.ViewColumn; featureViewColumn: vscode.ViewColumn; lastCodeUri: vscode.Uri },
): void {
  clearSession();

  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!session || applyingSync) {
        return;
      }

      scheduleSync(() => syncFromEditor(e.textEditor));
    }),
  );

  disposables.push(
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (!session || applyingSync || !e) {
        return;
      }

      scheduleSync(() => syncFromEditor(e));
    }),
  );

  disposables.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (!session) {
        return;
      }

      if (!isFeatureUri(doc.uri)) {
        return;
      }

      if (!isSameLocalFile(doc.uri, session.featureUri)) {
        return;
      }

      queueMicrotask(() => clearSession());
    }),
  );

  disposables.push(
    vscode.window.tabGroups.onDidChangeTabs(() => {
      if (!session || applyingSync) {
        return;
      }

      queueMicrotask(() => clearDevModeIfPairedFeatureLeftPinnedColumn());
    }),
  );

  session = {
    featureUri,
    codeViewColumn: layout.codeViewColumn,
    featureViewColumn: layout.featureViewColumn,
    lastCodeUri: layout.lastCodeUri,
    disposables,
  };
  refreshDevModeStatusBar();
  notifyPairedFeatureDecoration(session.featureUri);
  void syncDevModeEditorTitleContexts();
}

export async function toggleDevMode(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isFeatureUri(editor.document.uri)) {
    await vscode.window.showInformationMessage("Cucumber Jump: open a .feature file first.");
    return;
  }

  if (session && isSameLocalFile(session.featureUri, editor.document.uri)) {
    clearSession();
    return;
  }

  await openDevMode();
}

export async function openDevMode(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    await vscode.window.showInformationMessage("Cucumber Jump: open a .feature or Go step file first.");
    return;
  }

  const doc = editor.document;
  const cts = new vscode.CancellationTokenSource();

  try {
    if (isFeatureUri(doc.uri)) {
      const chain = getResolutionChainForFeature(doc.uri);
      if (chain.length === 0) {
        await vscode.window.showInformationMessage(
          "Cucumber Jump: no cucumberJump config matches this .feature file.",
        );
        return;
      }

      let primary: vscode.Location | undefined;
      const stepPos = positionForNearestStep(doc, editor.selection.active.line);

      if (stepPos) {
        const locs = await resolveFromFeature(doc, stepPos, cts.token);
        if (locs && locs.length > 0) {
          primary = locs[0];
        }
      }

      if (!primary) {
        try {
          const bddUri = bddUriForEntry(chain[0], doc.uri);
          await vscode.workspace.fs.stat(bddUri);
          const start = new vscode.Position(0, 0);
          primary = new vscode.Location(bddUri, new vscode.Range(start, start));
        } catch {
          await vscode.window.showInformationMessage(
            "Cucumber Jump: could not open bdd.go for this feature; check cucumberJump.projects / libraries.",
          );
          return;
        }
      }

      await applyDevModeLayout(doc.uri, editor.selection, primary.uri, primary.range);
      startSession(doc.uri, {
        codeViewColumn: CODE_COLUMN,
        featureViewColumn: FEATURE_COLUMN,
        lastCodeUri: primary.uri,
      });
      return;
    }

    if (doc.languageId !== "go") {
      await vscode.window.showInformationMessage(
        "Cucumber Jump: Dev mode starts from a .feature file or a Go bdd/steps file.",
      );
      return;
    }

    const hasBddPack = Boolean(findPackForBddFile(doc.uri));
    let goDevLocs: vscode.Location[] | undefined;

    if (hasBddPack) {
      goDevLocs = await resolveFromBdd(doc, editor.selection.active, cts.token);
    }

    if (!hasBddPack && findPackForStepsFile(doc.uri)) {
      goDevLocs = await resolveFeatureUsagesFromStepsAtPosition(doc, editor.selection.active, cts.token);
    }

    if (goDevLocs && goDevLocs.length > 0) {
      await openDevModeFromGoEditorWithFeature(goDevLocs[0], editor);
      return;
    }

    await vscode.window.showInformationMessage(
      "Cucumber Jump: could not resolve a .feature line from this Go position (use a bdd step line or *_steps.go inside a handler).",
    );
  } finally {
    cts.dispose();
  }
}

async function runDevModeStatusBarAction(): Promise<void> {
  if (!session) {
    await vscode.window.showInformationMessage("Cucumber Jump: Dev mode is not active.");
    return;
  }

  type ActionId = "feature" | "code" | "close";

  const items: (vscode.QuickPickItem & { action: ActionId })[] = [
    {
      label: "$(file) Focus feature (right)",
      description: vscode.workspace.asRelativePath(session.featureUri),
      action: "feature",
    },
    {
      label: "$(code) Focus Go / step file (left)",
      description: vscode.workspace.asRelativePath(session.lastCodeUri),
      action: "code",
    },
    {
      label: "$(close) Close Dev mode",
      action: "close",
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: "Cucumber Jump · Dev mode",
    placeHolder: "Choose an action",
  });

  if (!picked) {
    return;
  }

  if (picked.action === "close") {
    clearSession();
    return;
  }

  if (picked.action === "feature") {
    const fd = await vscode.workspace.openTextDocument(session.featureUri);
    await showTextDocumentRevealAtTop(fd, { viewColumn: session.featureViewColumn, preview: false });
    notifyPairedFeatureDecoration(session.featureUri);
    return;
  }

  const cd = await vscode.workspace.openTextDocument(session.lastCodeUri);
  await showTextDocumentRevealAtTop(cd, { viewColumn: session.codeViewColumn, preview: false });
}

export function registerDevMode(context: vscode.ExtensionContext): void {
  void syncDevModeEditorTitleContexts();

  devModeStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 120);
  devModeStatusItem.command = "cucumberJump.devModeStatusBarAction";

  const fileDecorationProvider: vscode.FileDecorationProvider = {
    onDidChangeFileDecorations: devModeFileDecorationEmitter.event,
    provideFileDecoration(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.FileDecoration | undefined {
      if (!session) {
        return undefined;
      }

      if (!isSameLocalFile(uri, session.featureUri)) {
        return undefined;
      }

      const rel = vscode.workspace.asRelativePath(session.featureUri);
      const base = featureDisplayName(session.featureUri);

      return new vscode.FileDecoration(
        "●",
        `Cucumber Jump · Dev mode paired feature\n${base}\n${rel}`,
        new vscode.ThemeColor("charts.purple"),
      );
    },
  };

  context.subscriptions.push(
    devModeStatusItem,
    vscode.window.registerFileDecorationProvider(fileDecorationProvider),
    devModeFileDecorationEmitter,
    vscode.commands.registerCommand("cucumberJump.openDevMode", () => void openDevMode()),
    vscode.commands.registerCommand("cucumberJump.toggleDevMode", () => void toggleDevMode()),
    vscode.commands.registerCommand("cucumberJump.closeDevMode", () => {
      clearSession();
    }),
    vscode.commands.registerCommand("cucumberJump.devModeStatusBarAction", () => void runDevModeStatusBarAction()),
    { dispose: () => clearSession() },
  );
}
