#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const memo = process.argv[2];
const toolTest = process.argv[3];
if (!memo || !toolTest) throw new Error('usage: remove-r2-compatibility-definitions <memo-root> <keyword-test>');
const definitions = [
    ['src/core/relationships/memo_relationships.sysml', 'Performs', 'performs', 'PerformsMetadata'],
    ['src/architecture/functional/functions/memo_functions.sysml', 'IncludesStep', 'includesStep', 'IncludesStepMetadata'],
    ['src/architecture/logical/structure/memo_logical_structure.sysml', 'ExhibitsMode', 'exhibitsMode', 'ExhibitsModeMetadata'],
    ['src/architecture/functional/behavior/memo_behavior.sysml', 'Transition'],
    ['src/architecture/functional/behavior/memo_behavior.sysml', 'InteractionMessage'],
    ['src/architecture/implementation/ui/memo_ui.sysml', 'UITransition', 'uITransition', 'UITransitionMetadata'],
    ['src/architecture/operational/context/actors/memo_actors.sysml', 'NonHumanActor'],
    ['src/architecture/operational/context/actors/memo_actors.sysml', 'Actor'],
    ['src/architecture/operational/context/stakeholders/memo_stakeholders.sysml', 'Stakeholder'],
    ['src/architecture/operational/context/stakeholders/memo_stakeholders.sysml', 'Concern'],
    ['src/architecture/operational/context/stakeholders/memo_stakeholders.sysml', 'HasConcern', 'hasConcern', 'HasConcernMetadata'],
    ['src/architecture/operational/context/stakeholders/memo_stakeholders.sysml', 'FramesConcern', 'framesConcern', 'FramesConcernMetadata'],
    ['src/architecture/operational/context/stakeholders/memo_stakeholders.sysml', 'ActsAsActor', 'actsAsActor', 'ActsAsActorMetadata'],
    ['src/architecture/logical/structure/memo_logical_structure.sysml', 'LogicalState'],
];
for (const [relative, name, metadata, metadataDefinition] of definitions) {
    const path = `${memo}/${relative}`;
    let text = readFileSync(path, 'utf8');
    text = removeDeclaration(text, name);
    if (metadata) {
        text = text.replace(new RegExp(`\\n\\s*abstract connection ${metadata}Links : ${name}\\[\\*\\];`), '');
        text = removeDeclaration(text, metadataDefinition);
    }
    writeFileSync(path, text);
}
let test = readFileSync(toolTest, 'utf8');
for (const key of ['perform:Performs', 'exhibit:ExhibitsMode', 'include:IncludesStep', 'message:InteractionMessage', 'transition:Transition', 'transition:UITransition', 'stakeholder:Stakeholder', 'concern:Concern', 'frame:FramesConcern', 'concern:FramesConcern', 'actor:Actor', 'actor:NonHumanActor', 'actor:ActsAsActor', 'state:LogicalState', 'concern:HasConcern']) {
    test = test.replace(new RegExp(`\\n    '${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}': \\{[\\s\\S]*?\\n    \\},`), '');
}
writeFileSync(toolTest, test);

function removeDeclaration(text, name) {
    const match = new RegExp(`^\\s*(?:abstract\\s+)?(?:connection|part|metadata) def(?: <[^>]+>)? ${name}\\b[^\\{;]*(?:\\{|;)`, 'm').exec(text);
    if (!match) throw new Error(`declaration not found: ${name}`);
    const start = match.index;
    if (match[0].endsWith(';')) return text.slice(0, start) + text.slice(start + match[0].length);
    let depth = 0, end = -1;
    for (let i = start + match[0].lastIndexOf('{'); i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) throw new Error(`unclosed declaration: ${name}`);
    return text.slice(0, start) + text.slice(end);
}
