// ─── E0 with design options ──────────────────────────────────────────────────
//
// The reference example (`memo/examples/ep-lab-family`) has no variation yet, and the
// plan's E0 accept lists "features with EU/US markets". Until E0 is edited, a test
// seeds them here: new files laid beside E0's, nothing of E0's replaced, so its oracle
// and baselines stand. The shape is the one a family would write.
//
//   shared/features.sysml        three features, one requires and one excludes
//   ablation/output_options.sysml  a variation point in the ablation system with an EU and
//                                  a US variant, each realizing a market feature
//   sos/releases.sysml           an EU and a US release, each selecting features
//   sos/decisions.sysml          a design decision weighing the two variants
// ─────────────────────────────────────────────────────────────────────────────

export const FEATURES = `package ep_lab_family_features {
    private import memo_core_common::*;
    private import memo_architecture_variability::*;

    part featEuMarket : ProductFeature { @MemoIdentity { :>> providedId = "EPF-FT-001"; :>> label = "EU Market"; } }
    part featUsMarket : ProductFeature { @MemoIdentity { :>> providedId = "EPF-FT-002"; :>> label = "US Market"; } }
    part featIrrigatedTip : ProductFeature { @MemoIdentity { :>> providedId = "EPF-FT-003"; :>> label = "Irrigated Tip"; } }

    connection irrigatedTipNeedsUs : RequiresFeature connect dependentFeature ::> featIrrigatedTip to requiredFeature ::> featUsMarket;
    connection euExcludesUs : ExcludesFeature connect firstFeature ::> featEuMarket to secondFeature ::> featUsMarket;
}
`;

export const OUTPUT_OPTIONS = `package ep_lab_family_ablation_options {
    private import memo_core_common::*;
    private import memo_core_dimensions::*;
    private import memo_architecture_logical_structure::*;
    private import memo_architecture_variability::*;
    private import ep_lab_family_features::*;

    part def OutputStageSystem specializes System {
        variation part outputStage : LogicalComponent {
            @MemoIdentity { :>> providedId = "EPF-ABL-VP-001"; :>> label = "Output Stage"; }
            variant part euOutput : LogicalComponent {
                @MemoIdentity { :>> providedId = "EPF-ABL-LC-010"; :>> label = "EU Output Stage"; }
                attribute :>> status = ElementStatusKind::approved;
            }
            variant part usOutput : LogicalComponent {
                @MemoIdentity { :>> providedId = "EPF-ABL-LC-011"; :>> label = "US Output Stage"; }
                attribute :>> status = ElementStatusKind::proposed;
            }
        }
        #RealizesFeature dependency from outputStage::euOutput to featEuMarket;
        #RealizesFeature dependency from outputStage::usOutput to featUsMarket;
    }
}
`;

export const RELEASES = `package ep_lab_family_releases {
    private import memo_core_common::*;
    private import memo_core_dimensions::*;
    private import memo_artifacts_configuration_management::*;
    private import memo_architecture_variability::*;
    private import ep_lab_family_features::*;
    private import ep_lab_family_ablation_options::*;

    part relEu : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-001"; :>> label = "Generator EU"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-3001";
        attribute :>> revision = "A";
        attribute :>> modelCommit = "0000000000000000000000000000000000000001";
    }
    part relUs : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-002"; :>> label = "Generator US"; }
        attribute :>> status = ElementStatusKind::draft;
        attribute :>> partNumber = "PN-3002";
        attribute :>> revision = "A";
        attribute :>> modelCommit = "0000000000000000000000000000000000000002";
    }
    #ReleaseOf dependency from relEu to OutputStageSystem;
    #ReleaseOf dependency from relUs to OutputStageSystem;
    #SelectsFeature dependency from relEu to featEuMarket;
    #SelectsFeature dependency from relUs to featUsMarket, featIrrigatedTip;
}
`;

export const DECISIONS = `package ep_lab_family_decisions {
    private import memo_core_common::*;
    private import memo_architecture_decisions::*;
    private import ep_lab_family_ablation_options::*;

    part decOutputStage : DesignDecision {
        @MemoIdentity { :>> providedId = "EPF-DEC-001"; :>> label = "Output Stage Variants"; }
        #Alternative dependency from decOutputStage to OutputStageSystem::outputStage::euOutput, OutputStageSystem::outputStage::usOutput;
        #Selected dependency from decOutputStage to OutputStageSystem::outputStage::euOutput;
    }
}
`;

/** The files a test passes to `withExample(…, 'ep-lab-family')`. */
export const variabilityFiles = (): Record<string, string> => ({
    'model/shared/features.sysml': FEATURES,
    'model/systems/ablation/output_options.sysml': OUTPUT_OPTIONS,
    'model/sos/releases.sysml': RELEASES,
    'model/sos/decisions.sysml': DECISIONS,
});
