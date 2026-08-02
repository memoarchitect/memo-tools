package memo_examples_gpca_pump_methodology_gpca_profiles {
    private import ScalarValues::*;

    private import memo_methodology_core::*;
    private import memo_methodology_profiles::*;
    private import memo_core_enumerations::*;

    part gpcaMethodDefinition : MethodologyDefinition {
        attribute :>> id = "METH-GPCA-001";
        attribute :>> name = "GPCAPrototypeMethodology";
        attribute :>> version = "1.0";
        attribute :>> domain = "medical device modeling";
        attribute :>> description = "GPCA infusion pump methodology — subtraction-based tailoring for non-networked prototype. Excludes cybersecurity layer and SOUP modules.";
        attribute :>> baseMethodName = "MedicalDeviceLightDefault";
    }

    part gpcaMethodResolved : ResolvedMethodology {
        attribute :>> id = "RMETH-GPCA-001";
        attribute :>> name = "GPCAPrototypeResolved";
        attribute :>> version = "1.0";
        attribute :>> safetyClassification = SafetyClassKind::C;
        attribute :>> lifecycleStage = LifecycleStateKind::development;
        attribute :>> resolutionSummary = "GPCA infusion pump — IEC 62304 Class C at development stage. Default scope minus cybersecurity and SOUP, as the prototype is non-networked.";
    }
}
