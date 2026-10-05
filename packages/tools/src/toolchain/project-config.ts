// ─── A project's settings ────────────────────────────────────────────────────
//
// Settings are optional: a project with none is complete, because a MEMO project
// declares its identity in SysML, not in YAML.
// ─────────────────────────────────────────────────────────────────────────────

import { findConfigFile, loadProjectSettings } from '../model/config-loader.js';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import type { MEMOConfig } from '../model/config.js';

/** The project's effective settings. */
export function loadProjectConfig(projectDir: string): MEMOConfig {
    const configPath = findConfigFile(projectDir);
    return configPath ? loadAndResolveConfig(configPath) : loadProjectSettings(projectDir);
}
