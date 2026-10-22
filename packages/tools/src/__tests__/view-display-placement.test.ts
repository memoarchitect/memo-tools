import { describe, expect, it } from 'vitest';
import { placeDisplayStatements } from '../server/view-writer';

const indent = '        ';
const view = [
    'view v : MemoDiagramView {',
    `${indent}attribute :>> layoutHint = "context:compass";`,
    `${indent}attribute :>> autoPopulate = false;`,
    `${indent}part :>> selectionQuery {`,
    `${indent}    attribute :>> includeRelationshipKinds = ("InteractsInContext");`,
    `${indent}}`,
    '    }',
].join('\n') + '\n';

describe('placing a display statement in a view', () => {
    it('puts it beside the view\'s own attributes, never inside a part nested in the view', () => {
        const statement = `${indent}attribute :>> styleHint = "edge=rounded";`;
        const placed = placeDisplayStatements(view, statement, indent);
        const lines = placed.split('\n');
        const at = lines.indexOf(statement);
        // After the view's last own attribute, and before the nested part opens.
        expect(lines[at - 1]).toBe(`${indent}attribute :>> autoPopulate = false;`);
        expect(lines[at + 1]).toBe(`${indent}part :>> selectionQuery {`);
    });
});
