import { useState, useMemo } from 'react';
import type { OntologyData, KindInfo, GroupBy } from './types';
import { LAYER_COLORS, LAYER_ORDER } from './constants';

const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
    { id: 'layer', label: 'Layer' },
    { id: 'construct', label: 'Construct' },
];

interface Props {
    data: OntologyData;
    onBack: () => void;
}

export function OntologyViewer({ data, onBack }: Props) {
    const [groupBy, setGroupBy] = useState<GroupBy>('layer');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedKind, setSelectedKind] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'tree' | 'graph'>('tree');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    const toggleGroup = (g: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            next.has(g) ? next.delete(g) : next.add(g);
            return next;
        });
    };

    const { kinds, relationships } = data;

    // Resolve layer colors — prefer data.layers, fallback to defaults
    const layerColors = useMemo(() => {
        const colors: Record<string, string> = { ...LAYER_COLORS };
        for (const l of data.layers) {
            colors[l.id] = l.color;
        }
        return colors;
    }, [data.layers]);

    const filteredKinds = useMemo(() => {
        if (!searchTerm) return kinds;
        const lower = searchTerm.toLowerCase();
        return kinds.filter(k =>
            k.name.toLowerCase().includes(lower) ||
            k.layer.toLowerCase().includes(lower) ||
            k.construct.toLowerCase().includes(lower)
        );
    }, [kinds, searchTerm]);

    const groups = useMemo(() => {
        const map = new Map<string, KindInfo[]>();
        for (const k of filteredKinds) {
            const key = groupBy === 'layer' ? k.layer : k.construct;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(k);
        }
        const entries = [...map.entries()];
        if (groupBy === 'layer') {
            entries.sort((a, b) => {
                const ai = LAYER_ORDER.indexOf(a[0] as any);
                const bi = LAYER_ORDER.indexOf(b[0] as any);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
        } else {
            entries.sort((a, b) => a[0].localeCompare(b[0]));
        }
        return entries;
    }, [filteredKinds, groupBy]);

    const selectedKindInfo = selectedKind ? kinds.find(k => k.name === selectedKind) : null;

    const kindElementCount = useMemo(() => {
        if (!selectedKind) return 0;
        return data.elements.filter(e => e.kind === selectedKind).length;
    }, [selectedKind, data.elements]);

    const kindViewpoints = useMemo(() => {
        if (!selectedKind) return [];
        return data.viewpoints.filter(vp => vp.visibleKinds.includes(selectedKind));
    }, [selectedKind, data.viewpoints]);

    const kindRelationships = useMemo(() => {
        if (!selectedKind) return [];
        const kindElements = new Set(data.elements.filter(e => e.kind === selectedKind).map(e => e.id));
        const rels = data.elementRelationships.filter(r => kindElements.has(r.sourceId) || kindElements.has(r.targetId));
        const typeSet = new Set(rels.map(r => r.type));
        return [...typeSet].sort();
    }, [selectedKind, data.elements, data.elementRelationships]);

    return (
        <div className="flex h-full overflow-hidden">
            {/* Left: Kind tree */}
            <div className="w-72 flex flex-col overflow-hidden" style={{ background: '#FFFFFF', borderRight: '1px solid #E5E5E0' }}>
                <div className="px-4 py-3" style={{ background: 'linear-gradient(135deg, #1B3A4B, #2D6A7A)' }}>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onBack}
                            className="text-xs px-2 py-0.5 rounded"
                            style={{ color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.1)' }}
                        >
                            Back
                        </button>
                        <div className="flex-1">
                            <h2 className="text-sm font-bold tracking-wide" style={{ color: '#2DD4A8' }}>{data.packageName}</h2>
                            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                                {kinds.length} kinds &middot; {relationships.length} relationships
                            </p>
                        </div>
                    </div>
                </div>
                <div className="px-3 py-2.5" style={{ borderBottom: '1px solid #E5E5E0' }}>
                    <input
                        type="text"
                        placeholder="Search kinds..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none"
                        style={{ background: '#F7F7F5', border: '1px solid #E5E5E0', color: '#1a1a1a' }}
                    />
                </div>
                <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ borderBottom: '1px solid #E5E5E0' }}>
                    <span className="text-xs" style={{ color: '#9CA3AF' }}>Group:</span>
                    {GROUP_OPTIONS.map(g => (
                        <button
                            key={g.id}
                            onClick={() => setGroupBy(g.id)}
                            className="px-2 py-0.5 text-xs rounded-md"
                            style={groupBy === g.id
                                ? { background: '#1B3A4B', color: '#2DD4A8' }
                                : { background: '#F0F0ED', color: '#6B7280' }}
                        >
                            {g.label}
                        </button>
                    ))}
                </div>
                <div className="flex-1 overflow-y-auto text-xs py-1">
                    {groups.map(([group, gKinds]) => {
                        const collapsed = collapsedGroups.has(group);
                        const color = groupBy === 'layer' ? (layerColors[group] || '#666') : '#6B7280';
                        return (
                            <div key={group} className="mb-0.5">
                                <div
                                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
                                    style={{ borderRadius: '6px', margin: '0 4px' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#F0F0ED')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    onClick={() => toggleGroup(group)}
                                >
                                    <span className="w-2.5 h-2.5 rounded flex-shrink-0" style={{ backgroundColor: color, borderRadius: '3px' }} />
                                    <span className="font-medium capitalize flex-1" style={{ color: '#374151' }}>{group}</span>
                                    <span style={{ color: '#9CA3AF' }}>{gKinds.length}</span>
                                    <span style={{ color: '#D1D5DB' }}>{collapsed ? '\u25B8' : '\u25BE'}</span>
                                </div>
                                {!collapsed && gKinds.map(k => (
                                    <div
                                        key={k.name}
                                        className="px-3 py-1 ml-6 cursor-pointer flex items-center gap-1.5"
                                        style={{
                                            borderRadius: '6px',
                                            background: selectedKind === k.name ? '#2DD4A818' : 'transparent',
                                            color: selectedKind === k.name ? '#1B3A4B' : '#374151',
                                            fontWeight: selectedKind === k.name ? 500 : 400,
                                        }}
                                        onMouseEnter={e => { if (selectedKind !== k.name) e.currentTarget.style.background = '#F0F0ED'; }}
                                        onMouseLeave={e => { if (selectedKind !== k.name) e.currentTarget.style.background = 'transparent'; }}
                                        onClick={() => setSelectedKind(k.name)}
                                    >
                                        <span className="truncate">{k.name}</span>
                                        <span style={{ color: '#9CA3AF', fontSize: '10px' }}>{k.construct}</span>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Center: Detail area */}
            <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#F7F7F5' }}>
                {/* Tab bar */}
                <div className="flex items-center gap-1 px-4 py-2" style={{ borderBottom: '1px solid #E5E5E0', background: '#FFFFFF' }}>
                    <button
                        onClick={() => setActiveTab('tree')}
                        className="px-3 py-1 text-xs rounded-md"
                        style={activeTab === 'tree'
                            ? { background: '#1B3A4B', color: '#2DD4A8' }
                            : { background: '#F0F0ED', color: '#6B7280' }}
                    >
                        Detail View
                    </button>
                    <button
                        onClick={() => setActiveTab('graph')}
                        className="px-3 py-1 text-xs rounded-md"
                        style={activeTab === 'graph'
                            ? { background: '#1B3A4B', color: '#2DD4A8' }
                            : { background: '#F0F0ED', color: '#6B7280' }}
                    >
                        Card View
                    </button>
                    <div className="flex-1" />
                    <span className="text-xs" style={{ color: '#9CA3AF' }}>
                        {data.elements.length} elements &middot; {data.elementRelationships.length} relationships
                    </span>
                </div>

                {activeTab === 'tree' && (
                    <div className="flex-1 overflow-y-auto p-6">
                        {!selectedKindInfo && (
                            <div className="flex items-center justify-center h-full" style={{ color: '#9CA3AF' }}>
                                <div className="text-center">
                                    <div className="text-4xl mb-3" style={{ color: '#2DD4A8' }}>{'\u25C9'}</div>
                                    <div className="text-sm font-medium">Select a kind from the tree</div>
                                    <div className="text-xs mt-1">{kinds.length} kinds across {groups.length} groups</div>
                                </div>
                            </div>
                        )}
                        {selectedKindInfo && (
                            <div className="max-w-2xl">
                                <div className="flex items-center gap-3 mb-4">
                                    <span className="w-3 h-3 rounded" style={{ backgroundColor: layerColors[selectedKindInfo.layer] || '#666' }} />
                                    <h2 className="text-lg font-semibold" style={{ color: '#1a1a1a' }}>{selectedKindInfo.name}</h2>
                                </div>
                                <div className="flex gap-2 mb-4 flex-wrap">
                                    <span className="px-2 py-0.5 text-xs rounded-md font-medium"
                                        style={{ background: (layerColors[selectedKindInfo.layer] || '#666') + '18', color: layerColors[selectedKindInfo.layer] || '#666' }}>
                                        {selectedKindInfo.layer} layer
                                    </span>
                                    <span className="px-2 py-0.5 text-xs rounded-md" style={{ background: '#F0F0ED', color: '#6B7280' }}>
                                        {selectedKindInfo.construct}
                                    </span>
                                    <span className="px-2 py-0.5 text-xs rounded-md" style={{ background: '#F0F0ED', color: '#6B7280' }}>
                                        {kindElementCount} instances
                                    </span>
                                </div>

                                {/* Relationships involving this kind */}
                                {kindRelationships.length > 0 && (
                                    <div className="mb-4">
                                        <h3 className="text-xs font-medium mb-2" style={{ color: '#9CA3AF' }}>Relationships</h3>
                                        <div className="flex flex-wrap gap-1.5">
                                            {kindRelationships.map(r => (
                                                <span key={r} className="px-2 py-0.5 text-xs rounded-full" style={{ background: '#FEF3C7', color: '#92400E' }}>
                                                    {r}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Viewpoints */}
                                {kindViewpoints.length > 0 && (
                                    <div className="mb-4">
                                        <h3 className="text-xs font-medium mb-2" style={{ color: '#9CA3AF' }}>Viewpoints</h3>
                                        <div className="flex flex-wrap gap-1.5">
                                            {kindViewpoints.map(vp => (
                                                <span key={vp.id} className="px-2 py-0.5 text-xs rounded-full" style={{ background: '#EFF6FF', color: '#2563EB' }}>
                                                    {vp.label}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Instances */}
                                {kindElementCount > 0 && (
                                    <div className="mb-4">
                                        <h3 className="text-xs font-medium mb-2" style={{ color: '#9CA3AF' }}>Instances ({kindElementCount})</h3>
                                        <div className="space-y-1">
                                            {data.elements
                                                .filter(e => e.kind === selectedKind)
                                                .slice(0, 30)
                                                .map(el => (
                                                    <div key={el.id} className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-2" style={{ background: '#FFFFFF', border: '1px solid #E5E5E0' }}>
                                                        <span style={{ color: '#374151' }}>{el.name}</span>
                                                        {el.file && <span style={{ color: '#D1D5DB', fontSize: '10px' }}>{el.file.split('/').pop()}</span>}
                                                    </div>
                                                ))}
                                            {kindElementCount > 30 && (
                                                <div className="text-xs px-3 py-1" style={{ color: '#9CA3AF' }}>
                                                    ...and {kindElementCount - 30} more
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'graph' && (
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                            {groups.map(([group, gKinds]) => {
                                const collapsed = collapsedGroups.has(group);
                                const color = groupBy === 'layer' ? (layerColors[group] || '#666') : '#6B7280';
                                return (
                                    <div key={group} className="rounded-xl overflow-hidden" style={{ border: `2px solid ${color}30`, background: '#FFFFFF' }}>
                                        <div
                                            className="flex items-center gap-2 px-4 py-2.5 cursor-pointer"
                                            style={{ background: `${color}10`, borderBottom: `1px solid ${color}20` }}
                                            onClick={() => toggleGroup(group)}
                                        >
                                            <span className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
                                            <span className="text-sm font-medium capitalize flex-1" style={{ color: '#1a1a1a' }}>{group}</span>
                                            <span className="text-xs" style={{ color: '#9CA3AF' }}>{gKinds.length} kinds</span>
                                            <span style={{ color: '#D1D5DB' }}>{collapsed ? '\u25B8' : '\u25BE'}</span>
                                        </div>
                                        {!collapsed && (
                                            <div className="p-2">
                                                {gKinds.map(k => (
                                                    <div
                                                        key={k.name}
                                                        className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg cursor-pointer mb-0.5"
                                                        style={{
                                                            background: selectedKind === k.name ? `${color}15` : 'transparent',
                                                            border: selectedKind === k.name ? `1px solid ${color}30` : '1px solid transparent',
                                                        }}
                                                        onMouseEnter={e => (e.currentTarget.style.background = `${color}08`)}
                                                        onMouseLeave={e => (e.currentTarget.style.background = selectedKind === k.name ? `${color}15` : 'transparent')}
                                                        onClick={() => setSelectedKind(k.name)}
                                                    >
                                                        <span className="font-medium" style={{ color: '#1a1a1a' }}>{k.name}</span>
                                                        <span style={{ color: '#9CA3AF' }}>{k.construct}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Relationships */}
                        {relationships.length > 0 && (
                            <div className="mt-6">
                                <h3 className="text-sm font-medium mb-3" style={{ color: '#1a1a1a' }}>Relationship Types ({relationships.length})</h3>
                                <div className="flex flex-wrap gap-2">
                                    {relationships.map(r => (
                                        <span key={r.name} className="px-3 py-1 text-xs rounded-full" style={{ background: '#F0F0ED', color: '#374151', border: '1px solid #E5E5E0' }}>
                                            {r.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
