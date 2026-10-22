import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caretRange, installedVersions } from '../commands/upgrade';

describe('memo upgrade', () => {
    it('pins a release with a caret, which below 1.0 stays inside its minor', () => {
        expect(caretRange('0.16.0')).toBe('^0.16.0');
    });

    it('reads the tools and ontology versions the installed Architect declares', () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-upgrade-'));
        const dir = join(root, 'node_modules', '@memoarchitect', 'architect');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'package.json'), JSON.stringify({
            version: '0.16.1', dependencies: { '@memoarchitect/tools': '0.16.1', '@memoarchitect/ontology': '0.16.0' },
        }));
        expect(installedVersions(root)).toEqual({ architect: '0.16.1', tools: '0.16.1', ontology: '0.16.0' });
    });

    it('says to install first when Architect is missing', () => {
        expect(() => installedVersions(mkdtempSync(join(tmpdir(), 'memo-upgrade-')))).toThrow(/npm install/);
    });
});

import { satisfiesPin, pinMismatches } from '../pin-check';

describe('pinned versus installed', () => {
    it('follows npm caret rules below 1.0', () => {
        expect(satisfiesPin('^0.11.0', '0.11.4')).toBe(true);
        expect(satisfiesPin('^0.16.0', '0.15.3')).toBe(false);
        expect(satisfiesPin('^0.16.0', '0.17.0')).toBe(false);
        expect(satisfiesPin('^1.2.0', '1.9.0')).toBe(true);
        expect(satisfiesPin('~0.16.1', '0.16.0')).toBe(false);
        expect(satisfiesPin('0.16.0', '0.16.0')).toBe(true);
    });

    it('accepts a range it does not understand', () => {
        expect(satisfiesPin('latest', '0.1.0')).toBe(true);
        expect(satisfiesPin('>=0.5.0', '0.1.0')).toBe(true);
    });

    it('reports a package installed outside its pin', () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-pin-'));
        writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@memoarchitect/tools': '^0.16.0', '@memoarchitect/ontology': '^0.16.0' } }));
        for (const [name, version] of [['tools', '0.13.2'], ['ontology', '0.16.0']]) {
            const dir = join(root, 'node_modules', '@memoarchitect', name);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
        }
        expect(pinMismatches(root)).toEqual([{ name: '@memoarchitect/tools', pinned: '^0.16.0', installed: '0.13.2' }]);
    });
});

import { isUnfilledTemplate } from '../stage2/package-metadata-from-api';

describe('the package list', () => {
    it('leaves out a skeleton whose name is still a template token', () => {
        expect(isUnfilledTemplate('{{name}}')).toBe(true);
        expect(isUnfilledTemplate('@memoarchitect/extension-aadl')).toBe(false);
        expect(isUnfilledTemplate(undefined)).toBe(false);
    });
});
