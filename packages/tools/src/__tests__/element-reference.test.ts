import { describe, expect, it } from 'vitest';
import { elementPath } from '../serializer/element-reference.js';
import type { MemoModelDTO } from '../model/semantic.js';

it('uses definition namespaces and action/part feature chains rather than internal nested IDs', () => {
    const model = { elements: {
        'P::Pump': { id: 'P::Pump', isDefinition: true, construct: 'part' },
        'P::Pump::controller': { id: 'P::Pump::controller', owner: 'P::Pump' },
        'P::Pump::controller::port': { id: 'P::Pump::controller::port', owner: 'P::Pump::controller' },
        'P::root': { id: 'P::root', construct: 'action' },
        'P::root::compute': { id: 'P::root::compute', parentAction: 'P::root' },
    } } as unknown as MemoModelDTO;
    expect(elementPath('P::Pump::controller::port', model)).toBe('P::Pump::controller.port');
    expect(elementPath('P::root::compute', model)).toBe('P::root.compute');
});
