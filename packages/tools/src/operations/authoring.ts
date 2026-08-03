// ─── Authoring write-back ────────────────────────────────────────────────────
//
// The one implementation behind "the canvas changed the model", reached from
// the CLI and from Architect's server protocol alike (§1.2.2). A write-back is
// two steps that only make sense together:
//
//   1. edit the SysML source — by IR identity, in standard notation;
//   2. recompile through the **selected lowering provider**, and hand back the
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
import { buildIrIdentityIndex, type IrIdentityIndex } from '../model/ir-identity.js';
import { loadProjectConfig } from '../toolchain/lowering.js';
import { runLowering } from '../toolchain/operations.js';
import type { Diagnostic } from '../toolchain/diagnostic.js';
import type { MemoIr } from '../toolchain/protocol.js';
import { saveElementToFile, type ElementWriteRequest, type ElementWriteResult } from '../server/persistor.js';

export interface AuthoringContext {
    projectDir: string;
    /** Project settings; loaded from the project when the caller has none. */
    config?: MEMOConfig;
    /** Identity index of the revision the caller's request was built against. */
    irIndex?: IrIdentityIndex;
}

/** What a recompile produced, in the shape every write-back returns it. */
export interface RecompiledRevision {
    ir: MemoIr;
    index: IrIdentityIndex;
    diagnostics: Diagnostic[];
    /** The provider that answered, so the caller can report which one ran. */
    provider: string;
}

/**
 * Recompile the project through the selected lowering provider.
 *
 * Exported on its own because "what does the model look like now" is a question
 * the CLI asks too, not only the thing that happens after a write.
 */
export async function recompileProject(context: AuthoringContext): Promise<RecompiledRevision> {
    const config = context.config ?? loadProjectConfig(context.projectDir);
    const result = await runLowering({ config, projectDir: context.projectDir });
    return {
        ir: result.ir,
        index: buildIrIdentityIndex(result.ir.model.sysmlIr),
        diagnostics: result.diagnostics,
        provider: result.provider,
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
    const result = await saveElementToFile(context.projectDir, element, context.irIndex);
    if (!result.success) return result;
    return { ...result, revision: await recompileProject(context) };
}
