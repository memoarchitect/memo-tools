import { describe, expect, it } from 'vitest';
import { kindToPrefix } from '../model/short-id.js';

describe('MEMO short IDs', () => {
    it('uses the UIE family for UI elements', () => {
        expect(kindToPrefix('UIElement')).toBe('UIE');
    });
});
