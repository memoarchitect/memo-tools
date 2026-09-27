// ─── SysML textual names ─────────────────────────────────────────────────────
//
// How a name is written in SysML v2 textual notation. A basic name is a letter
// or underscore followed by letters, digits and underscores, and is not a
// reserved keyword; any other name is written as an unrestricted name, in single
// quotes (`NeedKind::'stakeholder'`, since `stakeholder` is reserved).
//
// Stage 2 needs this because the API JSON carries names, not spellings: MEMO's
// flat attribute values quote a keyword the way the source must, and a value
// built from the JSON has to write the same thing.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `RESERVED_KEYWORD`, verbatim from the OMG SysML v2 textual BNF
 * (corpus/sysml-v2-release/bnf/SysML-textual-bnf.kebnf:13). A test holds this
 * copy to the vendored grammar, so a corpus bump that changes it fails loudly.
 */
export const SYSML_RESERVED_KEYWORDS: ReadonlySet<string> = new Set([
    'about', 'abstract', 'accept', 'action', 'actor', 'after', 'alias', 'all', 'allocate', 'allocation',
    'analysis', 'and', 'as', 'assert', 'assign', 'assume', 'at', 'attribute', 'bind', 'binding', 'by', 'calc',
    'case', 'comment', 'concern', 'connect', 'connection', 'constant', 'constraint', 'crosses', 'decide',
    'def', 'default', 'defined', 'dependency', 'derived', 'do', 'doc', 'else', 'end', 'entry', 'enum',
    'event', 'exhibit', 'exit', 'expose', 'false', 'filter', 'first', 'flow', 'for', 'fork', 'frame', 'from',
    'hastype', 'if', 'implies', 'import', 'in', 'include', 'individual', 'inout', 'interface', 'istype',
    'item', 'join', 'language', 'library', 'locale', 'loop', 'merge', 'message', 'meta', 'metadata', 'new',
    'nonunique', 'not', 'null', 'objective', 'occurrence', 'of', 'or', 'ordered', 'out', 'package', 'parallel',
    'part', 'perform', 'port', 'private', 'protected', 'public', 'redefines', 'ref', 'references', 'render',
    'rendering', 'rep', 'require', 'requirement', 'return', 'satisfy', 'send', 'snapshot', 'specializes',
    'stakeholder', 'standard', 'state', 'subject', 'subsets', 'succession', 'terminate', 'then', 'timeslice',
    'to', 'transition', 'true', 'until', 'use', 'variant', 'variation', 'verification', 'verify', 'via',
    'view', 'viewpoint', 'when', 'while', 'xor',
]);

const BASIC_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A name as SysML textual notation writes it: bare when basic, quoted otherwise. */
export function textualName(name: string): string {
    if (BASIC_NAME.test(name) && !SYSML_RESERVED_KEYWORDS.has(name)) return name;
    return `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
