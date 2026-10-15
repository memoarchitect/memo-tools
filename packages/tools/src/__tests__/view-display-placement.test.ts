import { describe, expect, it } from 'vitest';
import { placeDisplayStatements } from '../server/view-writer.js';

const statement = '    attribute :>> portDisplay = PortDisplay::wall;';

describe('a view\'s display statements', () => {
    it('follow the view\'s other attribute redefinitions, not the opening brace', () => {
        const view = 'view v : V {\n    expose a::*;\n    attribute :>> title = "T";\n    expose b::*;\n}';
        expect(placeDisplayStatements(view, statement, '    ')).toBe(
            `view v : V {\n    expose a::*;\n    attribute :>> title = "T";\n${statement}\n    expose b::*;\n}`);
    });

    it('go at the end of a body that has none', () => {
        const view = 'view v : V {\n    expose a::*;\n}';
        expect(placeDisplayStatements(view, statement, '    ')).toBe(
            `view v : V {\n    expose a::*;\n${statement}\n}`);
    });

    it('go into an empty body', () => {
        expect(placeDisplayStatements('view v : V {}', statement, '    ')).toBe(`view v : V {\n${statement}\n}`);
    });
});
