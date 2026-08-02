package memo_examples_gpca_pump_methodology_gpca_scope {
    private import ScalarValues::*;

    private import memo_methodology_core::*;
    private import memo_core_methodology_scope::*;
    private import memo_core_enumerations::*;

    part gpcaCoverageScope : MethodologyScope {
        attribute :>> id = "SCOPE-GPCA-001";
        attribute :>> name = "GPCACoverageScope";
        attribute :>> scopeName = "coverage";

        attribute :>> includedArchLayer = "context; requirements; functions; logical_structure; interfaces; software_structure; hardware_structure; behavior; risk; assurance; constraints";

        attribute :>> includedStandard = "ISO 14971; IEC 62304; 21 CFR 820; ISO 13485; ISO 14155; IEC 62366; IEC 60601-1";

        attribute :>> includedArtifactKind = "RiskManagementPlan";

        attribute :>> includedViewpointType = "VP-CTX; VP-LOG; VP-RISK";

        attribute :>> excludedKind = "CybersecurityAsset; AttackSurface; Threat; Vulnerability; ThreatScenario; CyberHazard; CyberRisk; CyberMitigation; SecurityRequirement; TrustBoundary; SecurityClaim; SoftwareModule[moduleKind=soup]";

        attribute :>> description = "GPCA prototype methodology — subtracts cybersecurity layer (non-networked device) and SOUP modules (no SOUP in prototype). Derived from default methodology by exclusion.";
    }
}
