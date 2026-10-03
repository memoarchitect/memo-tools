// ─── Authoring write-back ────────────────────────────────────────────────────
//
// The one implementation behind "the canvas changed the model", reached from
// the CLI and from Architect's server protocol alike (§1.2.2). A write-back is
// two steps that only make sense together:
//
//   1. edit the SysML source — by IR identity, in standard notation;
//   2. recompile with the **selected compiler**, and hand back the
//      revision that resulted.
//
// Step 2 is not a refresh optimisation. Before this session the editing path
// wrote source and let the file watcher discover it, which meant the identities
// the UI held were only as fresh as the next watcher tick — and a write made
// against them in the meantime was addressed to a revision nobody had compiled.
// Recompiling as part of the action closes that window: the write returns the
// identities its own result created.
//
// It goes through the provider rather than calling the builder directly for the
// same reason everything else does: the lowering role is configurable, and an
// authoring path that quietly used the internal builder would be a second
// compiler nobody selected.
// ─────────────────────────────────────────────────────────────────────────────

import type { MEMOConfig } from '../model/config.js';
import type { IrIdentityIndex } from '../model/ir-identity.js';
import { lowerAstToSysmlIr, projectSysmlIrToMemo, SYSML_IR_VERSION } from '../model/sysml-ir.js';
import { modelToDTO } from '../model/semantic.js';
import { loadProjectConfig } from '../toolchain/lowering.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import type { Diagnostic } from '../toolchain/diagnostic.js';
import { SYSMLC_IR_VERSION, type MemoIr } from '../toolchain/protocol.js';
import { saveElementToFile, type ElementWriteRequest, type ElementWriteResult } from '../server/persistor.js';
import {
    outlineIdentityIndex, outlineSourceFor, parseOutlineSource, projectOutlines, type OutlineSource,
} from '../authoring/outline-source.js';

export interface AuthoringContext {
    projectDir: string;
    /** Project settings; loaded from the project when the caller has none. */
    config?: MEMOConfig;
    /** Identity index of the revision the caller's request was built against. */
    irIndex?: IrIdentityIndex;
    /** Outlines of the project's files, from the selected compiler. MEMO's parse when absent. */
    outlines?: OutlineSource;
}

/** What a recompile produced, in the shape every write-back returns it. */
export interface RecompiledRevision {
    ir: MemoIr;
    index: IrIdentityIndex;
    diagnostics: Diagnostic[];
    /** The compiler that answered, so the caller can report which one ran. */
    provider: string;
    /** Outlines for the next write, read from this revision. */
    outlines: OutlineSource;
}

/**
 * Recompile the project with the selected compiler, and index the identities
 * of its declarations (plans/memo-write-back-from-handoff.md).
 *
 * Exported on its own because "what does the model look like now" is a question
 * the CLI asks too, not only the thing that happens after a write.
 */
export async function recompileProject(context: AuthoringContext): Promise<RecompiledRevision> {
    const config = context.config ?? loadProjectConfig(context.projectDir);
    const project = await loadProjectModel({ projectRoot: context.projectDir, config });
    const dto = modelToDTO(project.model);
    // MEMO's own lowering states its syntax tree as IR; a handoff is the record
    // for a compiler that builds the model from one.
    const sysml = project.api
        ? { irVersion: SYSML_IR_VERSION, elements: [], diagnostics: [] }
        : lowerAstToSysmlIr(project.documents, dto, context.projectDir);
    return {
        ir: {
            irVersion: SYSMLC_IR_VERSION,
            model: projectSysmlIrToMemo(sysml, dto),
            parseErrors: project.parseErrors,
            accepted: true,
            sysml,
        },
        index: outlineIdentityIndex(projectOutlines(context.projectDir, project), project.model.elements.values(), context.projectDir),
        diagnostics: project.diagnostics,
        provider: project.compiler,
        outlines: outlineSourceFor(context.projectDir, config, project),
    };
}

export interface ElementWriteBackResult extends ElementWriteResult {
    /** The revision the write produced, absent when nothing was written. */
    revision?: RecompiledRevision;
}

/**
 * Write one element and recompile.
 *
 * A failed write does not recompile: there is nothing new to compile, and
 * running the provider anyway would charge every rejected edit the cost of a
 * full lowering.
 */
export async function writeElement(
    context: AuthoringContext,
    element: ElementWriteRequest,
): Promise<ElementWriteBackResult> {
    const result = await saveElementToFile(context.projectDir, element, context.irIndex, context.outlines ?? parseOutlineSource);
    if (!result.success) return result;
    return { ...result, revision: await recompileProject(context) };
}
