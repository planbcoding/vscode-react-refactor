import * as vscode from "vscode";
import * as path from "path";
import traverse, { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { pickBy } from "lodash";
import LinesAndColumns from "lines-and-columns";
import {
    isJSX,
    jsxToAst,
    codeToAst,
    codeFromNode,
    isPathInRange,
    isPathRemoved,
    isFunctionBinding,
    findComponentMemberReferences
} from "../ast";
import {
    askForName,
    generateClassComponent,
    generatePureComponent
} from "../utils";

/**
 * Extract code to function action
 */
export const extractToFunction = async () => {
    const editor = vscode.window.activeTextEditor;
    try {
        await extractAndReplaceSelection(editor);
        await vscode.commands.executeCommand("editor.action.formatDocument");
        resetSelection(editor);
    } catch (error) {
        vscode.window.showErrorMessage(error);
    }
};

/**
 * Extract code to file action
 */
export const extractToFile = async () => {
    const editor = vscode.window.activeTextEditor;

    try {
        const result = await extractAndReplaceSelection(editor, true);
        const document = editor.document;

        const documentDir = path.dirname(editor.document.fileName);
        const watcher = vscode.workspace.createFileSystemWatcher(
            path.join(documentDir, "*.{js,jsx,ts,tsx}")
        );

        const disposable = watcher.onDidCreate(async uri => {
            disposable.dispose();
            await vscode.commands.executeCommand(
                "editor.action.formatDocument"
            );
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
            await vscode.commands.executeCommand(
                "editor.action.formatDocument"
            );
            ensureReactIsImported(vscode.window.activeTextEditor);
        });

        const insertPos = document.positionAt(result.insertAt);
        const cmpLines = result.componentCode.split(/\n/).length;

        const start = new vscode.Position(insertPos.line, 0);
        const end = new vscode.Position(insertPos.line + cmpLines, 0);
        const selection = new vscode.Selection(start, end);

        await executeMoveToNewFileCodeAction(editor.document, selection);
    } catch (error) {
        vscode.window.showErrorMessage(error);
    }
};

const resetSelection = (editor: vscode.TextEditor) => {
    const pos = editor.selection.end;
    editor.selection = new vscode.Selection(pos, pos);
};

/**
 * Check if code action is available
 *
 * @param code
 */
export const isCodeActionAvailable = (code: string): Boolean => {
    return isJSX(code);
};

/**
 * Extract selected JSX to a new React component
 *
 * @param editor
 * @param produceClass
 */
const extractAndReplaceSelection = async (
    editor: vscode.TextEditor,
    produceClass: boolean = false
): Promise<RefactorResult> => {
    if (!editor) {
        return;
    }

    const name = await askForName();
    if (!name) {
        return;
    }

    const document = editor.document;
    const selection = editor.selection;
    let documentText = document.getText();

    let [start, end] = getIndexesForSelection(documentText, selection);
    const result = executeCodeAction(
        name,
        documentText,
        start,
        end,
        produceClass
    );
    const insertAtLine = document.positionAt(result.insertAt).line;

    await editor.edit(edit => {
        edit.replace(selection, result.replaceJSXCode);
        edit.insert(
            new vscode.Position(insertAtLine, 0),
            result.componentCode + "\n\n"
        );
    });
    return result;
};

/**
 * Execute otb code action provided by TypeScript language server
 *
 * @param document
 * @param rangeOrSelection
 */
const executeMoveToNewFileCodeAction = (
    document: vscode.TextDocument,
    rangeOrSelection: vscode.Range | vscode.Selection
) => {
    const codeAction = "Move to a new file";
    return vscode.commands.executeCommand(
        "_typescript.applyRefactoring",
        document,
        document.fileName,
        codeAction,
        codeAction,
        rangeOrSelection
    );
};

/**
 * Get start and end index of selection or range
 *
 * @param documentText
 * @param selectionOrRange
 */
const getIndexesForSelection = (
    documentText: string,
    selectionOrRange: vscode.Selection
): number[] => {
    const lines = new LinesAndColumns(documentText);
    const { start, end } = selectionOrRange;
    const startIndex = lines.indexForLocation({
        line: start.line,
        column: start.character
    });
    let endIndex = lines.indexForLocation({
        line: end.line,
        column: end.character
    });
    return [startIndex, endIndex];
};

/**
 * Check is React imported to document and if not import
 *
 * @param editor
 */
const ensureReactIsImported = (editor: vscode.TextEditor) => {
    const ast = codeToAst(editor.document.getText());
    let matched;
    traverse(ast, {
        ImportDeclaration(path) {
            if (path.node.source.value === "react") {
                matched = true;
                path.stop();
            }
        }
    });
    if (!matched) {
        editor.edit(edit => {
            edit.insert(
                new vscode.Position(0, 0),
                'import React from "react";\n'
            );
        });
    }
};

/**
 * Extraction Result Type
 */
type RefactorResult = {
    replaceJSXCode: string;
    componentCode: string;
    insertAt: number;
};

/**
 * Execute code action
 *
 * @param name
 * @param code
 * @param start
 * @param end
 * @param produceClass
 */
const executeCodeAction = (
    name: string,
    code: string,
    start: number,
    end: number,
    produceClass: boolean = false
): RefactorResult => {
    let selectionCode = code.substring(start, end);

    if (!isJSX(selectionCode)) {
        throw new Error("Invalid JSX selected;");
    }

    if (!jsxToAst(selectionCode)) {
        selectionCode = `<div>${selectionCode}</div>`;
        code = code.substring(0, start) + selectionCode + code.substring(end);
        end = start + selectionCode.length;
    }

    const ast = codeToAst(code);

    const selectedPath = findSelectedJSXElement(ast, start, end);
    if (!selectedPath) {
        throw new Error("Invalid JSX selected");
    }

    const parentPath = findParentComponent(selectedPath);
    const referencePaths = findComponentMemberReferences(
        parentPath,
        selectedPath
    );

    let paths = referencePaths.filter(isPathInRange(start, end));

    const passedProps = {};

    const keyAttribute = copyAndRemoveKeyAttribute(selectedPath);
    if (keyAttribute) {
        passedProps["key"] = keyAttribute;
    }

    const objects = getContainerObjects(paths);

    paths
        .filter(path => !isPathRemoved(path))
        .forEach(path => {
            const expression = codeFromNode(path.node);
            let name, container;

            if (path.isMemberExpression()) {
                if (isFunctionBinding(path)) {
                    path = path.parentPath;
                    name = path.node.callee.object.property.name;
                } else {
                    name = path.node.property.name;
                    container = objects.find(o =>
                        expression.startsWith(o.object)
                    );
                }
            } else {
                name = path.node.name;
            }

            if (container) {
                name = matchRouteInObject(container, expression);
                if (!passedProps[container.property]) {
                    passedProps[container.property] = t.identifier(
                        container.object
                    );
                }
            } else {
                name = ensurePropertyIsUnique(passedProps, name, expression);
                if (!passedProps[name]) {
                    passedProps[name] = t.cloneDeep(path.node);
                }
            }

            path.replaceWith(createPropsExpression(produceClass, name));
        });

    const extractedJSX = codeFromNode(selectedPath.node);
    const createComponent = produceClass
        ? generateClassComponent
        : generatePureComponent;
    const replaceJSXCode = codeFromNode(createJSXElement(name, passedProps));
    const componentCode = createComponent(name, extractedJSX);
    const insertAt = getComponentStartAt(parentPath);

    return {
        replaceJSXCode,
        componentCode,
        insertAt
    };
};

/**
 * Find parent component class or arrow function declarator
 *
 * @param path
 */
const findParentComponent = (path: NodePath) => {
    const parentPath = path.findParent(
        path =>
            path.isClassDeclaration() ||
            path.isVariableDeclarator() ||
            path.isFunctionDeclaration()
    );
    if (!parentPath) {
        throw new Error("Invalid component");
    }
    return parentPath;
};

/**
 * Find the frist path in a range
 * @param ast
 * @param start
 * @param end
 */
const findSelectedJSXElement = (ast, start, end) => {
    let selectedPath;
    traverse(ast, {
        JSXElement(path) {
            if (path.node.start >= start && path.node.end <= end) {
                selectedPath = path;
                path.stop();
            }
        }
    });
    return selectedPath;
};

/**
 * Find common container objects from a list of member expressions
 * @param paths
 */
const getContainerObjects = (
    paths: NodePath[]
): { object: string; property: string }[] => {
    let objectMap = {};
    paths
        .filter(
            path =>
                (t.isMemberExpression(path.node) &&
                    !t.isThisExpression(path.node.object)) ||
                !t.isMemberExpression(path.node)
        )
        .forEach(path => {
            const object = codeFromNode(
                t.isMemberExpression(path.node) ? path.node.object : path.node
            );
            objectMap[object] = objectMap[object] || 0;
            objectMap[object]++;
        });
    objectMap = pickBy(objectMap, (val, key) => val > 1 && !isPropsObject(key));
    objectMap = pickBy(
        objectMap,
        (val, key) => !objectMap[key.slice(0, key.lastIndexOf("."))]
    );
    return Object.keys(objectMap).map(object => ({
        object,
        property: object.slice(object.lastIndexOf(".") + 1)
    }));
};

const getComponentStartAt = path => {
    if (path.node.leadingComments && path.node.leadingComments.length) {
        return path.node.leadingComments[0].start;
    }
    return path.node.start;
};

const ensurePropertyIsUnique = (propsMap: {}, name: string, value: any) => {
    if (!propsMap[name] || codeFromNode(propsMap[name]) === value) {
        return name;
    }
    return ensurePropertyIsUnique(propsMap, `_${name}`, value);
};

const matchRouteInObject = (
    object: { object: string; property: string },
    childObject
) =>
    [object.property, childObject.slice(object.object.length + 1)]
        .filter(o => !!o)
        .join(".");

const isPropsObject = (expressionCode: string) =>
    expressionCode === "this.props" ||
    expressionCode === "this.state" ||
    expressionCode === "props";

const createPropsExpression = (produceClass, propertyName: string) =>
    produceClass
        ? t.memberExpression(
              t.memberExpression(t.thisExpression(), t.identifier("props")),
              t.identifier(propertyName)
          )
        : t.memberExpression(t.identifier("props"), t.identifier(propertyName));

const createJSXElement = (name: string, attributes: {}) => {
    const jsxElement = t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier(name), []),
        t.jsxClosingElement(t.jsxIdentifier(name)),
        [],
        true
    );
    Object.keys(attributes).forEach(id => {
        jsxElement.openingElement.attributes.push(
            t.jsxAttribute(
                t.jsxIdentifier(id),
                t.jsxExpressionContainer(attributes[id])
            )
        );
    });
    return jsxElement;
};

const copyAndRemoveKeyAttribute = (jsxElementPath: any) => {
    if (!jsxElementPath.isJSXElement()) {
        return;
    }
    const openingElement = jsxElementPath.node.openingElement;
    let keyAttributePath;
    jsxElementPath.traverse({
        JSXAttribute(path) {
            if (
                path.node.name.name === "key" &&
                path.parentPath.node === openingElement
            ) {
                keyAttributePath = path;
            }
        }
    });
    if (keyAttributePath) {
        const value = t.cloneDeep(keyAttributePath.node.value.expression);
        keyAttributePath.remove();
        return value;
    }
};
