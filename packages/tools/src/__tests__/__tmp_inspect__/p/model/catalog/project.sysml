// Project identity and method binding — the project's native entrypoint.
//
// The imports below name the reusable packages this project resolves, and the
// binding names its methodology with a typed SysML reference. Nothing outside
// SysML selects model content: delete every YAML file beside this one and the
// model still means exactly what it means now.
package project_catalog {
    private import ScalarValues::*;

    private import memo_core_enumerations::*;
    private import memo_methodology_core::*;
    private import memo_methodology_profiles::*;

    private import project_architecture::*;
    private import project_assurance::*;
    private import project_artifacts::*;

    part projectMethodBinding : ProjectMethodBinding {
        attribute :>> id = "PMB-001";
        attribute :>> name = "pProjectMethodBinding";
        attribute :>> projectName = "p";
        ref :>> selectedMethodology = mdDefaultDefinition;
        // The project adds no modules of its own yet. Under `explicit` an
        // empty additive list means exactly that — no additions — rather than
        // being read as "everything".
        attribute :>> scopeMode = ScopeModeKind::explicit;
    }
}
