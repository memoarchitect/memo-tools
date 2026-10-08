// ─── Writing the project's own settings ──────────────────────────────────────
//
// The project names the compiler it uses, in its settings file, which is checked
// in. Architect's Compiler control writes it here, with the YAML document model so the file's comments and other keys stay
// where they were. It never walks above the project: a settings file in a parent
// directory is somebody else's.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Document, parseDocument } from 'yaml';
import { findConfigFile } from './config-loader.js';

/** The settings file of this project itself, or where one would be created. */
export function projectSettingsFile(projectRoot: string): string {
    const root = resolve(projectRoot);
    const found = findConfigFile(root);
    return found && dirname(resolve(found)) === root ? found : resolve(root, 'memo.package.yaml');
}

function readDocument(file: string): Document {
    if (!existsSync(file)) return new Document({});
    const document = parseDocument(readFileSync(file, 'utf8'));
    if (document.errors.length > 0) {
        throw new Error(`The project settings file ${file} could not be read: ${document.errors[0].message}`);
    }
    return document.contents === null ? new Document({}) : document;
}

/** Set a toolchain leaf (`compiler`, `syside.diagnose`) in the project's settings file. Returns the file. */
export function setProjectToolchainSetting(projectRoot: string, path: string, value: string): string {
    const file = projectSettingsFile(projectRoot);
    const document = readDocument(file);
    document.setIn(['toolchain', ...path.split('.')], value);
    writeFileSync(file, document.toString());
    return file;
}

/** Remove a toolchain leaf from the project's settings file; false when it was not set. */
export function unsetProjectToolchainSetting(projectRoot: string, path: string): { file: string; changed: boolean } {
    const file = projectSettingsFile(projectRoot);
    if (!existsSync(file)) return { file, changed: false };
    const document = readDocument(file);
    const steps = ['toolchain', ...path.split('.')];
    if (!document.hasIn(steps)) return { file, changed: false };
    document.deleteIn(steps);
    writeFileSync(file, document.toString());
    return { file, changed: true };
}
