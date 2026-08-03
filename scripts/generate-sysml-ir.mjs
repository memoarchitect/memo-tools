#!/usr/bin/env node
// Declarations only: derived feature implementations belong to the resolution core.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), source = resolve(root, 'packages/sysml-ir/ecore/SysML.ecore'), output = resolve(root, 'packages/sysml-ir/src/generated/sysml-metamodel.ts');
const xml = readFileSync(source, 'utf8'), sha = createHash('sha256').update(xml).digest('hex'), expected = '7f6bf7851ea5a732e004415f4b9b7d6dd685e7a2f89a6c800b5df1fbfd34a4f0';
if (sha !== expected) throw new Error(`SysML.ecore SHA-256 mismatch: ${sha}`);
const attrs = t => Object.fromEntries([...t.matchAll(/([\w:]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
const scalar = { EString: 'string', EBoolean: 'boolean', EInt: 'number', EInteger: 'number', EDouble: 'number', EFloat: 'number', ELong: 'number', EShort: 'number', EByte: 'number', EChar: 'string', EJavaObject: 'unknown' };
const target = v => { const n = (v || '').includes('#//') ? v.split('#//').pop() : (v || '').split('//').pop(); return scalar[n] || n || 'unknown'; };
const classes = [...xml.matchAll(/<eClassifiers xsi:type="ecore:EClass"([^>]*)>([\s\S]*?)<\/eClassifiers>|<eClassifiers xsi:type="ecore:EClass"([^>]*)\/>/g)];
const enums = [...xml.matchAll(/<eClassifiers xsi:type="ecore:EEnum"([^>]*)>([\s\S]*?)<\/eClassifiers>/g)].map(match => {
  const h = attrs(match[1]), literals = [...match[2].matchAll(/<eLiterals([^>]*)\/?/g)].map(literal => attrs(literal[1]).name).filter(Boolean);
  return `export type ${h.name} = ${literals.map(value => JSON.stringify(value)).join(' | ') || 'string'};`;
});
const interfaces = [], metadata = [];
for (const match of classes) { const h = attrs(match[1] || match[3] || ''), name = h.name; if (!name) continue; const supers = (h.eSuperTypes || '').split(/\s+/).filter(Boolean).map(target), features = [];
  for (const f of (match[2] || '').matchAll(/<eStructuralFeatures([^>]*)\/?>(?:[\s\S]*?<\/eStructuralFeatures>)?/g)) { const a = attrs(f[1]); if (a.name) features.push({ name: a.name === 'default' ? 'defaultValue' : a.name, type: target(a.eType), many: Number(a.upperBound || '1') !== 1, containment: a.containment === 'true', derived: a.derived === 'true' || a.volatile === 'true', opposite: a.eOpposite?.replace('#//', '') }); }
  interfaces.push(`export interface ${name}${supers.length ? ` extends ${supers.join(', ')}` : ''} {\n${features.map(f => `    /** ${f.derived ? 'Derived declaration; resolved by the native core.' : f.containment ? 'Containment.' : 'Reference or attribute.'} */\n    ${f.derived ? 'readonly ' : ''}${f.name}?: ${f.type}${f.many ? '[]' : ''};`).join('\n')}\n}`); metadata.push(`    ${JSON.stringify(name)}: ${JSON.stringify(features)},`); }
const generated = `// GENERATED from SysML.ecore (SysML v2 Pilot release 2026-05, commit fa709f2). DO NOT EDIT.\n// Source SHA-256: ${sha}\n\nexport const SYSML_ECORE_SHA256 = '${sha}';\nexport const SYSML_ECORE_RELEASE = '2026-05';\n\n${enums.join('\n')}\n\n${interfaces.join('\n\n')}\n\nexport interface GeneratedFeatureMetadata { name: string; type: string; many: boolean; containment: boolean; derived: boolean; opposite?: string; }\nexport const SYSML_METACLASS_FEATURES: Record<string, GeneratedFeatureMetadata[]> = {\n${metadata.join('\n')}\n};\n`;
if (process.argv.includes('--check')) { if (readFileSync(output, 'utf8') !== generated) throw new Error('Generated SysML IR surface is stale; run pnpm --filter @memoarchitect/sysml-ir generate.'); } else writeFileSync(output, generated);
