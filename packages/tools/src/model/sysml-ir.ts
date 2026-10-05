// The SysML record stream a model carries alongside its MEMO projection.
//
// MEMO builds no syntax tree of its own: the compiler's handoff is the record
// of what was compiled, so the stream is empty and exists for the clients that
// still read it.
import type { SysmlIR } from '../sysml-ir/index.js';
import type { MemoModelDTO } from './semantic.js';

export const SYSML_IR_VERSION = '2.0.0';

/** Memo is a projection of the record stream, rather than its ingestion boundary. */
export function projectSysmlIrToMemo(ir: SysmlIR, model: MemoModelDTO): MemoModelDTO {
    return { ...model, sysmlIr: ir };
}
