import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Diagnostic } from '../toolchain/diagnostic.js';
import { applyValidatorExceptions, readValidatorExceptions, type ValidatorException } from '../toolchain/exceptions.js';

// A register excuses one provider's code in one file. What these pin is that
// it cannot excuse more than that, that switching provider neither applies
// nor stales another engine's entries, and that an unused entry fails.

const entry: ValidatorException = {
    id: 'conjugated-typing', provider: 'syside', file: 'src/a.sysml', code: 'syntax-error',
    spec: 'SysML-textual-bnf.kebnf:652', providerVersion: '0.10.2', board: 'row', note: "Unexpected '~'",
};

const diagnostic = (file: string, code?: string, provider = 'syside'): Diagnostic => ({
    domain: 'sysml', provider, severity: 'error', message: 'm', file, code,
});

let directory: string | undefined;
afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
});

describe('validator exceptions', () => {
    it('excepts only the listed provider, file and code together', () => {
        const outcome = applyValidatorExceptions([
            diagnostic('/proj/src/a.sysml', 'syntax-error'),
            diagnostic('/proj/src/b.sysml', 'syntax-error'),
            diagnostic('/proj/src/a.sysml', 'reference-error'),
            diagnostic('/proj/src/a.sysml'),
        ], [entry], 'syside', '/proj');
        expect(outcome.excepted.map(e => e.exception.id)).toEqual(['conjugated-typing']);
        expect(outcome.remaining).toHaveLength(3);
        expect(outcome.stale).toEqual([]);
    });

    it('reports an entry for the provider that ran and matched nothing as stale', () => {
        expect(applyValidatorExceptions([], [entry], 'syside', '/proj').stale.map(e => e.id)).toEqual(['conjugated-typing']);
    });

    it('neither applies nor stales another provider\'s entries', () => {
        const outcome = applyValidatorExceptions(
            [diagnostic('/proj/src/a.sysml', 'syntax-error', 'internal')], [entry], 'internal', '/proj');
        expect(outcome.remaining).toHaveLength(1);
        expect(outcome.stale).toEqual([]);
    });

    it('refuses an entry that does not say why it is the provider\'s gap', () => {
        directory = mkdtempSync(join(tmpdir(), 'memo-exceptions-'));
        const path = join(directory, 'validator-exceptions.json');
        writeFileSync(path, JSON.stringify({ exceptions: [{ ...entry, spec: '' }] }));
        expect(() => readValidatorExceptions(path)).toThrow(/lacks spec/);
    });

    it('reads a missing register as empty', () => {
        expect(readValidatorExceptions('/nonexistent/validator-exceptions.json')).toEqual([]);
    });
});
