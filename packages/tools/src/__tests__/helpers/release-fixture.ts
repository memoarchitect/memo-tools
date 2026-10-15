// ─── E0 with release records at three levels ─────────────────────────────────
//
// Seeded beside E0's files (nothing of E0's replaced), on top of the variability fixture, whose
// two manipulator releases now say what they are releases of. The shape is the one a family writes:
//
//   component   MotionControllerFirmware (software, realizes the manipulation energy controller)
//                 two records of the one definition, with different part numbers and versions
//   system      the three constituent systems, one record each; manipulation contains its firmware
//                 record and implements its interface record
//   SoS         RoboticCell: one record that contains the three system records and is
//                 verified by a system test
//
// Every record is in `sos/`, never in a system's folder: a record cannot hold the hash of the
// commit that adds it, so it is always written after the commit it pins, and a folder that is
// checked out at a pinned commit would not hold it (plan section 9, decision 1).
// ─────────────────────────────────────────────────────────────────────────────

import { variabilityFiles } from './variability-fixture.js';

export const FIRMWARE = `package robot_cell_family_manipulation_firmware {
    private import memo_core_common::*;
    private import memo_architecture_implementation_software_structure::*;
    private import memo_architecture_realization_deployment::*;
    private import robot_cell_family_manipulation::*;

    part def MotionControllerFirmware specializes SoftwareSystem {
        @MemoIdentity { :>> providedId = "RCF-MAN-SW-001"; :>> label = "Motion Controller Firmware"; }
    }
    part manipulationFirmware : MotionControllerFirmware;
    part manipulationSystem : ManipulatorSystem;
    allocation firmwareRealizesController : RealizedBy allocate manipulationSystem.motionController to manipulationFirmware;
}
`;

export const SYSTEM_TEST = `package robot_cell_family_lab_tests {
    private import memo_core_common::*;
    private import memo_assurance_verification_validation::*;
    private import memo_core_enumerations::*;
    private import robot_cell_family_sos::*;

    verification vcLabIntegration : VerificationCase {
        @MemoIdentity { :>> providedId = "RCF-SOS-VC-001"; :>> label = "Lab Integration Test"; }
        attribute :>> methodKind = MemoVerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "The three systems run one procedure end to end.";
        subject verified : Base::Anything[*] = (robotCell);
    }
}
`;

export const RELEASE_RECORDS = `package robot_cell_family_release_records {
    private import memo_core_common::*;
    private import memo_core_dimensions::*;
    private import memo_artifacts_configuration_management::*;
    private import robot_cell_family_sos::*;
    private import robot_cell_family_icds::*;
    private import robot_cell_family_navigation::*;
    private import robot_cell_family_manipulation::*;
    private import robot_cell_family_perception::*;
    private import robot_cell_family_manipulation_firmware::*;
    private import robot_cell_family_lab_tests::*;

    // Component level: two releases of one software definition.
    part relFirmwareA : ReleaseRecord {
        @MemoIdentity { :>> providedId = "RCF-REL-101"; :>> label = "Firmware 1.0"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-5001";
        attribute :>> revision = "A";
        attribute :>> softwareVersion = "1.0.0";
        attribute :>> codeTag = "fw-1.0.0";
        attribute :>> modelCommit = "1111111111111111111111111111111111111111";
    }
    part relFirmwareB : ReleaseRecord {
        @MemoIdentity { :>> providedId = "RCF-REL-102"; :>> label = "Firmware 1.1"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-5002";
        attribute :>> revision = "B";
        attribute :>> softwareVersion = "1.1.0";
        attribute :>> codeTag = "fw-1.1.0";
        attribute :>> modelCommit = "2222222222222222222222222222222222222222";
    }
    #ReleaseOf dependency from relFirmwareA to MotionControllerFirmware;
    #ReleaseOf dependency from relFirmwareB to MotionControllerFirmware;

    // Interface level: the revision of the ICD the manipulation system implements.
    part relManipulationIcd : ReleaseRecord {
        @MemoIdentity { :>> providedId = "RCF-REL-201"; :>> label = "Manipulation to Navigation ICD rev A"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "ICD-0002";
        attribute :>> revision = "A";
        attribute :>> modelCommit = "3333333333333333333333333333333333333333";
    }
    #ReleaseOf dependency from relManipulationIcd to ManipulationToNavigationIcd;

    // System level: one release of each constituent system.
    part relNavigation : ReleaseRecord {
        @MemoIdentity { :>> providedId = "RCF-REL-301"; :>> label = "Navigation rev B"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-1000";
        attribute :>> revision = "B";
        attribute :>> modelCommit = "4444444444444444444444444444444444444444";
    }
    part relManipulation : ReleaseRecord {
        @MemoIdentity { :>> providedId = "RCF-REL-302"; :>> label = "Manipulation rev B"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-2000";
        attribute :>> revision = "B";
        attribute :>> modelCommit = "5555555555555555555555555555555555555555";
    }
    part relPerception : ReleaseRecord {
        @MemoIdentity { :>> providedId = "RCF-REL-303"; :>> label = "Perception rev A"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "PN-4000";
        attribute :>> revision = "A";
        attribute :>> modelCommit = "6666666666666666666666666666666666666666";
    }
    #ReleaseOf dependency from relNavigation to NavigationSystem;
    #ReleaseOf dependency from relManipulation to ManipulatorSystem;
    #ReleaseOf dependency from relPerception to PerceptionSystem;
    #Contains dependency from relManipulation to relFirmwareB;
    #Implements dependency from relManipulation to relManipulationIcd;

    // System of systems level: the validated configuration.
    part relLabV1 : ReleaseRecord {
        @MemoIdentity { :>> providedId = "RCF-REL-401"; :>> label = "Lab v1"; }
        attribute :>> status = ElementStatusKind::released;
        attribute :>> partNumber = "LAB-0001";
        attribute :>> revision = "1";
        attribute :>> modelCommit = "7777777777777777777777777777777777777777";
    }
    #ReleaseOf dependency from relLabV1 to RoboticCell;
    #Contains dependency from relLabV1 to relNavigation, relManipulation, relPerception;
    #VerifiedByCase dependency from relLabV1 to vcLabIntegration;
}
`;

/** A project that feeds the two manipulator releases and introduced the US output stage (plan O7). */
export const PROJECTS = `package robot_cell_family_projects {
    private import memo_core_common::*;
    private import memo_artifacts_configuration_management::*;
    private import robot_cell_family_releases::*;
    private import robot_cell_family_manipulation_options::*;

    part prjOutputStages : Project {
        @MemoIdentity { :>> providedId = "RCF-PRJ-001"; :>> label = "Output Stages"; }
        attribute :>> trackerLink = "https://tracker.example/PRJ-12";
    }
    part prjNothing : Project {
        @MemoIdentity { :>> providedId = "RCF-PRJ-002"; :>> label = "Not Yet Released"; }
    }
    #Feeds dependency from prjOutputStages to relEu, relUs;
    #IntroducedBy dependency from OutputStageSystem::outputStage::usOutput to prjOutputStages;
}
`;

/** The files a test passes to `withExample(…, 'robot-cell-family')`: the variability fixture plus the release records. */
export const releaseFiles = (): Record<string, string> => ({
    ...variabilityFiles(),
    'model/systems/manipulation/firmware.sysml': FIRMWARE,
    'model/sos/lab_tests.sysml': SYSTEM_TEST,
    'model/sos/release_records.sysml': RELEASE_RECORDS,
    'model/sos/projects.sysml': PROJECTS,
});
