import * as vscode from "vscode";
import {
  autoConfigureEnabled,
  getWorkspaceFolderForUri,
  readPackConfigs,
  type PackConfig,
} from "./config";
import { isFeatureUri, parseStepLine } from "./featureParser";
import {
  clearInference,
  getInferredProposals,
  hasInferenceRun,
  primeInference,
  scanWorkspace,
} from "./inferredConfig";
import type { ScanProposal } from "./configScanner";

const DISMISSED_KEY = "cucumberJump.onboarding.dismissed";
const WALKTHROUGH_ID = "lntvan166.cucumber-jump-ext#cucumberJump.gettingStarted";
const offeredThisSession = new Set<string>();

function hasExplicitConfig(): boolean {
  const { projects, libraries } = readPackConfigs();
  return projects.length > 0 || libraries.length > 0;
}

function packsFromProposals(proposals: ScanProposal[]): PackConfig[] {
  return proposals.map((p) => ({ name: p.name, featureGlob: p.featureGlob, stepsGlob: p.stepsGlob }));
}

async function writeProjectsToSettings(folder: vscode.WorkspaceFolder, packs: PackConfig[]): Promise<void> {
  const config = vscode.workspace.getConfiguration("cucumberJump", folder.uri);
  const existing = config.get<PackConfig[]>("projects") ?? [];
  const existingGlobs = new Set(existing.map((p) => p.featureGlob));
  const additions = packs.filter((p) => !existingGlobs.has(p.featureGlob));
  if (additions.length === 0) {
    void vscode.window.showInformationMessage("Cucumber Jump: settings already cover these projects.");
    return;
  }
  try {
    await config.update("projects", [...existing, ...additions], vscode.ConfigurationTarget.Workspace);
    void vscode.window.showInformationMessage(
      `Cucumber Jump: saved ${additions.length} project(s) to .vscode/settings.json.`,
    );
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Cucumber Jump: could not write settings (${err}). Add this to .vscode/settings.json manually: ` +
        JSON.stringify({ "cucumberJump.projects": additions }),
    );
  }
}

/** Open the first feature the pack matches and jump, so the user sees it work. */
async function demonstrateJump(folder: vscode.WorkspaceFolder, pack: PackConfig): Promise<void> {
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, pack.featureGlob), "**/node_modules/**", 1);
  if (files.length === 0) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument(files[0]);
  const lines = doc.getText().split(/\r?\n/);
  const stepLine = lines.findIndex((l) => Boolean(parseStepLine(l)));
  if (stepLine === -1) {
    return;
  }
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const pos = new vscode.Position(stepLine, lines[stepLine].length);
  editor.selection = new vscode.Selection(pos, pos);
  await vscode.commands.executeCommand("cucumberJump.goToPrimaryStepTarget");
}

async function pickScanFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showInformationMessage("Cucumber Jump: open a folder first.");
    return undefined;
  }
  const active = vscode.window.activeTextEditor;
  if (active) {
    const f = getWorkspaceFolderForUri(active.document.uri);
    if (f) {
      return f;
    }
  }
  if (folders.length === 1) {
    return folders[0];
  }
  return vscode.window.showWorkspaceFolderPick({ placeHolder: "Scan which folder for Cucumber projects?" });
}

async function createConfiguration(): Promise<void> {
  const folder = await pickScanFolder();
  if (!folder) {
    return;
  }

  const proposals = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Cucumber Jump: scanning workspace…", cancellable: true },
    (_progress, token) => scanWorkspace(folder, token),
  );

  if (proposals.length === 0) {
    const pick = await vscode.window.showInformationMessage(
      "Cucumber Jump: no matching feature/step-definition pairs found. Insert a template to fill in?",
      "Insert template",
    );
    if (pick === "Insert template") {
      await writeProjectsToSettings(folder, [
        { name: "example", featureGlob: "path/to/features/**/*.feature", stepsGlob: "path/to/steps/**/*.ts" },
      ]);
      await vscode.commands.executeCommand("workbench.action.openWorkspaceSettingsFile");
    }
    return;
  }

  type Item = vscode.QuickPickItem & { proposal: ScanProposal };
  const items: Item[] = proposals.map((p) => ({
    label: `${p.name} (${p.language})`,
    description: `${p.matchedSteps}/${p.totalSteps} steps matched`,
    detail: `${p.featureGlob} → ${p.stepsGlob}`,
    picked: true,
    proposal: p,
  }));
  const chosen = await vscode.window.showQuickPick(items, {
    title: "Cucumber Jump · detected projects",
    placeHolder: "These will be written to .vscode/settings.json",
    canPickMany: true,
  });
  if (!chosen || chosen.length === 0) {
    return;
  }

  const packs = packsFromProposals(chosen.map((c) => c.proposal));
  await writeProjectsToSettings(folder, packs);
  clearInference();
  await demonstrateJump(folder, packs[0]);
}

async function rescanWorkspace(): Promise<void> {
  const folder = await pickScanFolder();
  if (!folder) {
    return;
  }
  clearInference();
  if (hasExplicitConfig()) {
    void vscode.window.showInformationMessage(
      "Cucumber Jump: explicit settings are configured — they take precedence. Use 'Create configuration' to add detected projects.",
    );
    return;
  }
  const proposals = await primeInference(folder);
  void vscode.window.showInformationMessage(
    `Cucumber Jump: rescan found ${proposals.length} project(s). Navigation uses them automatically.`,
  );
}

async function maybeOfferSetup(context: vscode.ExtensionContext, doc: vscode.TextDocument): Promise<void> {
  if (!isFeatureUri(doc.uri) || !autoConfigureEnabled() || hasExplicitConfig()) {
    return;
  }
  const folder = getWorkspaceFolderForUri(doc.uri);
  if (!folder) {
    return;
  }

  const alreadyRan = hasInferenceRun(folder);
  const proposals = alreadyRan ? getInferredProposals(folder) : await primeInference(folder);

  if (context.workspaceState.get<boolean>(DISMISSED_KEY) || offeredThisSession.has(folder.uri.toString())) {
    return;
  }
  offeredThisSession.add(folder.uri.toString());

  if (proposals.length > 0) {
    const pick = await vscode.window.showInformationMessage(
      `Cucumber Jump configured itself — ${proposals.length} project(s) detected. F12 on a step already works.`,
      "Save to settings",
      "Adjust…",
      "Don't ask again",
    );
    if (pick === "Save to settings") {
      await writeProjectsToSettings(folder, packsFromProposals(proposals));
    } else if (pick === "Adjust…") {
      await vscode.commands.executeCommand("cucumberJump.createConfiguration");
    } else if (pick === "Don't ask again") {
      await context.workspaceState.update(DISMISSED_KEY, true);
    }
  } else {
    const pick = await vscode.window.showInformationMessage(
      "Cucumber Jump couldn't detect step definitions for this workspace.",
      "Set up manually",
      "Open walkthrough",
      "Don't ask again",
    );
    if (pick === "Set up manually") {
      await vscode.commands.executeCommand("cucumberJump.createConfiguration");
    } else if (pick === "Open walkthrough") {
      await vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH_ID);
    } else if (pick === "Don't ask again") {
      await context.workspaceState.update(DISMISSED_KEY, true);
    }
  }
}

export function registerOnboarding(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cucumberJump.createConfiguration", () => void createConfiguration()),
    vscode.commands.registerCommand("cucumberJump.rescanWorkspace", () => void rescanWorkspace()),
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (e) {
        void maybeOfferSetup(context, e.document);
      }
    }),
  );

  if (vscode.window.activeTextEditor) {
    void maybeOfferSetup(context, vscode.window.activeTextEditor.document);
  }
}
