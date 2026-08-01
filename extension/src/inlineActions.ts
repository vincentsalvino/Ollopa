/**
 * Phase 2B — inline AI assistance commands.
 *
 * - `ollopa.explainSelection`: send the current editor selection to the
 *   sidecar and show the explanation in an info message + a new untitled
 *   markdown doc (so the user can copy/paste).
 * - `ollopa.refactorSelection`: ask the sidecar for a refactor; show the
 *   suggestion in a new untitled doc with a one-click "Apply" command.
 *
 * Both commands round-trip through the sidecar's `inline_request` /
 * `inline_reply` WS messages. No temp workspace, no tools, no agent loop.
 *
 * Ponytail: keep selection caps small, default behaviour simple. No
 * streaming (single round-trip), no caching across calls (selection is
 * small and per-call). Add caching if user reports repeated calls.
 */
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { SidecarManager, SidecarEvent } from './sidecarManager';

export interface InlineReplyMessage {
  kind: 'inline_reply';
  taskId: string;
  mode: 'explain' | 'refactor';
  output: string;
  edit?: { old_str: string; new_str: string } | null;
  error?: string;
}

export function registerInlineCommands(
  context: vscode.ExtensionContext,
  getSidecar: () => SidecarManager | undefined,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('ollopa.explainSelection', () =>
      runInline(getSidecar, 'explain')),
    vscode.commands.registerCommand('ollopa.refactorSelection', () =>
      runInline(getSidecar, 'refactor')),
  ];
}

async function runInline(
  getSidecar: () => SidecarManager | undefined,
  mode: 'explain' | 'refactor',
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Ollopa: no active editor.');
    return;
  }
  const selection = editor.selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(editor.selection);
  if (!selection.trim()) {
    void vscode.window.showWarningMessage('Ollopa: selection is empty.');
    return;
  }
  if (selection.length > 8000) {
    void vscode.window.showWarningMessage('Ollopa: selection too large (>8 KB). Pick a smaller snippet.');
    return;
  }
  const sidecar = getSidecar();
  if (!sidecar) {
    void vscode.window.showErrorMessage('Ollopa: sidecar not running.');
    return;
  }

  const taskId = randomUUID();
  const languageId = editor.document.languageId;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Ollopa: ${mode === 'explain' ? 'Explaining' : 'Refactoring'}…`, cancellable: false },
    () => new Promise<void>((resolve) => {
      const off = sidecar.on((e: SidecarEvent) => {
        if (e.type !== 'message') return;
        const m = e.payload as Record<string, unknown> | null;
        if (!m || m.kind !== 'inline_reply') return;
        if (m.taskId !== taskId) return;
        off();
        if (m.error) {
          void vscode.window.showErrorMessage(`Ollopa ${mode} failed: ${String(m.error)}`);
          resolve();
          return;
        }
        const reply = m as unknown as InlineReplyMessage;
        if (mode === 'refactor') {
          showRefactorResult(editor, selection, reply.output).then(resolve, () => resolve());
        } else {
          showExplainResult(selection, reply.output).then(resolve, () => resolve());
        }
      });
      sidecar.send({
        kind: 'inline_request',
        taskId,
        mode,
        selection,
        language: languageId,
      });
    }),
  );
}

async function showExplainResult(selection: string, output: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: `# Explanation\n\n${output}\n\n---\n\n<details><summary>Selection</summary>\n\n\`\`\`\n${selection}\n\`\`\`\n\n</details>\n`,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  void vscode.window.showInformationMessage('Ollopa: explanation ready.');
}

async function showRefactorResult(
  editor: vscode.TextEditor,
  selection: string,
  output: string,
): Promise<void> {
  const codeBlock = extractFirstCodeBlock(output) ?? output;
  const doc = await vscode.workspace.openTextDocument({
    content: `# Refactor suggestion\n\n\`\`\`${editor.document.languageId}\n${codeBlock}\n\`\`\`\n\n<details><summary>Original</summary>\n\n\`\`\`${editor.document.languageId}\n${selection}\n\`\`\`\n\n</details>\n\nApply? Run "Ollopa: Apply Refactor" from the command palette.\n`,
    language: 'markdown',
  });
  const view = vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  const pick = await vscode.window.showInformationMessage('Ollopa: refactor ready. Apply it?', 'Apply', 'Cancel');
  await view;
  if (pick !== 'Apply') return;
  await editor.edit((eb) => {
    if (editor.selection.isEmpty) {
      const full = editor.document.getText();
      eb.replace(new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(full.length)), codeBlock);
    } else {
      eb.replace(editor.selection, codeBlock);
    }
  });
  void vscode.window.showInformationMessage('Ollopa: refactor applied.');
}

function extractFirstCodeBlock(s: string): string | null {
  const m = s.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
  return m ? m[1].replace(/\n+$/, '') : null;
}