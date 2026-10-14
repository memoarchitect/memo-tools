// ─── --at and --release: the directory a command runs in ─────────────────────
//
// `memo compile` and `memo validate` take `--at <ref>` (the model at a commit, a tag or a branch) and
// `--release <record>` (the SoS version a release record names). Both resolve to a directory and the
// command then runs there exactly as it would anywhere, so there is one compile and one validate and
// a pinned run differs only in where it looks. A pinned directory is a cache of a commit and must not
// be written to: validate is told so (`readOnly`).
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadProjectSettings } from '../model/config-loader.js';
import { findProjectRoot } from '../model/native-project.js';
import { buildRelease, pinWorktree } from '../model/pinned.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import type { PinnedInfo } from '../protocol/messages.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { withToolchainOverrides } from '../toolchain/schema.js';

export interface PinnedTarget {
    /** The directory to run the command in. */
    dir: string;
    /** One line saying what is being run, for stderr. */
    label: string;
    /** What a read-only server shows about it. */
    info: PinnedInfo;
}

/** The directory `--at` or `--release` names, or undefined when neither is given. Exits 1 on a refusal. */
export async function pinnedTarget(projectDir: string | undefined, options: Record<string, unknown>): Promise<PinnedTarget | undefined> {
    const at = typeof options.at === 'string' ? options.at : undefined;
    const release = typeof options.release === 'string' ? options.release : undefined;
    if (!at && !release) return undefined;
    const fail = (message: string): never => {
        console.error(chalk.red(`❌ ${message}`));
        process.exit(1);
    };
    if (at && release) fail('--at and --release are two ways to name the model; give one.');
    const root = findProjectRoot(resolve(projectDir || process.cwd()));
    if (!root) return fail('No MEMO project found (no memo.package.yaml entrypoint).');
    try {
        if (at) {
            const pin = await pinWorktree(root, at);
            return {
                dir: pin.projectDir, label: `the model at ${at} (${pin.sha.slice(0, 7)}), in ${pin.dir}`,
                info: { kind: 'ref', label: at, commits: [{ name: 'model', commit: pin.sha }], notARelease: true },
            };
        }
        const config = withToolchainOverrides(loadProjectSettings(root), options, defaultRegistry);
        const working = await loadProjectModel({ projectRoot: root, config });
        const matches = [...working.model.elements.values()].filter(e => e.attributes?.modelCommit
            && (e.id === release || e.shortName === release || e.attributes.providedId === release));
        if (matches.length !== 1) {
            return fail(matches.length === 0
                ? `"${release}" is not a release record of this model (no element of that id has a modelCommit).`
                : `"${release}" names ${matches.length} release records; use a qualified id.`);
        }
        const build = await buildRelease(root, working, matches[0].id, { config: { toolchain: config.toolchain } });
        const pins = build.releasePins.systems.map(s => `${s.system}@${s.commit.slice(0, 7)}`).join(', ');
        return {
            dir: build.assembly.dir, label: `${build.releasePins.record}: ${build.releasePins.commit.slice(0, 7)} with ${pins}`,
            info: {
                kind: 'release', label: build.releasePins.record,
                commits: [{ name: 'version', commit: build.releasePins.commit }, ...build.releasePins.systems.map(s => ({ name: s.system, commit: s.commit }))],
            },
        };
    } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
    }
}
