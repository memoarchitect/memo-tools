import { describe, expect, it } from 'vitest';
import { computeWorkspaceMembership } from '../model/workspace-membership.js';
import { excludedFor, selectRelease, selectedFeatures } from '../model/variability.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import { validateModel } from '../validator/rule-engine.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
import { releaseFiles } from './helpers/release-fixture.js';

// O2, O3, O4: a release record is one release of one item, with its own part number and revision,
// linked to its item, the records it contains, the interface revisions it implements and the cases
// that verified it. Seeded onto E0 (`helpers/release-fixture.ts`): a software component, three
// systems and an interface at the lower levels, the system of systems on top.

const withReleases = <T>(use: Parameters<typeof withExample<T>>[1], files: Record<string, string> = releaseFiles()) =>
    withExample(files, use, 'ep-lab-family');

describe.runIf(compilerConfigured && examplesPresent)('release records (O2, O3, O4)', () => {
    it('links each record to the definition it releases, not to a usage', async () => {
        await withReleases(project => {
            const m = project.model;
            const name = (id: string) => `${m.elements.get(id)?.shortName}:${m.elements.get(id)?.kind}`;
            const edges = (type: string) => [...m.relationships.values()].filter(r => r.type === type)
                .map(r => `${m.elements.get(r.sourceId)?.shortName} -> ${name(r.targetId)}`).sort();
            expect(edges('releaseOf')).toEqual([
                'relAblation -> AblationGeneratorSystem:System',
                'relAblationIcd -> AblationToMappingIcd:Interface',
                'relEu -> OutputStageSystem:System',
                'relFirmwareA -> EnergyControllerFirmware:SoftwareSystem',
                'relFirmwareB -> EnergyControllerFirmware:SoftwareSystem',
                'relLabV1 -> ElectrophysiologyLab:SystemOfSystems',
                'relMapping -> CardiacMappingSystem:System',
                'relRecording -> SignalRecordingSystem:System',
                'relUs -> OutputStageSystem:System',
            ]);
        });
    }, 120_000);

    it('holds two releases of one definition with different part numbers and revisions (O2)', async () => {
        await withReleases(project => {
            const m = project.model;
            const records = [...m.relationships.values()].filter(r => r.type === 'releaseOf' && m.elements.get(r.targetId)?.shortName === 'EnergyControllerFirmware')
                .map(r => m.elements.get(r.sourceId)!.attributes);
            expect(records.map(a => [a.partNumber, a.revision, a.softwareVersion, a.codeTag])).toEqual([
                ['PN-5001', 'A', '1.0.0', 'fw-1.0.0'],
                ['PN-5002', 'B', '1.1.0', 'fw-1.1.0'],
            ]);
        });
    }, 120_000);

    it('builds a system of systems version that contains three system releases and is verified by a case (O4)', async () => {
        await withReleases(project => {
            const m = project.model;
            const lab = [...m.elements.values()].find(e => e.shortName === 'relLabV1')!;
            const from = (type: string) => [...m.relationships.values()].filter(r => r.type === type && r.sourceId === lab.id)
                .map(r => m.elements.get(r.targetId)?.shortName).sort();
            expect(from('contains')).toEqual(['relAblation', 'relMapping', 'relRecording']);
            expect(from('verifiedByCase')).toEqual(['vcLabIntegration']);
            const ablation = [...m.elements.values()].find(e => e.shortName === 'relAblation')!;
            const ofAblation = (type: string) => [...m.relationships.values()].filter(r => r.type === type && r.sourceId === ablation.id)
                .map(r => m.elements.get(r.targetId)?.shortName).sort();
            expect(ofAblation('contains')).toEqual(['relFirmwareB']);
            expect(ofAblation('implements')).toEqual(['relAblationIcd']);
        });
    }, 120_000);

    it('places a record with the item it releases', async () => {
        await withReleases(project => {
            const membership = computeWorkspaceMembership(project.model, project.registries!);
            const named = (shortName: string) => [...project.model.elements.values()].find(e => e.shortName === shortName)!.id;
            const holders = (shortName: string) => (membership.systems.get(named(shortName)) ?? []).slice().sort();
            expect(holders('relMapping').length).toBeGreaterThan(0);
            expect(holders('relMapping')).toEqual(holders('mapEngine'));
            expect(membership.sos.get(named('relLabV1'))?.length).toBeGreaterThan(0);
            const unassigned = membership.unassigned.map(id => project.model.elements.get(id)?.shortName);
            expect(unassigned.filter(n => n?.startsWith('rel'))).toEqual([]);
        });
    }, 120_000);

    it('judges each record only for the points of its own item: the family is clean, and selectRelease agrees', async () => {
        await withReleases(project => {
            const result = validateModel(project.model, collectApiConstraints(project.api), project.registries!.kindRegistry);
            expect(result.violations.filter(v => ['CR-ONT-088', 'CR-ONT-089', 'CR-ONT-090'].includes(v.ruleId))).toEqual([]);
            for (const record of [...project.model.elements.values()].filter(e => e.kind === 'ReleaseRecord')) {
                expect(selectRelease(project.model, record.id).unresolved, record.shortName).toEqual([]);
            }
        });
    }, 120_000);

    it('builds a project that feeds two releases and the variant it introduced (O7), and places the project with what it feeds', async () => {
        await withReleases(project => {
            const m = project.model;
            const name = (id: string) => m.elements.get(id)?.shortName;
            const edges = (type: string) => [...m.relationships.values()].filter(r => r.type === type).map(r => `${name(r.sourceId)} -> ${name(r.targetId)}`).sort();
            expect(edges('feeds')).toEqual(['prjOutputStages -> relEu', 'prjOutputStages -> relUs']);
            expect(edges('introducedBy')).toEqual(['usOutput -> prjOutputStages']);
            const tracker = [...m.elements.values()].find(e => e.shortName === 'prjOutputStages')!.attributes.trackerLink;
            expect(tracker).toBe('https://tracker.example/PRJ-12');
            // A project follows the releases it feeds (and they follow their item); one that feeds none is Unassigned.
            const membership = computeWorkspaceMembership(m, project.registries!);
            const id = (n: string) => [...m.elements.values()].find(e => e.shortName === n)!.id;
            expect(membership.systems.get(id('prjOutputStages'))).toEqual(membership.systems.get(id('OutputStageSystem')));
            expect(membership.unassigned).toContain(id('prjNothing'));
            expect(membership.unassigned).not.toContain(id('prjOutputStages'));
        });
    }, 120_000);

    it('computes what a selection leaves out the same way for a graph that holds no record (devices)', async () => {
        await withReleases(project => {
            for (const record of [...project.model.elements.values()].filter(e => e.kind === 'ReleaseRecord')) {
                const graph = { elements: project.model.elements, relationships: project.model.relationships };
                expect([...excludedFor(graph, selectedFeatures(graph, record.id))].sort(), record.shortName)
                    .toEqual([...selectRelease(graph, record.id).excluded].sort());
            }
        });
    }, 120_000);

    it('has no version or baseline on a configuration item, and no baseline string on a change request (§8)', async () => {
        for (const [attribute, owner] of [['version', 'ConfigurationItem'], ['baseline', 'ConfigurationItem'], ['affectedBaseline', 'ChangeRequest']]) {
            const files = releaseFiles();
            files['model/sos/stale.sysml'] = `package ep_lab_family_stale {
    private import memo_artifacts_configuration_management::*;
    part stale : ${owner} { attribute :>> ${attribute} = "x"; }
}
`;
            await expect(withReleases(() => 'compiled', files), `${owner}.${attribute}`).rejects.toThrow(new RegExp(attribute));
        }
    }, 120_000);

    it('declares the release dependencies, so a misspelt one does not compile', async () => {
        const files = releaseFiles();
        files['model/sos/release_records.sysml'] = files['model/sos/release_records.sysml'].replace('#Contains dependency from relLabV1', '#Contain dependency from relLabV1');
        await expect(withReleases(() => 'compiled', files)).rejects.toThrow(/Contain\b/);
    }, 120_000);

    // A family may write its items as usages typed directly by a MEMO type and declare no definitions
    // (the Affera model rules, MR-01). A dependency's supplier is any element, so a record of a usage
    // builds the same edge, and the rules judge it without error.
    it('links a record to a usage as well as to a definition', async () => {
        const files = releaseFiles();
        files['model/sos/release_records.sysml'] = files['model/sos/release_records.sysml'].replace(/\}\n$/, `
    part relLabUsage : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-402"; :>> label = "Lab usage release"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "LAB-0002";
        attribute :>> revision = "1";
        attribute :>> modelCommit = "8888888888888888888888888888888888888888";
    }
    #ReleaseOf dependency from relLabUsage to epLab;
}
`);
        await withReleases(project => {
            const m = project.model;
            const record = [...m.elements.values()].find(e => e.shortName === 'relLabUsage')!;
            const item = [...m.relationships.values()].find(r => r.type === 'releaseOf' && r.sourceId === record.id);
            expect(m.elements.get(item!.targetId)?.shortName).toBe('epLab');
            const result = validateModel(m, collectApiConstraints(project.api), project.registries!.kindRegistry);
            expect(result.violations.filter(v => v.ruleId === 'CR-ONT-090')).toEqual([]);
        }, files);
    }, 120_000);
});
