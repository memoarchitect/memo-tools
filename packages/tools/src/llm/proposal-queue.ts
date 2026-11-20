// ─── Proposals waiting for the engineer ──────────────────────────────────────
//
// An AI coding tool (Claude Code, Cursor, …) talking to `memo-architect mcp` proposes model edits with
// the same tools the Model Assistant uses. It runs in another process, so its proposals are kept in a
// file in the project, `memo.ai-proposals.json`, which Architect lists under AI Tools › Pending changes
// and applies through the same path as an approved chat proposal. Nothing reaches the SysML source
// until the engineer applies it there.
//
// The file is the engineer's own working state, like `memo.user.yaml`: visible in the project and kept
// out of git.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProposedChange } from './chat-engine.js';
import { ensureGitIgnored } from '../server/project-gitignore.js';

export const PROPOSAL_QUEUE_FILE = 'memo.ai-proposals.json';

/** A proposal and where it came from. */
export type QueuedProposal = ProposedChange & {
    /** When it was proposed, ISO 8601. */
    proposedAt: string;
    /** The client that proposed it, as it named itself to the MCP server, when it did. */
    client?: string;
};

export function proposalQueuePath(projectRoot: string): string {
    return join(projectRoot, PROPOSAL_QUEUE_FILE);
}

/** The proposals waiting, oldest first. A missing or unreadable file is an empty queue. */
export function readProposalQueue(projectRoot: string): QueuedProposal[] {
    const path = proposalQueuePath(projectRoot);
    if (!existsSync(path)) return [];
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return Array.isArray(parsed?.proposals) ? parsed.proposals : [];
    } catch {
        return [];
    }
}

function writeProposalQueue(projectRoot: string, proposals: QueuedProposal[]): void {
    const path = proposalQueuePath(projectRoot);
    ensureGitIgnored(projectRoot, PROPOSAL_QUEUE_FILE, 'MEMO Architect: AI proposals waiting for your review');
    // Written whole and renamed into place, so a reader never sees half a file.
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ proposals }, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
}

export function appendProposals(projectRoot: string, changes: ProposedChange[], client?: string): QueuedProposal[] {
    const proposedAt = new Date().toISOString();
    const queue = [...readProposalQueue(projectRoot), ...changes.map(change => ({ ...change, proposedAt, client }))];
    writeProposalQueue(projectRoot, queue);
    return queue;
}

/** Take proposals off the queue, applied or discarded. Returns what is left. */
export function removeProposals(projectRoot: string, ids: readonly string[]): QueuedProposal[] {
    const drop = new Set(ids);
    const queue = readProposalQueue(projectRoot).filter(proposal => !drop.has(proposal.id));
    writeProposalQueue(projectRoot, queue);
    return queue;
}
