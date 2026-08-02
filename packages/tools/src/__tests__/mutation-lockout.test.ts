import { describe, expect, it } from 'vitest';
import { isModelMutationMessage } from '../server/dev-server.js';

describe('session conflict mutation lockout', () => {
    it('blocks model writes while leaving recovery reads available', () => {
        for (const type of [
            'element:update', 'element:create', 'relationship:create',
            'diagram:source:save', 'methodology:source:save', 'csv:import',
        ]) expect(isModelMutationMessage(type)).toBe(true);

        for (const type of [
            'request:refresh', 'diagram:source:request',
            'methodology:source:request', 'open-file',
        ]) expect(isModelMutationMessage(type)).toBe(false);
    });
});
