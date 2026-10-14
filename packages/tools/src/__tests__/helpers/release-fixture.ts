// ─── E0 with release records at three levels ─────────────────────────────────
//
// Seeded beside E0's files (nothing of E0's replaced), on top of the variability fixture, whose
// two generator releases now say what they are releases of. The shape is the one a family writes:
//
//   component   EnergyControllerFirmware (software, realizes the ablation energy controller)
//                 two records of the one definition, with different part numbers and versions
//   system      the three constituent systems, one record each; ablation contains its firmware
//                 record and implements its interface record
//   SoS         ElectrophysiologyLab: one record that contains the three system records and is
//                 verified by a system test
//
// Every record is in `sos/`, never in a system's folder: a record cannot hold the hash of the
// commit that adds it, so it is always written after the commit it pins, and a folder that is
// checked out at a pinned commit would not hold it (plan section 9, decision 1).
// ─────────────────────────────────────────────────────────────────────────────

import { variabilityFiles } from './variability-fixture.js';

export const FIRMWARE = `package ep_lab_family_ablation_firmware {
    private import memo_core_common::*;
    private import memo_architecture_implementation_software_structure::*;
    private import memo_architecture_realization_deployment::*;
    private import ep_lab_family_ablation::*;

    part def EnergyControllerFirmware specializes SoftwareSystem {
        @MemoIdentity { :>> providedId = "EPF-ABL-SW-001"; :>> label = "Energy Controller Firmware"; }
    }
    part ablationFirmware : EnergyControllerFirmware;
    part ablationSystem : AblationGeneratorSystem;
    allocation firmwareRealizesController : RealizedBy allocate ablationSystem.energyController to ablationFirmware;
}
`;

export const SYSTEM_TEST = `package ep_lab_family_lab_tests {
    private import memo_core_common::*;
    private import memo_assurance_verification_validation::*;

    verification vcLabIntegration : VerificationCase {
        @MemoIdentity { :>> providedId = "EPF-SOS-VC-001"; :>> label = "Lab Integration Test"; }
    }
}
`;

export const RELEASE_RECORDS = `package ep_lab_family_release_records {
    private import memo_core_common::*;
    private import memo_core_dimensions::*;
    private import memo_artifacts_configuration_management::*;
    private import ep_lab_family_sos::*;
    private import ep_lab_family_icds::*;
    private import ep_lab_family_mapping::*;
    private import ep_lab_family_ablation::*;
    private import ep_lab_family_recording::*;
    private import ep_lab_family_ablation_firmware::*;
    private import ep_lab_family_lab_tests::*;

    // Component level: two releases of one software definition.
    part relFirmwareA : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-101"; :>> label = "Firmware 1.0"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-5001";
        attribute :>> revision = "A";
        attribute :>> softwareVersion = "1.0.0";
        attribute :>> codeTag = "fw-1.0.0";
        attribute :>> modelCommit = "1111111111111111111111111111111111111111";
    }
    part relFirmwareB : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-102"; :>> label = "Firmware 1.1"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-5002";
        attribute :>> revision = "B";
        attribute :>> softwareVersion = "1.1.0";
        attribute :>> codeTag = "fw-1.1.0";
        attribute :>> modelCommit = "2222222222222222222222222222222222222222";
    }
    #ReleaseOf dependency from relFirmwareA to EnergyControllerFirmware;
    #ReleaseOf dependency from relFirmwareB to EnergyControllerFirmware;

    // Interface level: the revision of the ICD the ablation system implements.
    part relAblationIcd : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-201"; :>> label = "Ablation to Mapping ICD rev A"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "ICD-0002";
        attribute :>> revision = "A";
        attribute :>> modelCommit = "3333333333333333333333333333333333333333";
    }
    #ReleaseOf dependency from relAblationIcd to AblationToMappingIcd;

    // System level: one release of each constituent system.
    part relMapping : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-301"; :>> label = "Mapping rev B"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-1000";
        attribute :>> revision = "B";
        attribute :>> modelCommit = "4444444444444444444444444444444444444444";
    }
    part relAblation : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-302"; :>> label = "Ablation rev B"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-2000";
        attribute :>> revision = "B";
        attribute :>> modelCommit = "5555555555555555555555555555555555555555";
    }
    part relRecording : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-303"; :>> label = "Recording rev A"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-4000";
        attribute :>> revision = "A";
        attribute :>> modelCommit = "6666666666666666666666666666666666666666";
    }
    #ReleaseOf dependency from relMapping to CardiacMappingSystem;
    #ReleaseOf dependency from relAblation to AblationGeneratorSystem;
    #ReleaseOf dependency from relRecording to SignalRecordingSystem;
    #Contains dependency from relAblation to relFirmwareB;
    #Implements dependency from relAblation to relAblationIcd;

    // System of systems level: the validated configuration.
    part relLabV1 : ReleaseRecord {
        @MemoIdentity { :>> providedId = "EPF-REL-401"; :>> label = "Lab v1"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "LAB-0001";
        attribute :>> revision = "1";
        attribute :>> modelCommit = "7777777777777777777777777777777777777777";
    }
    #ReleaseOf dependency from relLabV1 to ElectrophysiologyLab;
    #Contains dependency from relLabV1 to relMapping, relAblation, relRecording;
    #VerifiedByCase dependency from relLabV1 to vcLabIntegration;
}
`;

/** The files a test passes to `withExample(…, 'ep-lab-family')`: the variability fixture plus the release records. */
export const releaseFiles = (): Record<string, string> => ({
    ...variabilityFiles(),
    'model/systems/ablation/firmware.sysml': FIRMWARE,
    'model/sos/lab_tests.sysml': SYSTEM_TEST,
    'model/sos/release_records.sysml': RELEASE_RECORDS,
});
