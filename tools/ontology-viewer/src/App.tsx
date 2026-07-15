import { useState, useCallback, useRef } from 'react';
import type { OntologyData } from './types';
import { loadFromFile } from './loader';
import { OntologyViewer } from './OntologyViewer';

export function App() {
    const [data, setData] = useState<OntologyData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = useCallback(async (file: File) => {
        setLoading(true);
        setError(null);
        try {
            const parsed = await loadFromFile(file);
            setData(parsed);
        } catch (err) {
            setError(`Failed to parse file: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const handleLoadDemo = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Try loading from the demo path (when served alongside examples)
            const resp = await fetch('/demo/memo-model.json');
            if (!resp.ok) throw new Error('Demo data not found. Export a model with `memo export json` and load it here.');
            const json = await resp.json();
            const { parseModelJson } = await import('./loader');
            setData(parseModelJson(json));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    // Check for embedded data (from static build) — handled in useEffect
    if (!data && typeof window !== 'undefined' && (window as any).__ONTOLOGY_DATA__ && !loading) {
        const raw = (window as any).__ONTOLOGY_DATA__;
        (window as any).__ONTOLOGY_DATA__ = null; // prevent re-trigger
        handleFile(new File([JSON.stringify(raw)], 'embedded.json', { type: 'application/json' }));
    }

    if (data) {
        return (
            <div className="h-screen flex flex-col">
                <OntologyViewer data={data} onBack={() => setData(null)} />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: '#F7F7F5' }}>
            <div className="max-w-lg w-full mx-4">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: '#1B3A4B' }}>
                        <span className="text-2xl font-bold" style={{ color: '#2DD4A8' }}>M</span>
                    </div>
                    <h1 className="text-2xl font-bold" style={{ color: '#1B3A4B' }}>MEMO Ontology Viewer</h1>
                    <p className="text-sm mt-2" style={{ color: '#6B7280' }}>
                        Read-only viewer for MEMO ontology packages.
                        <br />Load a model JSON export to inspect kinds, relationships, and viewpoints.
                    </p>
                </div>

                {/* Drop zone */}
                <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-xl p-8 text-center cursor-pointer transition-all"
                    style={{
                        background: '#FFFFFF',
                        border: '2px dashed #E5E5E0',
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.borderColor = '#2DD4A8';
                        e.currentTarget.style.background = '#2DD4A808';
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.borderColor = '#E5E5E0';
                        e.currentTarget.style.background = '#FFFFFF';
                    }}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleFileInput}
                        className="hidden"
                    />
                    <div className="text-3xl mb-3">{loading ? '\u23F3' : '\uD83D\uDCC2'}</div>
                    <div className="text-sm font-medium" style={{ color: '#374151' }}>
                        {loading ? 'Loading...' : 'Drop a JSON file here or click to browse'}
                    </div>
                    <div className="text-xs mt-1" style={{ color: '#9CA3AF' }}>
                        Accepts output from <code className="px-1 py-0.5 rounded" style={{ background: '#F0F0ED' }}>memo export json</code>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="mt-4 p-3 rounded-lg text-sm" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                        {error}
                    </div>
                )}

                {/* How to generate */}
                <div className="mt-6 rounded-lg p-4" style={{ background: '#FFFFFF', border: '1px solid #E5E5E0' }}>
                    <h3 className="text-xs font-medium mb-2" style={{ color: '#9CA3AF' }}>How to generate a model JSON</h3>
                    <div className="space-y-2 text-xs" style={{ color: '#6B7280' }}>
                        <div className="flex items-start gap-2">
                            <span className="font-mono px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: '#F0F0ED' }}>1</span>
                            <span>Navigate to your MEMO project directory</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="font-mono px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: '#F0F0ED' }}>2</span>
                            <span>Run <code className="px-1 py-0.5 rounded" style={{ background: '#F0F0ED' }}>memo export json -o model.json</code></span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="font-mono px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: '#F0F0ED' }}>3</span>
                            <span>Load the exported <code className="px-1 py-0.5 rounded" style={{ background: '#F0F0ED' }}>model.json</code> file here</span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-6 text-center text-xs" style={{ color: '#D1D5DB' }}>
                    MEMO — Model-Based Systems Engineering for Medical Devices
                </div>
            </div>
        </div>
    );
}
