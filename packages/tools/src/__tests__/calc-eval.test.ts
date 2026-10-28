import { describe, expect, it } from 'vitest';
import { add, formatQuantity, multiply, parseQuantity, type Quantity } from '../analysis/calc/units.js';
import { evaluateCalculations } from '../analysis/calc/calc-run.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

describe('quantities with units', () => {
    const q = (text: string) => parseQuantity(text) as Quantity;

    it('read a number in a unit, and a bare number', () => {
        expect(parseQuantity('30 [minute]')).toEqual({ num: 30, units: { minute: 1 } });
        expect(parseQuantity('600 [euro/hour]')).toEqual({ num: 600, units: { euro: 1, hour: -1 } });
        expect(parseQuantity('0.9 [one]')).toEqual({ num: 0.9, units: {} });
        expect(parseQuantity('3')).toBe(3);
        expect(parseQuantity('nominal')).toBeUndefined();
    });

    it('multiply a rate by a duration into an amount, converting minutes to hours', () => {
        const cost = multiply(q('600 [euro/hour]'), q('30 [minute]')) as Quantity;
        expect(cost.units).toEqual({ euro: 1 });
        expect(cost.num).toBeCloseTo(300, 6);
    });

    it('add in the first term\'s units, and refuse units that differ', () => {
        const total = add([q('1 [hour]'), q('30 [minute]')]) as Quantity;
        expect(total.units).toEqual({ hour: 1 });
        expect(total.num).toBeCloseTo(1.5, 6);
        expect(() => add([q('5 [euro]'), q('30 [minute]')])).toThrow(/different units/);
        expect(add([])).toBe(0);
    });

    it('write a quantity back with its units', () => {
        expect(formatQuantity(q('600 [euro/hour]'))).toBe('600 [euro/hour]');
        expect(formatQuantity(q('0.5 [one]'))).toBe('0.5 [one]');
    });
});

// The gastric-bypass example's figures, worked by hand from its numbers (laparoscopic: staff 770 euro/h and a
// 120 euro/h tower for 100 minutes of the nominal path, two staplers of 180 euro, a 35-minute conversion
// 6% of the time at the 770 euro/h staff, 450 euro per procedure).
describe.runIf(compilerConfigured && examplesPresent)('the roll-up calculations, evaluated from their bodies', () => {
    it('give each platform\'s cost, duration and success as the numbers say', async () => {
        await withExample({}, project => {
            const report = evaluateCalculations(project);
            const result = (name: string) => report.calculations.find(c => c.name === name);
            expect(report.calculations.every(c => c.ok), report.calculations.map(c => c.result).join('\n')).toBe(true);
            const number = (name: string) => Number(/^[-\d.]+/.exec(result(name)!.result)![0]);
            const lapNominal = 890 / 60 * 100 + 2 * 180;
            expect(number('costLap')).toBeCloseTo(lapNominal + 0.06 * (770 / 60 * 35) + 450, 3);
            expect(number('durationLap')).toBeCloseTo(100 + 0.06 * 35, 6);
            expect(number('successLap')).toBeCloseTo(0.99 * 0.97 * 0.94 * 0.99, 4);
            expect(result('costLap')!.result).toMatch(/\[euro\]$/);
            expect(result('durationLap')!.result).toMatch(/\[minute\]$/);
        }, 'gastric-bypass-variants');
    }, 180_000);

    it('score a trade study\'s alternatives and select by its objective', async () => {
        await withExample({}, project => {
            const [study] = evaluateCalculations(project).studies;
            expect(study.ok, study.error).toBe(true);
            expect(study.objective).toBe('MinimizeObjective');
            expect(study.scores).toHaveLength(3);
            expect(study.selected).toMatch(/laparoscopic/);
        }, 'gastric-bypass-variants');
    }, 180_000);

    it('fail with the function\'s name when a body calls one the evaluator does not implement', async () => {
        const source = `package seeded_calc {
    private import ScalarValues::*;
    private import NumericalFunctions::*;
    calc def Bad { in x : Real[1]; return y : Real[1] = abs(x); }
    calc badUse : Bad { in x = 1; }
}`;
        await withExample({ 'model/catalog/seeded_calc.sysml': source }, project => {
            const outcome = evaluateCalculations(project).calculations.find(c => c.name === 'badUse');
            expect(outcome?.ok).toBe(false);
            expect(outcome?.result).toMatch(/function .*abs/);
        });
    }, 180_000);
});
