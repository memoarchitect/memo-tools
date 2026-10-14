import { describe, expect, it } from 'vitest';
import { isModelMutationMessage } from '../server/dev-server.js';

describe('session conflict mutation lockout', () => {
    it('blocks model writes while leaving recovery reads available', () => {
        for (const type of [
            'element:update', 'element:create', 'relationship:create',
            'diagram:source:save', 'methodology:source:save', 'csv:import',
            'import:apply', 'suspect:review',
        ]) expect(isModelMutationMessage(type)).toBe(true);

        for (const type of [
            'request:refresh', 'diagram:source:request',
            'methodology:source:request', 'open-file', 'import:preview',
            // Choosing, opening and comparing versions write nothing.
            'versions:list', 'version:open', 'release:diff',
        ]) expect(isModelMutationMessage(type)).toBe(false);
    });
});
