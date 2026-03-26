import * as vscode from "vscode";

function isTextDocument(value: vscode.TextDocument | vscode.Uri): value is vscode.TextDocument {
  return "getText" in value && typeof (value as vscode.TextDocument).getText === "function";
}

/**
 * Opens the document like {@link vscode.window.showTextDocument}, then scrolls so the
 * target selection sits at the top of the viewport (avoids centering like the default).
 */
export async function showTextDocumentRevealAtTop(
  document: vscode.TextDocument | vscode.Uri,
  options: vscode.TextDocumentShowOptions,
): Promise<vscode.TextEditor> {
  const editor = isTextDocument(document)
    ? await vscode.window.showTextDocument(document, options)
    : await vscode.window.showTextDocument(document, options);
  const rangeToReveal = options.selection ?? editor.selection;
  editor.revealRange(rangeToReveal, vscode.TextEditorRevealType.AtTop);
  return editor;
}
