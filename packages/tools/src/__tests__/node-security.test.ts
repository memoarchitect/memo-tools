import { describe, expect, it } from 'vitest';
import { nodeSecurityWarning } from '../model/content-store.js';

describe('the Node security warning', () => {
    it('warns below the patched release of the line, and names it', () => {
        expect(nodeSecurityWarning('26.5.0')).toContain('26.13.1');
        expect(nodeSecurityWarning('v24.22.2')).toContain('24.22.3');
    });
    it('is quiet at or above the patched release, and for a line it has no record of', () => {
        expect(nodeSecurityWarning('26.13.1')).toBeUndefined();
        expect(nodeSecurityWarning('26.14.0')).toBeUndefined();
        expect(nodeSecurityWarning('20.1.0')).toBeUndefined();
    });
});
