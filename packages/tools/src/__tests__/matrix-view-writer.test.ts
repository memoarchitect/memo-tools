import { describe, expect, it } from 'vitest';
import { matrixLines, replaceMatrixStatements } from '../server/view-writer.js';
import type { MatrixDefinitionDTO } from '../model/semantic.js';

const trace: MatrixDefinitionDTO = {
    rowAxis: { query: 'kind: Requirement\nwhere: name contains "}"' },
    columnAxis: { elementIds: ['pkg::a', 'pkg::b'] },
    linkTypes: ['verifiedBy'],
};

describe('matrix declarations', () => {
    it('writes each axis as a redefinition of the part the definition declares', () => {
        const text = matrixLines(trace).join('\n');
        expect(text).toContain('part :>> rowAxis {');
        expect(text).toContain('attribute :>> query = "kind: Requirement\\nwhere: name contains \\"}\\"";');
        expect(text).toContain('attribute :>> includeElementIds = ("pkg::a", "pkg::b");');
        expect(text).toContain('attribute :>> linkTypes = ("verifiedBy");');
    });

    it('replaces only the matrix statements and keeps identity and the viewpoint', () => {
        const declaration = [
            'view vt : MemoTraceabilityMatrixView {',
            '    @MemoIdentity { :>> label = "T"; }',
            '    part :>> rowAxis {',
            '        attribute :>> query = "kind: Hazard } still inside";',
            '    }',
            '    attribute :>> linkTypes = ("mitigates");',
            '    ref :>> viewpointDefinition = vp;',
            '}',
        ].join('\n');
        const next = replaceMatrixStatements(declaration, trace);
        expect(next).toContain('@MemoIdentity { :>> label = "T"; }');
        expect(next).toContain('ref :>> viewpointDefinition = vp;');
        expect(next).not.toContain('Hazard');
        expect(next).not.toContain('mitigates');
        expect(next).toContain('"verifiedBy"');
        expect(next.trimEnd().endsWith('}')).toBe(true);
        expect((next.match(/part :>> rowAxis/g) ?? []).length).toBe(1);
    });
});

describe('named groups', () => {
    it('writes each group as a typed part that subsets the definition\'s groups, and replaces them on update', () => {
        const groups = [{ name: 'Front', groupedBy: 'owningPackage' as const, expression: 'a::b' }, { name: 'C', groupedBy: 'clusterResult' as const }];
        const text = matrixLines({ groups }).join('\n');
        expect(text).toContain('part group1 : MemoMatrixGroup :> groups {');
        expect(text).toContain('attribute :>> groupedBy = MatrixGroupKind::owningPackage;');
        expect(text).not.toContain('expression = ""');
        const next = replaceMatrixStatements(`view v : D {\n${text}\n}`, { groups: [groups[1]] });
        expect(next).not.toContain('Front');
        expect((next.match(/part group/g) ?? []).length).toBe(1);
    });
});

describe('system', () => {
    it('ties a matrix to its system by the qualified name of its definition, and replaces it on update', () => {
        const text = matrixLines({ system: 'pkg::sysA' }).join('\n');
        expect(text).toBe('    attribute :>> system = "pkg::sysA";');
        const next = replaceMatrixStatements(`view v : D {\n${text}\n}`, { system: 'pkg::sysB' });
        expect(next).toContain('pkg::sysB');
        expect(next).not.toContain('pkg::sysA');
    });
});

describe('indentation', () => {
    it('offsets the statements by the declaration\'s own indent', () => {
        const declaration = 'view v : D {\n        @MemoIdentity { :>> label = "T"; }\n    }';
        const next = replaceMatrixStatements(declaration, { rowAxis: { query: 'kind: X' } }, '    ');
        expect(next.split('\n')).toEqual([
            'view v : D {',
            '        @MemoIdentity { :>> label = "T"; }',
            '        part :>> rowAxis {',
            '            attribute :>> query = "kind: X";',
            '        }',
            '    }',
        ]);
    });
});
