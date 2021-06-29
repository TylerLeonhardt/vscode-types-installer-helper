// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TypesInstaller } from './typesInstaller';

// The things we care about in a package.json
interface PackageJson {
	name: string;
	types?: string;
	dependencies?: { [key: string]: string };
	devDependencies?: { [key: string]: string };
}

// Not perfect but should work for a lot of scenarios
async function shouldMark(nodeModulePath: vscode.Uri, mainPackageJson: PackageJson, targetPackage: string) {
	// if there is already a types package installed
	const possibleTypesName = `@types/${targetPackage}`;
	if (mainPackageJson.devDependencies?.[possibleTypesName]) {
		return false;
	}

	// if the module's package.json declares types
	try {
		const nodeModulePackageJson: PackageJson = require(nodeModulePath.fsPath);
		if (nodeModulePackageJson.types) {
			return false;
		}
	} catch (e) {
		// ignore
	}

	// if the module's folder contains an index.d.ts file
	const files = await vscode.workspace.findFiles(`node_modules/${targetPackage}/index.d.ts`);
	return !files.length;
}

async function getDiagnostics(doc: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
	const text = doc.getText();
	const diagnostics = new Array<vscode.Diagnostic>();

	let packageJson: PackageJson;
	try {
		packageJson = JSON.parse(text);
	} catch(e) {
		return diagnostics;
	}

	const textArr: string[] = text.split(/\r\n|\n/);
	const indexOfFirstDep = textArr.findIndex((value: string) => new RegExp(`\s*"dependencies"`).test(value)) + 1;

	if(indexOfFirstDep !== -1) {
		let i = indexOfFirstDep;
		while (textArr.length > i && !/\s*}/.test(textArr[i])) {
			const arr = /\s*"(.*)"\s*:/.exec(textArr[i]);
			if(!arr) {
				i++;
				continue;
			}
			const key = arr[1];
			const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
			const nodeModulePath = vscode.Uri.joinPath(folder!.uri, 'node_modules', key);

			const typesPackageName = `@types/${key}`;
			if (await shouldMark(nodeModulePath, packageJson, key)) {
				const start = textArr[i].indexOf(key);
				const end = start + key.length;
				diagnostics.push({
					severity: vscode.DiagnosticSeverity.Information,
					message: `No "types" property detected in package.json. You may need to install a types package like '${typesPackageName}' if you want this package to work in TypeScript files, nicely.`,
					code: 'no-types-detected',
					source: 'Types Installer Helper',
					range: new vscode.Range(i, start, i, end)
				});
			}
			i++;
		}
	}

	return diagnostics;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	const diagnosticCollection = vscode.languages.createDiagnosticCollection('types-installer');
	
	const handler = async (doc: vscode.TextDocument) => {
		if(!doc.fileName.endsWith('package.json')) {
			return;
		}
	
		const diagnostics = await getDiagnostics(doc);
		diagnosticCollection.set(doc.uri, diagnostics);
	};
	
	const didOpen = vscode.workspace.onDidOpenTextDocument(doc => handler(doc));
	const didChange = vscode.workspace.onDidChangeTextDocument(e => handler(e.document));
	const codeActionProvider = vscode.languages.registerCodeActionsProvider('json', new TypesInstaller(context));
	
	// If we have an activeTextEditor when we open the workspace, trigger the handler
	if (vscode.window.activeTextEditor) {
		await handler(vscode.window.activeTextEditor.document);
	}
	
	// Push all of the disposables that should be cleaned up when the extension is disabled
	context.subscriptions.push(
		diagnosticCollection,
		didOpen,
		didChange,
		codeActionProvider);
}

// this method is called when your extension is deactivated
export function deactivate() {}
