// ─── MEMO SysML v2 — VS Code Extension ──────────────────────────────────────
//
// Provides:
//   1. Syntax highlighting (via TextMate grammar, declarative)
//   2. Diagnostics from `memo validate --format json` on save
//   3. Commands: MEMO: Validate Model, MEMO: Open Model in Browser
//
// ─────────────────────────────────────────────────────────────────────────────

import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    console.log('MEMO SysML v2 extension activated');

    diagnosticCollection = vscode.languages.createDiagnosticCollection('memo-sysml');
    context.subscriptions.push(diagnosticCollection);

    // Validate on save
    const onSave = vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (doc.languageId !== 'sysml') return;
        const config = vscode.workspace.getConfiguration('memoSysml');
        if (config.get<boolean>('validate.onSave', true)) {
            await runValidation();
        }
    });
    context.subscriptions.push(onSave);

    // Validate on type (optional, debounced)
    let typeTimer: ReturnType<typeof setTimeout> | undefined;
    const onChange = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId !== 'sysml') return;
        const config = vscode.workspace.getConfiguration('memoSysml');
        if (!config.get<boolean>('validate.onType', false)) return;
        if (typeTimer) clearTimeout(typeTimer);
        typeTimer = setTimeout(() => runValidation(), 2000);
    });
    context.subscriptions.push(onChange);

    // Command: Validate
    const validateCmd = vscode.commands.registerCommand('memoSysml.validate', async () => {
        await runValidation();
        vscode.window.showInformationMessage('MEMO validation complete');
    });
    context.subscriptions.push(validateCmd);

    // Command: Open in Browser
    const openCmd = vscode.commands.registerCommand('memoSysml.openViewer', async () => {
        const memoPath = getMemoPath();
        const workDir = getWorkDir();
        if (!workDir) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
        }
        try {
            await execFileAsync(memoPath, ['dev', '--port', '3000'], { cwd: workDir });
        } catch {
            // dev command runs as a server — it won't return until stopped
        }
    });
    context.subscriptions.push(openCmd);

    // Run initial validation
    runValidation();
}

export function deactivate() {
    diagnosticCollection?.dispose();
}

// ─── Validation ──────────────────────────────────────────────────────────────

interface MemoValidation {
    summary: {
        elements: number;
        relationships: number;
        violations: number;
        errors: number;
        warnings: number;
    };
    violations: Array<{
        ruleId: string;
        message: string;
        severity: 'error' | 'warning';
        elementId: string;
        elementName: string;
        elementKind?: string;
        file?: string;
        line?: number;
    }>;
}

async function runValidation(): Promise<void> {
    const memoPath = getMemoPath();
    const workDir = getWorkDir();
    if (!workDir) return;

    diagnosticCollection.clear();

    try {
        const { stdout } = await execFileAsync(memoPath, ['validate', '.', '--format', 'json'], {
            cwd: workDir,
            timeout: 30000,
            env: { ...process.env, FORCE_COLOR: '0' },
        });

        let result: MemoValidation;
        try {
            result = JSON.parse(stdout);
        } catch {
            // Non-JSON output (e.g., no config found) — just skip
            return;
        }

        // Group violations by file
        const diagMap = new Map<string, vscode.Diagnostic[]>();

        for (const v of result.violations) {
            const filePath = v.file ? path.resolve(workDir, v.file) : undefined;
            const uri = filePath || workDir;
            const key = uri;

            if (!diagMap.has(key)) diagMap.set(key, []);

            const severity = v.severity === 'error'
                ? vscode.DiagnosticSeverity.Error
                : vscode.DiagnosticSeverity.Warning;

            const line = (v.line || 1) - 1;
            const range = new vscode.Range(line, 0, line, 1000);

            const diag = new vscode.Diagnostic(
                range,
                `[${v.ruleId}] ${v.elementName}: ${v.message}`,
                severity,
            );
            diag.source = 'memo';
            diag.code = v.ruleId;

            diagMap.get(key)!.push(diag);
        }

        for (const [filePath, diags] of diagMap) {
            diagnosticCollection.set(vscode.Uri.file(filePath), diags);
        }

        // Show status bar summary
        if (result.summary.violations > 0) {
            const msg = `MEMO: ${result.summary.errors} errors, ${result.summary.warnings} warnings`;
            vscode.window.setStatusBarMessage(msg, 5000);
        } else {
            vscode.window.setStatusBarMessage('MEMO: Model valid ✓', 3000);
        }

    } catch (err: unknown) {
        // If memo CLI is not found, show a one-time warning
        if (err && typeof err === 'object' && 'code' in err && (err as any).code === 'ENOENT') {
            vscode.window.showWarningMessage(
                `MEMO CLI not found at "${memoPath}". Install with: npm install -g @memo/cli`,
            );
        }
        // Other errors (validation failures with exit code 1) are expected — parse stderr
        if (err && typeof err === 'object' && 'stdout' in err) {
            try {
                const result: MemoValidation = JSON.parse((err as any).stdout);
                // Re-process with the JSON from stdout
                const diagMap = new Map<string, vscode.Diagnostic[]>();
                for (const v of result.violations) {
                    const filePath = v.file ? path.resolve(workDir, v.file) : workDir;
                    if (!diagMap.has(filePath)) diagMap.set(filePath, []);
                    const severity = v.severity === 'error'
                        ? vscode.DiagnosticSeverity.Error
                        : vscode.DiagnosticSeverity.Warning;
                    const line = (v.line || 1) - 1;
                    const range = new vscode.Range(line, 0, line, 1000);
                    const diag = new vscode.Diagnostic(
                        range,
                        `[${v.ruleId}] ${v.elementName}: ${v.message}`,
                        severity,
                    );
                    diag.source = 'memo';
                    diag.code = v.ruleId;
                    diagMap.get(filePath)!.push(diag);
                }
                for (const [filePath, diags] of diagMap) {
                    diagnosticCollection.set(vscode.Uri.file(filePath), diags);
                }
            } catch {
                // Unparseable — ignore
            }
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMemoPath(): string {
    return vscode.workspace.getConfiguration('memoSysml').get<string>('memoCli.path', 'memo');
}

function getWorkDir(): string | undefined {
    // Use the workspace folder containing the active editor, or the first workspace folder
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const ws = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (ws) return ws.uri.fsPath;
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
