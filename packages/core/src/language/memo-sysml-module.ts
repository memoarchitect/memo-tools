import {
    createDefaultCoreModule,
    createDefaultSharedCoreModule,
    type DefaultSharedCoreModuleContext,
    EmptyFileSystem,
    inject,
    type LangiumCoreServices,
    type LangiumSharedCoreServices,
    type Module,
    type PartialLangiumCoreServices,
} from 'langium';
import { MemoSysMLGeneratedModule, MemoSysMLGeneratedSharedModule } from './generated/module.js';

/**
 * Declaration of custom services — extend as needed for validation,
 * scoping, completeness tracking, etc.
 */
export type MemoSysMLAddedServices = {
    // placeholder for future custom services
};

/**
 * Union of Langium default services and MEMO custom services.
 */
export type MemoSysMLServices = LangiumCoreServices & MemoSysMLAddedServices;

/**
 * Dependency injection module that overrides default Langium services
 * with MEMO-specific implementations.
 */
export const MemoSysMLModule: Module<MemoSysMLServices, PartialLangiumCoreServices & MemoSysMLAddedServices> = {
    // custom overrides go here
};

/**
 * Create the full set of services for the MemoSysML language.
 * Used by both the CLI and the LSP server.
 */
export function createMemoSysMLServices(context: DefaultSharedCoreModuleContext = EmptyFileSystem): {
    shared: LangiumSharedCoreServices;
    MemoSysML: MemoSysMLServices;
} {
    const shared = inject(
        createDefaultSharedCoreModule(context),
        MemoSysMLGeneratedSharedModule
    );
    const MemoSysML = inject(
        createDefaultCoreModule({ shared }),
        MemoSysMLGeneratedModule,
        MemoSysMLModule
    );
    shared.ServiceRegistry.register(MemoSysML);
    return { shared, MemoSysML };
}
