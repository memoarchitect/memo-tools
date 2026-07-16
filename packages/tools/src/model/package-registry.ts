// ─── Package Registry ──────────────────────────────────────────────────────────
//
// Tracks SysML packages across parsed documents and resolves cross-file
// qualified name references via import declarations.
//
// Design:
//   - Each parsed document contributes packages to a global registry
//   - ImportDeclarations build visibility maps per package
//   - resolveRef() uses imports to find elements across packages
//   - Supports wildcard imports (::*) and named imports (::SpecificType)
// ─────────────────────────────────────────────────────────────────────────────

import type { Model, PackageDeclaration, ImportDeclaration } from '../language/generated/ast.js';
import type { ParsedDocument } from './parser-utils.js';

/** A registered package with its contents */
export interface PackageEntry {
    /** Fully qualified package name */
    qualifiedName: string;
    /** Whether this is a library package (definitions only, no instances) */
    isLibrary: boolean;
    /** Element IDs directly contained in this package */
    elementIds: string[];
    /** Import paths declared in this package */
    imports: ImportEntry[];
    /** Child package names */
    children: string[];
    /** Source file path */
    file: string;
}

/** A parsed import declaration */
export interface ImportEntry {
    /** Full import path, e.g. "MEMO_Ontology_Risk::*" */
    path: string;
    /** The package being imported, e.g. "MEMO_Ontology_Risk" */
    packageName: string;
    /** Whether this is a wildcard import (::*) */
    isWildcard: boolean;
    /** Specific name imported (for named imports), e.g. "Hazard" */
    namedImport?: string;
}

/**
 * Registry of all packages across parsed documents.
 * Provides qualified name resolution using import visibility.
 */
export class PackageRegistry {
    /** All registered packages by qualified name */
    private packages = new Map<string, PackageEntry>();

    /** Element ID → containing package qualified name */
    private elementToPackage = new Map<string, string>();

    /** Build the registry from parsed documents */
    buildFromDocuments(documents: ParsedDocument[]): void {
        this.packages.clear();
        this.elementToPackage.clear();

        for (const { document, filePath } of documents) {
            const model = document.parseResult.value;
            this.collectPackages(model, filePath);
        }
    }

    /** Register an element as belonging to a package */
    registerElement(elementId: string, packageName: string): void {
        this.elementToPackage.set(elementId, packageName);
        const pkg = this.packages.get(packageName);
        if (pkg && !pkg.elementIds.includes(elementId)) {
            pkg.elementIds.push(elementId);
        }
    }

    /** Get the package containing an element */
    getPackageForElement(elementId: string): string | undefined {
        return this.elementToPackage.get(elementId);
    }

    /** Get all registered packages */
    getPackages(): Map<string, PackageEntry> {
        return this.packages;
    }

    /** Get a package by qualified name */
    getPackage(qualifiedName: string): PackageEntry | undefined {
        return this.packages.get(qualifiedName);
    }

    /** Check if a package is marked as a library package */
    isLibraryPackage(qualifiedName: string): boolean {
        return this.packages.get(qualifiedName)?.isLibrary ?? false;
    }

    /**
     * Resolve a qualified name reference from within a given package context.
     *
     * Resolution order:
     * 1. Local lookup — element exists in the same package
     * 2. Wildcard imports — search all packages imported with ::*
     * 3. Named imports — exact match on imported name
     * 4. Global fallback — search all elements (backward compat)
     */
    resolveElementId(ref: string, fromPackage: string, allElementIds: Set<string>): string | undefined {
        if (!ref) return undefined;

        // If ref is qualified (e.g., "InfusionPump::hazOverInfusion"), resolve directly
        if (ref.includes('::')) {
            const parts = ref.split('::');
            const localName = parts[parts.length - 1];
            const pkgPath = parts.slice(0, -1).join('::');

            // Check if element exists in the referenced package
            const pkg = this.packages.get(pkgPath);
            if (pkg && pkg.elementIds.includes(localName)) {
                return localName;
            }
            // Fall through to use just the local name
            return allElementIds.has(localName) ? localName : undefined;
        }

        // Unqualified reference — search local package first
        const localPkg = this.packages.get(fromPackage);
        if (localPkg && localPkg.elementIds.includes(ref)) {
            return ref;
        }

        // Search through imports
        if (localPkg) {
            for (const imp of localPkg.imports) {
                if (imp.isWildcard) {
                    // Wildcard import: check if element exists in imported package
                    const importedPkg = this.packages.get(imp.packageName);
                    if (importedPkg && importedPkg.elementIds.includes(ref)) {
                        return ref;
                    }
                } else if (imp.namedImport === ref) {
                    // Named import matches
                    return ref;
                }
            }
        }

        // Global fallback — backward compatibility for flat namespace
        return allElementIds.has(ref) ? ref : undefined;
    }

    // ─── Private ─────────────────────────────────────────────────────────

    private collectPackages(model: Model, filePath: string): void {
        for (const member of model.members) {
            if (member.$type === 'PackageDeclaration') {
                this.collectPackage(member as PackageDeclaration, filePath, '');
            }
        }
    }

    private collectPackage(pkg: PackageDeclaration, filePath: string, parentQualifiedName: string): void {
        const qualifiedName = parentQualifiedName
            ? `${parentQualifiedName}::${pkg.name}`
            : pkg.name;

        const imports: ImportEntry[] = [];
        const children: string[] = [];

        for (const member of pkg.members) {
            if (member.$type === 'ImportDeclaration') {
                const imp = member as ImportDeclaration;
                imports.push(parseImport(imp.path));
            } else if (member.$type === 'PackageDeclaration') {
                const childPkg = member as PackageDeclaration;
                const childQN = `${qualifiedName}::${childPkg.name}`;
                children.push(childQN);
                this.collectPackage(childPkg, filePath, qualifiedName);
            }
        }

        this.packages.set(qualifiedName, {
            qualifiedName,
            isLibrary: !!pkg.isLibrary,
            elementIds: [],
            imports,
            children,
            file: filePath,
        });

        // If this is a child package, register it with parent
        if (parentQualifiedName) {
            const parent = this.packages.get(parentQualifiedName);
            if (parent && !parent.children.includes(qualifiedName)) {
                parent.children.push(qualifiedName);
            }
        }
    }
}

/** Parse an import path into its components */
function parseImport(path: string): ImportEntry {
    const isWildcard = path.endsWith('::*');
    let packageName: string;
    let namedImport: string | undefined;

    if (isWildcard) {
        packageName = path.slice(0, -3); // Remove ::*
    } else if (path.includes('::')) {
        const parts = path.split('::');
        namedImport = parts.pop();
        packageName = parts.join('::');
    } else {
        packageName = path;
    }

    return { path, packageName, isWildcard, namedImport };
}
