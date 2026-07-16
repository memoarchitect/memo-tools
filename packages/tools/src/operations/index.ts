/** Shared Node project operations used by the CLI and server integrations. */
export { initCommand as initializeProject } from '../commands/init.js';
export { validateCommand as validateProject } from '../commands/validate.js';
export { saveElementToFile as createElement } from '../server/persistor.js';
export { compileMarkdownDocument as generateDocument } from '../dhf/document-compiler.js';
export { buildProjectSnapshot, serializeForInlineScript } from './project-snapshot.js';
export { devCommand as startProjectServer } from '../commands/dev.js';
