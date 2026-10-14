import { describe, expect, it } from 'vitest';
import { readDeclaredRegimes } from '../dhf/standards-report.js';
import type { MemoModel } from '../model/semantic.js';

// One approval per jurisdiction (plan O6): a regulated device states its own regime, and the method
// binding's `regulatoryRegime` is read only when the model declares no device.

const element = (id: string, kind: string, attributes: Record<string, string>) => ({ id, name: id, kind, attributes });
const model = (...elements: ReturnType<typeof element>[]): MemoModel => {
    const byKind = new Map<string, unknown[]>();
    for (const e of elements) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
    return { elements: new Map(elements.map(e => [e.id, e])), elementsByKind: byKind } as unknown as MemoModel;
};
const binding = (regimes: string) => element('binding', 'ModelMethodBinding', { regulatoryRegime: regimes });
const device = (id: string, jurisdiction: string, kind = 'RegulatedDevice') => element(id, kind, { jurisdiction });

describe('the regimes a model declares', () => {
    it('reads each device\'s jurisdiction, and ignores the binding with a record of what it ignored', () => {
        const declared = readDeclaredRegimes(model(device('a', 'RegulatoryRegimeKind::MDR'), device('b', 'RegulatoryRegimeKind::FDA_510k'), binding('RegulatoryRegimeKind::CE')));
        expect(declared).toEqual({ regimes: ['MDR', 'FDA_510k'], rejected: [], source: 'devices', ignoredBinding: ['CE'] });
    });

    it('falls back to the binding, marked as such, when there is no device', () => {
        expect(readDeclaredRegimes(model(binding('RegulatoryRegimeKind::CE, RegulatoryRegimeKind::MDR')))).toMatchObject({
            regimes: ['CE', 'MDR'], source: 'binding', ignoredBinding: [],
        });
        expect(readDeclaredRegimes(model())).toMatchObject({ regimes: [], source: 'none' });
    });

    it('accepts one spelling only: an unqualified member is rejected, as everywhere', () => {
        expect(readDeclaredRegimes(model(device('a', 'MDR')))).toMatchObject({ regimes: [], rejected: ['MDR'], source: 'devices' });
    });

    it('counts a specialization of the device kind when it has the kind registry', () => {
        const kinds = { getKind: (name: string) => (name === 'CeDevice' ? { superType: 'RegulatedDevice' } : undefined) } as never;
        const specialized = model(device('a', 'RegulatoryRegimeKind::CE', 'CeDevice'));
        expect(readDeclaredRegimes(specialized).regimes).toEqual([]);
        expect(readDeclaredRegimes(specialized, kinds).regimes).toEqual(['CE']);
    });
});
