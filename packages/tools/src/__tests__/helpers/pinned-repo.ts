// ─── A family repository with real history, for pinned builds ────────────────
//
// E0 plus the release fixture, in a throwaway git repository, each system changed in a commit of
// its own so a release can pin it at a different commit than its neighbours:
//
//   c1  the family (records not yet written: a record cannot hold the hash of the commit that adds it)
//   c2  mapping changes                      (tag `rc-mapping`)
//   c3  ablation changes; mapping and recording change again, so c3 holds different text for them than c2 and c1
//   c4  the release records of c1 to c3: the SoS version relLabV1 is c3 and pins mapping@c2,
//       ablation@c3 and recording@c1
//   c5  `CatheterLocation` renamed in shared/ and in mapping (the working tree stays valid)
//   c6  further records, each a case the build must refuse or map back
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { RELEASE_RECORDS, releaseFiles } from './release-fixture.js';

export interface FamilyRepo {
    root: string;
    c1: string; c2: string; c3: string; c4: string; c5: string; c6: string;
    remove(): void;
}

const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

const record = (name: string, itemType: string, commit: string, id: number, contains: string[] = []) => `
    part ${name} : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-${id}"; :>> label = "${name}"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-${id}";
        attribute :>> revision = "A";
        attribute :>> modelCommit = "${commit}";
    }
    #ReleaseOf dependency from ${name} to ${itemType};${contains.length ? `\n    #Contains dependency from ${name} to ${contains.join(', ')};` : ''}`;

export function createFamilyRepo(): FamilyRepo {
    const source = resolve(__dirname, '../../../../../../memo/examples/ep-lab-family');
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'memo-family-')));
    cpSync(source, root, { recursive: true, filter: path => !path.includes('/.memo') });
    for (const [path, text] of Object.entries(releaseFiles())) {
        if (path.endsWith('release_records.sysml')) continue;
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }
    // No .gitignore: a family's own may not name `.memo`, and the pinned caches must not depend on it.
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'test');
    const commit = (message: string) => { git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', message); return git(root, 'rev-parse', 'HEAD'); };
    const edit = (file: string, from: string, to: string) => {
        const text = readFileSync(join(root, file), 'utf8');
        if (!text.includes(from)) throw new Error(`${file} lacks ${from}`);
        writeFileSync(join(root, file), text.split(from).join(to));
    };
    const c1 = commit('c1 family');
    edit('model/systems/mapping/mapping_system.sysml', 'Mapping workstation', 'Mapping workstation rev B');
    const c2 = commit('c2 mapping');
    git(root, 'tag', 'rc-mapping', c2);
    edit('model/systems/ablation/ablation_system.sysml', 'Generator console', 'Generator console rev B');
    // Mapping and recording move on at c3 too, so a release that pins them earlier reads something else than c3 holds.
    edit('model/systems/mapping/mapping_system.sysml', 'rev B', 'rev C');
    edit('model/systems/recording/recording_system.sysml', 'Amplifier', 'Amplifier rev X');
    const c3 = commit('c3 ablation');
    const placeholders: Record<string, string> = { '1': c1, '2': c2, '3': c3, '4': c2, '5': c3, '6': c1, '7': c3, '8': c3 };
    let records = RELEASE_RECORDS;
    for (const [digit, sha] of Object.entries(placeholders)) records = records.split(digit.repeat(40)).join(sha);
    writeFileSync(join(root, 'model/sos/release_records.sysml'), records);
    const c4 = commit('c4 release records');
    edit('model/shared/shared.sysml', 'CatheterLocation', 'CatheterPose');
    edit('model/systems/mapping/mapping_system.sysml', 'CatheterLocation', 'CatheterPose');
    const c5 = commit('c5 rename');
    const lab = 'ElectrophysiologyLab';
    const extra = [
        record('relLabV2', lab, c5, 501, ['relMapping', 'relAblation', 'relRecording']),
        record('relLabOld', lab, c1, 502, ['relMapping', 'relAblation', 'relRecording']),
        record('relFirmwareLate', 'EnergyControllerFirmware', c4, 503),
        record('relAblationLate', 'AblationGeneratorSystem', c3, 504, ['relFirmwareLate']),
        record('relLabLevel', lab, c5, 505, ['relMapping', 'relAblationLate', 'relRecording']),
        record('relLabPartial', lab, c3, 506, ['relMapping', 'relAblation']),
        record('relLabIcdOnly', lab, c3, 507, ['relAblationIcd']),
    ].join('\n');
    const text = readFileSync(join(root, 'model/sos/release_records.sysml'), 'utf8');
    writeFileSync(join(root, 'model/sos/release_records.sysml'), text.replace(/\}\s*$/, `${extra}\n}\n`));
    const c6 = commit('c6 more records');
    return { root, c1, c2, c3, c4, c5, c6, remove: () => { git(root, 'worktree', 'prune'); rmSync(root, { recursive: true, force: true }); } };
}
