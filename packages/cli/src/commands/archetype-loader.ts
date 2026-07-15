import { resolve } from 'node:path';
import { findConfigFile, loadMethodologyDescriptor, type MethodologyPart } from '@memo/core';

export interface ArchetypeInfo {
    id: string;
    label: string;
    description: string;
    category: string;
    templateDir: string;
    includedLayers: string[];
    includedStandards: string[];
}

const FALLBACK_ARCHETYPES: ArchetypeInfo[] = [
    {
        id: 'samd',
        label: 'Software as Medical Device (SaMD)',
        description: 'Clinical decision support, diagnostic algorithm, AI/ML tool, mobile medical app',
        category: 'device-class',
        templateDir: 'samd',
        includedLayers: ['context', 'requirements', 'functions', 'logical_structure', 'software_structure', 'risk', 'assurance', 'cybersecurity'],
        includedStandards: ['ISO 14971', 'IEC 62304', 'IEC 82304-1', 'FDA Cybersecurity Guidance'],
    },
    {
        id: 'connected',
        label: 'Connected / IoT Device',
        description: 'Remote monitoring, wearable, smart device with cloud connectivity and cybersecurity requirements',
        category: 'device-class',
        templateDir: 'connected-device',
        includedLayers: ['context', 'requirements', 'functions', 'logical_structure', 'logical_interfaces', 'software_structure', 'hardware_structure', 'risk', 'assurance', 'cybersecurity'],
        includedStandards: ['ISO 14971', 'IEC 62304', '21 CFR 820', 'FDA Cybersecurity Guidance'],
    },
    {
        id: 'monitoring',
        label: 'Monitoring / Diagnostic Device',
        description: 'Patient monitor, ECG, SpO2, vital signs, bedside diagnostic equipment',
        category: 'device-class',
        templateDir: 'monitoring-device',
        includedLayers: ['context', 'requirements', 'functions', 'logical_structure', 'logical_interfaces', 'physical_interfaces', 'software_structure', 'hardware_structure', 'risk', 'assurance'],
        includedStandards: ['ISO 14971', 'IEC 62304', 'IEC 60601-1', '21 CFR 820'],
    },
    {
        id: 'infusion_pump',
        label: 'Infusion / Drug Delivery Device',
        description: 'Infusion pump, syringe driver, implantable drug delivery, dosing device',
        category: 'device-class',
        templateDir: 'infusion-pump',
        includedLayers: ['context', 'requirements', 'functions', 'logical_structure', 'logical_interfaces', 'physical_interfaces', 'software_structure', 'hardware_structure', 'behavior', 'risk', 'arch_risk', 'assurance', 'cybersecurity'],
        includedStandards: ['ISO 14971', 'IEC 62304', 'IEC 60601-1', '21 CFR 820', 'ISO 13485'],
    },
    {
        id: 'blank',
        label: 'Blank Project',
        description: 'Start from scratch with a minimal SysML shell',
        category: 'device-class',
        templateDir: '',
        includedLayers: [],
        includedStandards: [],
    },
];

function partToArchetype(part: MethodologyPart): ArchetypeInfo {
    const multi = part.multiAttributes;
    return {
        id: part.partName,
        label: String(part.attributes.label ?? part.attributes.name ?? part.partName),
        description: String(part.attributes.description ?? ''),
        category: String(part.attributes.category ?? 'device-class'),
        templateDir: String(part.attributes.templateDir ?? ''),
        includedLayers: (multi.includedLayer ?? []).map(String).filter(s => s !== ''),
        includedStandards: (multi.includedStandard ?? []).map(String).filter(s => s !== ''),
    };
}

export async function loadArchetypes(fromDir: string): Promise<ArchetypeInfo[]> {
    const configPath = findConfigFile(fromDir);
    if (!configPath) return FALLBACK_ARCHETYPES;

    try {
        const descriptor = await loadMethodologyDescriptor(configPath, resolve(configPath, '..'));
        for (const folder of descriptor.folders) {
            const archetypeParts = folder.parts['Archetype'];
            if (archetypeParts && archetypeParts.length > 0) {
                return archetypeParts.map(partToArchetype);
            }
        }
    } catch {
        // methodology loading failed — fall through
    }

    return FALLBACK_ARCHETYPES;
}

export function findArchetype(archetypes: ArchetypeInfo[], id: string): ArchetypeInfo | undefined {
    return archetypes.find(a => a.id === id);
}

export function deviceClassArchetypes(archetypes: ArchetypeInfo[]): ArchetypeInfo[] {
    return archetypes.filter(a => a.category === 'device-class');
}

export function profileArchetypes(archetypes: ArchetypeInfo[]): ArchetypeInfo[] {
    return archetypes.filter(a => a.category === 'profile');
}
