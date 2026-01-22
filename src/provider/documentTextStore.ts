import * as vscode from "vscode";

type DocState = { lastText: string; previousText?: string };

export class DocumentTextStore {
  private readonly byUri = new Map<string, DocState>();

  track(doc: vscode.TextDocument) {
    if (this.byUri.has(doc.uri.toString())) return;
    this.byUri.set(doc.uri.toString(), { lastText: doc.getText() });
  }

  onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    const uri = e.document.uri.toString();
    const state = this.byUri.get(uri);
    const newText = e.document.getText();

    if (!state) {
      this.byUri.set(uri, { lastText: newText });
      return;
    }

    state.previousText = state.lastText;
    state.lastText = newText;
  }

  getPreviousText(doc: vscode.TextDocument): string | undefined {
    return this.byUri.get(doc.uri.toString())?.previousText;
  }
}

