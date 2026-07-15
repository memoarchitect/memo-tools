import { describe, it, expect } from 'vitest';
import { type LangiumDocument, EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type {
    Model,
    PackageDeclaration,
    ConstraintDefinition,
    RequirementDefinition,
    RequireConstraintMember,
    ConstraintExpr,
} from '../language/generated/ast.js';
import { langiumExprToNode } from '../validator/constraint-eval.js';

// ─── EE-1: native KerML expression grammar for constraint/requirement bodies ──
// Covers the ADR-1-18 supported subset: navigation, collection ops, comparison,
// boolean operators, arithmetic, literals; plus the Langium AST → evaluator
// mapping (langiumExprToNode) over the full EE-2 evaluable breadth.

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);

/** Parse a `constraint def C { require constraint { <expr> } }` and return the expression. */
async function parseExpr(expr: string): Promise<ConstraintExpr> {
    const src = `
        package P {
            constraint def C {
                require constraint { ${expr} }
            }
        }
    `;
    const doc: LangiumDocument<Model> = await parse(src);
    const errors = doc.parseResult.lexerErrors.concat(doc.parseResult.parserErrors as any[]);
    if (errors.length > 0) {
        throw new Error(`Parse errors:\n${errors.map((e: any) => e.message).join('\n')}\n\nExpr: ${expr}`);
    }
    const pkg = doc.parseResult.value.members[0] as PackageDeclaration;
    const cdef = pkg.members[0] as ConstraintDefinition;
    const member = cdef.body[0] as RequireConstraintMember;
    expect(member.$type).toBe('RequireConstraintMember');
    return member.expression;
}

describe('EE-1 constraint expression grammar', () => {
    it('parses a require constraint member with zero errors', async () => {
        const e = await parseExpr('allocations->notEmpty()');
        expect(e.$type).toBe('CollectionOp');
    });

    it('accepts assert constraint as well as require constraint', async () => {
        const doc = await parse(`
            package P {
                requirement def R {
                    assert constraint { satisfies->size() >= 1 }
                }
            }
        `);
        const errors = doc.parseResult.lexerErrors.concat(doc.parseResult.parserErrors as any[]);
        expect(errors).toHaveLength(0);
        const pkg = doc.parseResult.value.members[0] as PackageDeclaration;
        const rdef = pkg.members[0] as RequirementDefinition;
        const member = rdef.body[0] as RequireConstraintMember;
        expect(member.kind).toBe('assert');
    });

    describe('collection operations', () => {
        for (const op of ['size', 'notEmpty', 'isEmpty', 'forAll', 'exists', 'select']) {
            it(`parses ->${op}()`, async () => {
                const arg = ['forAll', 'exists', 'select'].includes(op) ? 'mitigates->notEmpty()' : '';
                const e = await parseExpr(`hazards->${op}(${arg})`);
                expect(e.$type).toBe('CollectionOp');
                expect((e as any).op).toBe(op);
            });
        }
    });

    describe('comparison operators', () => {
        for (const op of ['==', '!=', '>=', '<=', '>', '<']) {
            it(`parses ${op}`, async () => {
                const e = await parseExpr(`severity->size() ${op} 3`);
                expect(e.$type).toBe('BinaryExpr');
                expect((e as any).op).toBe(op);
            });
        }
    });

    describe('boolean operators', () => {
        it('parses and / or with or looser than and', async () => {
            const e = await parseExpr('a->notEmpty() and b->isEmpty() or c->notEmpty()');
            // or is the root (loosest binding)
            expect(e.$type).toBe('BinaryExpr');
            expect((e as any).op).toBe('or');
            expect((e as any).left.op).toBe('and');
        });
        it('parses not', async () => {
            const e = await parseExpr('not a->isEmpty()');
            expect(e.$type).toBe('UnaryExpr');
            expect((e as any).op).toBe('not');
        });
    });

    describe('arithmetic operators', () => {
        for (const op of ['+', '-', '*', '/']) {
            it(`parses ${op}`, async () => {
                const e = await parseExpr(`a->size() == 1 ${op} 2`);
                expect(e.$type).toBe('BinaryExpr');
                // arithmetic binds tighter than comparison → right side is the arithmetic BinaryExpr
                expect((e as any).right.op).toBe(op);
            });
        }
    });

    describe('literals and navigation', () => {
        it('parses integer literal', async () => {
            const e = await parseExpr('count == 5');
            expect((e as any).right.$type).toBe('LiteralExpr');
            // Langium's INT value converter yields a number at runtime.
            expect((e as any).right.intValue).toBe(5);
        });
        it('parses boolean literal', async () => {
            const e = await parseExpr('flag == true');
            expect((e as any).right.boolValue).toBe('true');
        });
        it('parses string literal', async () => {
            const e = await parseExpr('label == "high"');
            // Langium's STRING value converter strips the surrounding quotes.
            expect((e as any).right.strValue).toBe('high');
        });
        it('parses a single-segment feature', async () => {
            const e = await parseExpr('allocations->size() == 0');
            expect((e as any).left.target.$type).toBe('FeatureChain');
            expect((e as any).left.target.segments).toEqual(['allocations']);
        });
        it('parses a dotted feature chain', async () => {
            const e = await parseExpr('a.b.c->notEmpty()');
            expect((e as any).target.segments).toEqual(['a', 'b', 'c']);
        });
        it('parses parenthesized grouping', async () => {
            const e = await parseExpr('(a->notEmpty() or b->notEmpty()) and c->isEmpty()');
            expect((e as any).op).toBe('and');
        });
    });
});

describe('EE-1 langiumExprToNode mapping', () => {
    it('maps the evaluable core (nav, collection op, comparison)', async () => {
        const node = langiumExprToNode(await parseExpr('allocations->size() >= 1'));
        expect(node).toEqual({
            kind: 'cmp',
            op: '>=',
            left: { kind: 'method', target: { kind: 'feature', root: 'current', segments: ['allocations'] }, name: 'size' },
            right: { kind: 'int', value: 1 },
        });
    });
    it('maps boolean and/or/not', async () => {
        const node = langiumExprToNode(await parseExpr('not a->isEmpty() and b->notEmpty()'));
        expect(node.kind).toBe('and');
    });
    it('maps integer and boolean literals', async () => {
        expect(langiumExprToNode((await parseExpr('x == 7')) as any)).toMatchObject({ right: { kind: 'int', value: 7 } });
        expect(langiumExprToNode((await parseExpr('x == true')) as any)).toMatchObject({ right: { kind: 'bool', value: true } });
    });

    it('maps the EE-2 breadth (quantifiers, multi-segment chains, arithmetic, strings)', async () => {
        // Quantifier with sub-expression body.
        const quant = langiumExprToNode(await parseExpr('hazards->forAll(mitigates->notEmpty())'));
        expect(quant).toMatchObject({
            kind: 'quant', name: 'forAll',
            target: { kind: 'feature', segments: ['hazards'] },
            body: { kind: 'method', name: 'notEmpty', target: { kind: 'feature', segments: ['mitigates'] } },
        });
        // Multi-segment feature chain.
        expect(langiumExprToNode(await parseExpr('a.b->notEmpty()')))
            .toMatchObject({ kind: 'method', target: { kind: 'feature', segments: ['a', 'b'] } });
        // Arithmetic.
        expect(langiumExprToNode((await parseExpr('count == 1 + 2')) as any))
            .toMatchObject({ right: { kind: 'arith', op: '+', left: { kind: 'int', value: 1 }, right: { kind: 'int', value: 2 } } });
        // String literal.
        expect(langiumExprToNode((await parseExpr('label == "x"')) as any))
            .toMatchObject({ right: { kind: 'str', value: 'x' } });
    });
});
