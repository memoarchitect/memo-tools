import { describe, expect, it } from 'vitest';
import { appendToLastPackage, kindImportFor } from '../server/persistor.js';

// A created element is typed by its kind, so the file it lands in must see the kind. The writer imports it beside the
// usage unless the file already can.

const KIND = 'memo_architecture_implementation_hardware_common::PhysicalAssembly';

describe('importing a new element\'s kind', () => {
    it('imports the kind when the file neither imports its package nor uses it', () => {
        expect(kindImportFor('package p {\n    part a : Other;\n}\n', KIND)).toBe(`private import ${KIND};\n`);
    });

    it('imports nothing when the file imports the package, the kind itself, or already types a usage by it', () => {
        expect(kindImportFor('package p {\n    private import memo_architecture_implementation_hardware_common::*;\n}\n', KIND)).toBe('');
        expect(kindImportFor(`package p {\n    private import ${KIND};\n}\n`, KIND)).toBe('');
        expect(kindImportFor('package p {\n    part frame : PhysicalAssembly;\n}\n', KIND)).toBe('');
    });

    it('does not take a qualified use or a redefinition for a visible kind', () => {
        expect(kindImportFor('package p {\n    part frame : x::PhysicalAssembly;\n}\n', KIND)).toBe(`private import ${KIND};\n`);
        expect(kindImportFor('package p {\n    part :>> PhysicalAssembly;\n}\n', KIND)).toBe(`private import ${KIND};\n`);
    });

    it('imports nothing when the server named no definition', () => {
        expect(kindImportFor('package p {\n}\n', undefined)).toBe('');
        expect(kindImportFor('package p {\n}\n', 'PhysicalAssembly')).toBe('');
    });

    it('writes the import beside the usage, inside the package', () => {
        const usage = `${kindImportFor('package p {\n}\n', KIND)}part gripper : PhysicalAssembly;`;
        expect(appendToLastPackage('package p {\n}\n', usage)).toBe(`package p {\n    private import ${KIND};\n    part gripper : PhysicalAssembly;\n}\n`);
    });
});
