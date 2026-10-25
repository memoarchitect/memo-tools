import { describe, expect, it } from 'vitest';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// ─── A UI element navigates to a screen ──────────────────────────────────────
//
// Activating an element opens another screen: navigation, not containment. `NavigatesTo` is the relation that
// says so, from the element to the screen (a UIElement whose form is a screen); the screen layout view follows
// it to the target screen's capture.
// ─────────────────────────────────────────────────────────────────────────────

describe.runIf(compilerConfigured && examplesPresent)('NavigatesTo', () => {
    it('relates a UI element to the screen it opens', async () => {
        const source = `package seeded_navigation {
    private import memo_architecture_implementation_ui::*;
    private import memo_examples_ui_screen_regions_architecture_implementation_ui::*;
    connection : NavigatesTo connect element ::> elMainScreen.elDrugSelectorRegion to screen ::> elSettingsScreen;
}`;
        await withExample({ 'model/catalog/seeded_navigation.sysml': source }, project => {
            const links = project.model.relationships.filter(r => r.type === 'navigatesTo');
            expect(links.map(r => [r.sourceId.split('::').slice(-1)[0], r.targetId.split('::').slice(-1)[0]]))
                .toEqual([['elDrugSelectorRegion', 'elSettingsScreen']]);
            expect(project.registries?.relationshipRegistry?.relTypeNames()).toContain('navigatesTo');
        }, 'ui-screen-regions');
    }, 180_000);
});
