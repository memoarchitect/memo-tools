import { describe, expect, it } from 'vitest';
import { parseQuantity, unitTable } from '../model/quantity.js';

describe('quantities read from the standard library source', () => {
    it('reads a prefixed unit and a converted one to the same base', () => {
        expect(parseQuantity('2.5 [milli*second]')).toEqual({ value: 0.0025, dimension: 'DurationUnit' });
        expect(parseQuantity('1 [minute]')?.value).toBe(60);
        expect(parseQuantity('1 [h]')?.value).toBe(3600);
        expect(parseQuantity('2 [kilo*g]')).toEqual({ value: 2000, dimension: 'MassUnit' });
        expect(parseQuantity('5')).toBeUndefined();
    });

    it('refuses what the library does not define by a factor', () => {
        expect(() => parseQuantity('3 [Hz]')).toThrow(/not a unit/);
        expect(() => parseQuantity('3 [furlongs*second]')).toThrow(/not a unit prefix/);
    });

    it('has the factors from the library, not a table of its own', () => {
        expect(unitTable().prefixes.get('milli')).toBe(1e-3);
        expect(unitTable().prefixes.get('kibi')).toBe(1024);
    });
});
