import * as vscode from "vscode";
import * as extractJSX from "./lib/code-actions/extract-jsx";

export class CodeActionProvider implements vscode.CodeActionProvider {
    public provideCodeActions(): vscode.Command[] {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            return [];
        }
        const selectedText = editor.document.getText(editor.selection);
        const codeActions = [];
        if (extractJSX.isCodeActionAvailable(selectedText)) {
            codeActions.push({
                command: "extension.react-refactor.extractToFunction",
                title: "Extract JSX to Functional Component"
            });
            codeActions.push({
                command: "extension.react-refactor.extractToClass",
                title: "Extract JSX to Class Component"
            });
        }
        return codeActions;
    }
}

export const activate = (context: vscode.ExtensionContext) => {
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { pattern: "**/*.{js,jsx,ts,tsx}", scheme: "file" },
            new CodeActionProvider()
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "extension.react-refactor.extractToFunction",
            () => extractJSX.extractToComponent()
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "extension.react-refactor.extractToClass",
            () => extractJSX.extractToComponent(true)
        )
    );
};
