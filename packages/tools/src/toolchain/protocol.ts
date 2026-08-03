// ─── The sysmlc protocol ─────────────────────────────────────────────────────
//
// MEMO's own compiler is reached the way a third party's would be: as a process
// speaking a declared protocol. This module is that declaration, and it is the
// only thing both sides share — `@memoarchitect/sysmlc` implements it, the
// `internal` adapter consumes it, and neither imports the other's internals.
//
// The transport is LSP over stdio. That choice is not decoration: it gives
// cancellation, document synchronisation and lifecycle for free, it is what
// Sensmetry's own server speaks, and it means any editor can get MEMO
// diagnostics without a MEMO-specific client. Exactly one request is added to
// it — `memo/emitIr`, for the thing LSP has no notion of. Resist adding a
// second; anything that looks like it needs one is probably a document
// notification LSP already defines.
//
// **Versioned from day one.** The point of the boundary is that it outlives any
// one implementation behind it — Track B's native engine is meant to replace
// `sysmlc` without the adapter noticing. A boundary whose shape is only ever
// "whatever the current build emits" cannot do that, so the version is checked
// on every handshake rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModelDTO, ParseError } from '../model/semantic.js';
import type { SysmlIR } from '@memoarchitect/sysml-ir';

/**
 * Protocol version, `major.minor.patch`.
 *
 * Compatibility is by major: a client refuses a server whose major differs,
 * and accepts any minor at or above nothing in particular — new optional fields
 * are a minor bump, a changed or removed field is a major one.
 */
export const SYSMLC_PROTOCOL_VERSION = '1.1.0';

/**
 * IR payload version, tracked separately from the protocol that carries it.
 *
 * The wire shape and the model shape change for different reasons: Session 3
 * replaces this payload with the canonical IR without touching the request that
 * delivers it. Two numbers, so that change costs one bump rather than a
 * protocol break.
 */
export const SYSMLC_IR_VERSION = '2.0.0';

/** The one custom request. Everything else on the wire is standard LSP. */
export const EMIT_IR_REQUEST = 'memo/emitIr';

/**
 * Where the server advertises its protocol version.
 *
 * `capabilities.experimental` is LSP's own extension point, so a generic client
 * that knows nothing about MEMO still completes the handshake.
 */
export const PROTOCOL_CAPABILITY_KEY = 'memoProtocol';

export interface ProtocolCapability {
    protocolVersion: string;
    irVersion: string;
    /** Implementation name and version, for diagnostics and probe output. */
    implementation: string;
    implementationVersion?: string;
}

export interface EmitIrParams {
    /** Absolute path of the project to lower. */
    projectDir: string;
    /**
     * Client-assigned, strictly increasing per project.
     *
     * This is what makes "a superseded revision never emits a stale result"
     * enforceable: the server compares the revision it is working on against
     * the newest it has been asked for, and refuses to answer with the old one.
     */
    revision: number;
    /** The version the client is speaking, re-stated per request. */
    protocolVersion: string;
    /**
     * The exact sources to lower, instead of the project's own discovery.
     *
     * Added in protocol 1.1.0 — an optional field, so a 1.0.0 server still
     * answers a 1.1.0 client's ordinary request. It exists for callers whose
     * subject is a file set rather than a project: `memo conformance` runs a
     * corpus unit whose files a project walker would not collect, and both
     * transports have to be able to say which files those are or only the
     * in-process one could run a corpus.
     *
     * A server that does not understand it lowers the project instead. That is
     * a visibly different answer, not a silently wrong one — the result names
     * the files it read.
     */
    files?: readonly string[];
}

/**
 * What the compiler understood from a revision.
 *
 * `parseErrors` is carried raw and separately from `model.errors`, because
 * domain routing is the *caller's* decision, not the compiler's: the same
 * failure is a `sysml` error when MEMO is the validator and a `memo-ingest`
 * warning when something else was. A compiler that stamped a domain here would
 * be answering a question it was not asked.
 */
export interface MemoIr {
    irVersion: string;
    model: MemoModelDTO;
    parseErrors: ParseError[];
    /** True when lowering read the revision with no parse failures. */
    accepted: boolean;
    /** Canonical AST-level IR. `model` is its Memo projection for compatibility. */
    sysml: SysmlIR;
}

export interface EmitIrResult {
    outcome: 'ir';
    protocolVersion: string;
    revision: number;
    ir: MemoIr;
}

/**
 * The answer to a request the world moved past.
 *
 * Returning the computed-but-stale IR would be the worse failure: the canvas
 * would draw a revision the user has already edited away from, with no way to
 * tell. Naming the newer revision lets the client wait for the answer it
 * actually wants.
 */
export interface EmitIrSuperseded {
    outcome: 'superseded';
    protocolVersion: string;
    revision: number;
    supersededBy: number;
}

export type EmitIrResponse = EmitIrResult | EmitIrSuperseded;

/** One-shot `sysmlc check --format json` / `emit-ir --format json` output. */
export interface SysmlcCheckOutput {
    protocolVersion: string;
    accepted: boolean;
    parseErrors: ParseError[];
}

export interface SysmlcEmitIrOutput {
    protocolVersion: string;
    ir: MemoIr;
}

export class ProtocolVersionError extends Error {
    constructor(readonly expected: string, readonly actual: string | undefined, where: string) {
        super(
            `${where} speaks protocol ${actual ?? '(none advertised)'}, but this build speaks `
            + `${expected}. Major versions must match. Update the compiler, or pin one that matches.`,
        );
        this.name = 'ProtocolVersionError';
    }
}

function major(version: string): string | undefined {
    return /^(\d+)\./.exec(version)?.[1];
}

/** Same major version, both sides parseable. Anything else is incompatible. */
export function isProtocolCompatible(theirs: string | undefined, ours = SYSMLC_PROTOCOL_VERSION): boolean {
    if (!theirs) return false;
    const mine = major(ours);
    const yours = major(theirs);
    return mine !== undefined && mine === yours;
}

export function assertProtocolCompatible(
    theirs: string | undefined,
    where: string,
    ours = SYSMLC_PROTOCOL_VERSION,
): void {
    if (!isProtocolCompatible(theirs, ours)) throw new ProtocolVersionError(ours, theirs, where);
}
