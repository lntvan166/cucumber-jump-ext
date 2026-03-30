import * as vscode from "vscode";

const STORAGE_DISMISS_KEY = "cucumberJump.dismiss_conflict_extensions_hint";

/**
 * Other extensions that register definition/navigation on `.feature` steps; VS Code merges results with Cucumber Jump.
 */
const CONFLICT_EXTENSION_IDS: readonly string[] = [
  "alexkrechik.cucumberautocomplete",
  "CucumberOpen.cucumber-official",
];

function installedConflictExtensionLabels(): string[] {
  const labels: string[] = [];

  for (const id of CONFLICT_EXTENSION_IDS) {
    const ext = vscode.extensions.getExtension(id);
    if (!ext) {
      continue;
    }

    const display = ext.packageJSON?.displayName ?? id;
    labels.push(String(display));
  }

  return labels;
}

async function showConflictHintMessage(context: vscode.ExtensionContext, labelText: string): Promise<void> {
  if (context.globalState.get(STORAGE_DISMISS_KEY) === true) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `Cucumber Jump: "${labelText}" also handles step navigation on .feature files. VS Code merges those providers with Cucumber Jump, so Ctrl+click may show multiple or wrong targets. Use F12 (Go to primary step target) for this extension only, or disable the other extension for this workspace.`,
    "Don't show again",
    "Cucumber Jump settings",
  );

  if (choice === "Don't show again") {
    await context.globalState.update(STORAGE_DISMISS_KEY, true);

    return;
  }

  if (choice === "Cucumber Jump settings") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:lntvan166.cucumber-jump-ext");
  }
}

/**
 * Defer slightly so startup toasts from other extensions do not stack as harshly.
 */
export function scheduleConflictingExtensionHint(context: vscode.ExtensionContext): void {
  const jumpCfg = vscode.workspace.getConfiguration("cucumberJump");
  if (jumpCfg.get<boolean>("notifyConflictingExtensions", true) === false) {
    return;
  }

  if (context.globalState.get(STORAGE_DISMISS_KEY) === true) {
    return;
  }

  const labels = installedConflictExtensionLabels();
  if (labels.length === 0) {
    return;
  }

  const labelText = labels.join(", ");
  setTimeout(() => {
    void showConflictHintMessage(context, labelText);
  }, 2000);
}
