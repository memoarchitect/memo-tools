import { describe, expect, it } from 'vitest';
import { warningsFail } from '../commands/toolchain';

describe('which validators fail `memo toolchain check` on a warning', () => {
    it('fails on SysIDE warnings, which run as errors', () => {
        expect(warningsFail('syside')).toBe(true);
    });

    // OpenSysML's `name-conflict` warning fires on every recursive `expose X::**` over a tree with repeated member
    // names, which the sample views need; its own verdict is "no errors".
    it('reports OpenSysML warnings without failing on them', () => {
        expect(warningsFail('opensysml')).toBe(false);
    });
});
