/** Hand-written envelope around the normative Ecore-generated declarations. */
export interface SysmlIdentity { fileUri: string; declarationPath: string; metaclass: string; id: string; }
export interface SysmlSourceRange { file: string; start: { line: number; column?: number }; end?: { line: number; column?: number }; }
export interface SysmlElementIR { identity: SysmlIdentity; source: SysmlSourceRange; standardProperties: Record<string, unknown>; providerProperties: Record<string, unknown>; effectiveTypes: string[]; }
export interface MappedSysmlElementIR extends SysmlElementIR { kind: 'mapped'; memoElementId: string; }
export interface GenericSysmlElementIR extends SysmlElementIR { kind: 'generic'; unmappable: string; }
export type IngestedSysmlElementIR = MappedSysmlElementIR | GenericSysmlElementIR;
export interface SysmlIrDiagnostic { domain: 'memo-ingest'; severity: 'warning'; code: 'unmapped-sysml-element'; message: string; elementId: string; file: string; range: SysmlSourceRange; }
export interface SysmlIR { irVersion: string; elements: IngestedSysmlElementIR[]; diagnostics: SysmlIrDiagnostic[]; }
export function sysmlIdentity(fileUri: string, declarationPath: string, metaclass: string): SysmlIdentity { return { fileUri, declarationPath, metaclass, id: `${fileUri}#${declarationPath}:${metaclass}` }; }
