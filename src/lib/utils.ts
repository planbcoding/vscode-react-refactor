import * as vscode from "vscode";

export const askForName = async () => {
    const name = await vscode.window.showInputBox({
        prompt: "Component name"
    });
    if (!name) {
        return false;
    }
    return normalizeComponentName(name);
};

export const normalizeComponentName = (name: string) =>
    name
        .split(/[\s-_]+/)
        .map(capitalizeFirstLetter)
        .join("");

export const capitalizeFirstLetter = string =>
    string.charAt(0).toUpperCase() + string.slice(1);

export const lowerCaseFirstLetter = string =>
    string.charAt(0).toLowerCase() + string.slice(1);

export const generateClassComponent = (name: string, renderCode: string): string => `
class ${name} extends React.Component {
    constructor(props) {
        super(props);
    }

    render() {
        return (
            ${renderCode}
        );
    }
}
`;

export const generatePureComponent = (name: string, renderCode: string): string => `
const ${name} = (${renderCode.match(/props/) ? "props" : ""}) => (
    ${renderCode}
);
`;
