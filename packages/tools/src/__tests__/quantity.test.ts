import { describe, expect, it } from 'vitest';
import { parseQuantity, unitSymbols, unitTable } from '../model/quantity.js';
import { convertQuantity } from '../model/quantity-core.js';
import { formatQuantity } from '../model/quantity-format.js';

describe('quantities read from the standard library source', () => {
    it('reads a prefixed unit and a converted one to the same base', () => {
        expect(parseQuantity('2.5 [milli*second]')).toEqual({ value: 0.0025, dimension: 's' });
        expect(parseQuantity('1 [minute]')?.value).toBe(60);
        expect(parseQuantity('1 [h]')?.value).toBe(3600);
        expect(parseQuantity('2 [kilo*g]')).toEqual({ value: 2000, dimension: 'g' });
        expect(parseQuantity('5')).toBeUndefined();
    });

    it('reads units defined by an expression and compound units', () => {
        // Hz = s^-1, so 2 kHz is 2000 per second, and equals 2000 [s^-1].
        expect(parseQuantity('2 [kilo*Hz]')).toEqual({ value: 2000, dimension: 's^-1' });
        expect(parseQuantity('2 [kilo*hertz]')?.value).toBe(2000);
        expect(parseQuantity('3 [m/s]')).toEqual({ value: 3, dimension: 'm*s^-1' });
        // 1 N = 1 kg*m/s^2, in grams as the base mass.
        expect(parseQuantity('1 [N]')).toEqual({ value: 1000, dimension: 'g*m*s^-2' });
        expect(parseQuantity('1 [kg*m/s^2]')).toEqual(parseQuantity('1 [N]'));
        // bytes are counted in the library as a pure number, and kibi is a prefix
        expect(parseQuantity('2 [kibi*B]')).toEqual({ value: 2048, dimension: 'B' });
        expect(parseQuantity('1 [km/h]')?.dimension).toBe('m*s^-1');
    });

    it('refuses a name or a form the library does not define', () => {
        expect(() => parseQuantity('3 [furlongs*second]')).toThrow(/furlongs/);
        expect(() => parseQuantity('3 [m/]')).toThrow(/ends early/);
        expect(() => parseQuantity('3 [(m]')).toThrow(/unclosed/);
    });

    it('has the factors from the library, not a table of its own', () => {
        expect(unitTable().prefixes.get('milli')).toBe(1e-3);
        expect(unitTable().prefixes.get('kibi')).toBe(1024);
    });

    it('writes a quantity the way it is printed, from the library\'s symbols', () => {
        const symbols = unitSymbols();
        expect(symbols.prefixes.milli).toBe('m');
        expect(symbols.units.second).toBe('s');
        expect(formatQuantity('20 [milli*second]', symbols)).toBe('20 ms');
        expect(formatQuantity('2.5 [kilo*hertz]', symbols)).toBe('2.5 kHz');
        expect(formatQuantity('3 [m/s]', symbols)).toBe('3 m/s');
        expect(formatQuantity('7 [kg*m/s^2]', symbols)).toBe('7 kg⋅m/s^2');
        expect(formatQuantity('plain text', symbols)).toBeUndefined();
        expect(formatQuantity('20 [milli*second]', undefined)).toBeUndefined();
    });

    it('reads an absolute temperature on an interval scale with its zero shift', () => {
        // 0 °C is 273.15 K, so 20 °C compares above 290 K and below 300 K; as a difference (°C = K) it does not.
        expect(parseQuantity("20 ['°C_abs']")).toEqual({ value: 293.15, dimension: 'K' });
        expect(parseQuantity("20 ['°C']")).toEqual({ value: 20, dimension: 'K' });
        expect(convertQuantity('300 [K]', "'°C_abs'", unitTable())).toBe(26.85);
        expect(convertQuantity("20 ['°C_abs']", 'K', unitTable())).toBe(293.15);
        // a scale with a shift stands alone
        expect(() => parseQuantity("2 ['°C_abs'*s]")).toThrow(/interval scale/);
    });

    it('does not take units the library defines as `one` for each other', () => {
        // byte, bit and decibel are all `= one` in the library; they are not the same unit
        expect(parseQuantity('2 [kibi*B]')).toEqual({ value: 2048, dimension: 'B' });
        expect(parseQuantity('8 [bit]')?.dimension).toBe('bit');
        expect(parseQuantity('3 [dB]')?.dimension).toBe('dB');
        expect(parseQuantity('3 [one]')?.dimension).toBe('1');
    });

    it('converts a quantity to a unit of its dimension and refuses another', () => {
        expect(convertQuantity('1 [s]', 'milli*second', unitTable())).toBe(1000);
        expect(convertQuantity('90 [minute]', 'h', unitTable())).toBe(1.5);
        expect(() => convertQuantity('1 [s]', 'kilo*g', unitTable())).toThrow(/not a quantity in kilo\*g/);
        expect(() => convertQuantity('fast', 'h', unitTable())).toThrow(/not a quantity/);
    });
});
