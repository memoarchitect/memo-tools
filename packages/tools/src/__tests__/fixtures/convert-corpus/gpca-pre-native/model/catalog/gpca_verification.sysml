package memo_examples_gpca_pump_model_catalog_gpca_verification {
    private import ScalarValues::*;

    private import memo_assurance_verification_validation::*;
    private import memo_core_enumerations::*;

    // ── Verification cases ──────────────────────────────────────
    verification vcModeRange : VerificationCase {
        attribute :>> id = "VER-001";
        attribute :>> name = "VerifyModeRange";
        attribute :>> methodKind = VerificationMethodKind::formalProof;
        attribute :>> acceptanceCriteria = "Current_System_mode only takes valid exclusive values";
        attribute :>> status = "planned";
    }
    verification vcLockout : VerificationCase {
        attribute :>> id = "VER-002";
        attribute :>> name = "VerifyBolusLockout";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "No patient bolus initiated when lockout or max bolus constraints active";
        attribute :>> status = "planned";
    }
    verification vcSameStepAlarm : VerificationCase {
        attribute :>> id = "VER-003";
        attribute :>> name = "VerifySameStepAlarmStop";
        attribute :>> methodKind = VerificationMethodKind::modelChecking;
        attribute :>> acceptanceCriteria = "Alarm output affects infusion in same execution step";
        attribute :>> status = "planned";
    }
    verification vcTemporalModeSafety : VerificationCase {
        attribute :>> id = "VER-004";
        attribute :>> name = "VerifyTemporalModeSafety";
        attribute :>> methodKind = VerificationMethodKind::modelChecking;
        attribute :>> acceptanceCriteria = "No invalid transitions and pause on critical alarms";
        attribute :>> status = "planned";
    }
    verification vcAirInLine : VerificationCase {
        attribute :>> id = "VER-005";
        attribute :>> name = "VerifyAirInLineStop";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Injected air above threshold pauses infusion and annunciates per the REQ 59 High-priority actions (REQ-CS-21)";
        attribute :>> status = "planned";
    }
    verification vcOcclusion : VerificationCase {
        attribute :>> id = "VER-006";
        attribute :>> name = "VerifyOcclusionDetection";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Clamped line above pressure threshold pauses infusion and annunciates (REQ-X-04)";
        attribute :>> status = "planned";
    }
    verification vcEmptyReservoir : VerificationCase {
        attribute :>> id = "VER-007";
        attribute :>> name = "VerifyEmptyReservoirStop";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Reservoir-empty assertion transitions to PAUSED (KVO flow) and annunciates per the REQ 59 High-priority actions (REQ-CS-23)";
        attribute :>> status = "planned";
    }
    verification vcPost : VerificationCase {
        attribute :>> id = "VER-008";
        attribute :>> name = "VerifyPowerOnSelfTest";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Each injected POST fault (CPU, RAM, ROM, watchdog, sensors) blocks therapy and alarms (REQ-X-02)";
        attribute :>> status = "planned";
    }
    verification vcPowerLoss : VerificationCase {
        attribute :>> id = "VER-009";
        attribute :>> name = "VerifyPowerLossRetentionAndResume";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Prescription and log intact after power cycle; therapy resumes only after confirmation (REQ-X-03)";
        attribute :>> status = "planned";
    }
    verification vcWatchdog : VerificationCase {
        attribute :>> id = "VER-010";
        attribute :>> name = "VerifyWatchdogSafeState";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Induced CPU hang forces zero flow and continuous alarm within 60 ms (REQ-X-08, TC-003)";
        attribute :>> status = "planned";
    }
    verification vcHourlyMax : VerificationCase {
        attribute :>> id = "VER-011";
        attribute :>> name = "VerifyHourlyDoseCeiling";
        attribute :>> methodKind = VerificationMethodKind::simulation;
        attribute :>> acceptanceCriteria = "Randomized bolus/basal schedules never exceed hourly maximum in sliding window (REQ-X-06)";
        attribute :>> status = "planned";
    }
    verification vcPumpAccuracy : VerificationCase {
        attribute :>> id = "VER-012";
        attribute :>> name = "VerifyDeliveryAccuracy";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Gravimetric bench measurement within ±5% (Tolerance_Min_const) across rate range (REQ-X-11)";
        attribute :>> status = "planned";
    }
    verification vcAlarmLoudness : VerificationCase {
        attribute :>> id = "VER-013";
        attribute :>> name = "VerifyAlarmSoundPressure";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Each priority tone meets Audio_level_const, 50 db for 2 s per I 8 (REQ-X-12)";
        attribute :>> status = "planned";
    }
    verification vcFreeFlow : VerificationCase {
        attribute :>> id = "VER-014";
        attribute :>> name = "VerifyAntiFreeFlowValve";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "No gravity flow with set disengaged under worst-case head height (REQ-X-14)";
        attribute :>> status = "planned";
    }
    verification vcStuckButton : VerificationCase {
        attribute :>> id = "VER-015";
        attribute :>> name = "VerifyStuckButtonDetection";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Shorted pendant input yields no bolus and Medium-priority notification after 60 s (REQ-X-09)";
        attribute :>> status = "planned";
    }
    verification vcFlowCrossCheck : VerificationCase {
        attribute :>> id = "VER-016";
        attribute :>> name = "VerifyFlowCrossCheck";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Injected deviation beyond Tolerance_Min_const sustained past Max_Duration_OverInfusion_const pauses therapy and annunciates (REQ-X-10)";
        attribute :>> status = "planned";
    }

    verification vcDrugLibrary : VerificationCase {
        attribute :>> id = "VER-017";
        attribute :>> name = "VerifyDrugLibraryEnforcement";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Hard-limit entries rejected, soft-limit entries require confirmation, both logged (REQ-X-01)";
        attribute :>> status = "planned";
    }
    verification vcPrescriptionConfirm : VerificationCase {
        attribute :>> id = "VER-018";
        attribute :>> name = "VerifyPrescriptionConfirmation";
        attribute :>> methodKind = VerificationMethodKind::demonstration;
        attribute :>> acceptanceCriteria = "Therapy cannot start without distinct confirmation; displayed values equal stored values (REQ-CS-09)";
        attribute :>> status = "planned";
    }
    verification vcEventLog : VerificationCase {
        attribute :>> id = "VER-019";
        attribute :>> name = "VerifyEventLogIntegrity";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Operational/error log entries per REQ-CS-78..81; tampering detectable (REQ-X-07)";
        attribute :>> status = "planned";
    }
    verification vcReverseDeliveryPause : VerificationCase {
        attribute :>> id = "VER-020";
        attribute :>> name = "VerifyReverseDeliveryPause";
        attribute :>> methodKind = VerificationMethodKind::modelChecking;
        attribute :>> acceptanceCriteria = "Continuous or cumulative reverse delivery beyond the REQ-CS-22 duration limits transitions to PAUSED and raises the Reverse Delivery notification (NOTIF-04)";
        attribute :>> status = "planned";
    }
    verification vcAntiRefluxMechanism : VerificationCase {
        attribute :>> id = "VER-021";
        attribute :>> name = "VerifyContinuousReverseDeliveryPrevention";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "During normal use and single fault condition, continuous reverse delivery is not possible (IEC 601-2-24 basis per GPCA safety requirements)";
        attribute :>> status = "planned";
    }
    verification vcVtbiCeiling : VerificationCase {
        attribute :>> id = "VER-022";
        attribute :>> name = "VerifyVtbiCeilingPause";
        attribute :>> methodKind = VerificationMethodKind::modelChecking;
        attribute :>> acceptanceCriteria = "Actual volume infused above the drug-database maximum VTBI transitions to PAUSED with flow at most KVO (REQ-CS-20, AGREE GP-008) and raises NOTIF-06";
        attribute :>> status = "planned";
    }
    verification vcInfusionComplete : VerificationCase {
        attribute :>> id = "VER-023";
        attribute :>> name = "VerifyInfusionCompleteStop";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Reaching prescribed total duration or maximum VTBI transitions ACTIVE to IDLE with Infusion Complete actions (REQ-CS-28)";
        attribute :>> status = "planned";
    }
    verification vcDoorInterlock : VerificationCase {
        attribute :>> id = "VER-024";
        attribute :>> name = "VerifyDoorOpenDeliveryInhibit";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Door open during THERAPY limits flow to at most KVO and raises a notification (AGREE GP-011; REQ-X-05)";
        attribute :>> status = "planned";
    }

    // ── Validation cases (design validation / IEC 62366) ────────
    verification valSimulatedWard : ValidationCase {
        attribute :>> id = "VAL-001";
        attribute :>> name = "SimulatedWardTherapyValidation";
        attribute :>> validationMethod = ValidationMethodKind::simulatedUse;
        attribute :>> userParticipation = "nurses and physicians on a simulated ward";
        attribute :>> acceptanceCriteria = "Complete therapy scenarios OS-001..OS-006 executed without unresolved use difficulty";
        attribute :>> clinicalContext = "post-operative PCA therapy in acute care";
    }
    verification valSummativeUsability : ValidationCase {
        attribute :>> id = "VAL-002";
        attribute :>> name = "SummativeUsabilityTest";
        attribute :>> validationMethod = ValidationMethodKind::summativeUsabilityTest;
        attribute :>> userParticipation = "15 representative clinical users per user group";
        attribute :>> acceptanceCriteria = "No critical use errors (UE-001..UE-004) observed on safety-related tasks; residual difficulty acceptable per IEC 62366-1";
        attribute :>> clinicalContext = "prescription programming, reservoir change, alarm response";
    }

    // ── Test artifacts and evidence ─────────────────────────────
    part testReportLockout : TestArtifact {
        attribute :>> id = "TEST-001";
        attribute :>> name = "BolusLockoutTestReport";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> artifactKind = ArtifactKind::testReport;
        attribute :>> resultSummary = "planned";
    }
    part testProtocolSafetySuite : TestArtifact {
        attribute :>> id = "TEST-002";
        attribute :>> name = "SafetyAlarmTestProtocol";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> artifactKind = ArtifactKind::testProtocol;
        attribute :>> resultSummary = "covers VER-005..VER-010, VER-015, VER-016, VER-020, VER-022..VER-024";
    }
    part evidenceLockout : Evidence {
        attribute :>> id = "EVD-001";
        attribute :>> name = "BolusLockoutEvidence";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> evidenceType = "verification evidence";
        attribute :>> integrityStatus = "draft";
    }
    part evidenceModeRange : Evidence {
        attribute :>> id = "EVD-002";
        attribute :>> name = "ModeRangeEvidence";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> evidenceType = "formal proof evidence";
        attribute :>> integrityStatus = "draft";
    }
    part evidenceSameStepAlarm : Evidence {
        attribute :>> id = "EVD-003";
        attribute :>> name = "SameStepAlarmEvidence";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> evidenceType = "model checking evidence";
        attribute :>> integrityStatus = "draft";
    }
    part evidenceTemporalModeSafety : Evidence {
        attribute :>> id = "EVD-004";
        attribute :>> name = "TemporalModeSafetyEvidence";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> evidenceType = "model checking evidence";
        attribute :>> integrityStatus = "draft";
    }
    part evidenceSafetyAlarmSuite : Evidence {
        attribute :>> id = "EVD-005";
        attribute :>> name = "SafetyAlarmSuiteEvidence";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> evidenceType = "bench test evidence for alarm-driven safe states";
        attribute :>> integrityStatus = "draft";
    }
    part evidenceUsability : Evidence {
        attribute :>> id = "EVD-006";
        attribute :>> name = "SummativeUsabilityEvidence";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> evidenceType = "summative usability report per IEC 62366-1";
        attribute :>> integrityStatus = "draft";
    }
    part evidenceHardwareBench : Evidence {
        attribute :>> id = "EVD-008";
        attribute :>> name = "HardwareBenchEvidence";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> evidenceType = "bench evidence for alarm loudness and anti-free-flow valve";
        attribute :>> integrityStatus = "draft";
    }
    part evidenceDoseProgramming : Evidence {
        attribute :>> id = "EVD-009";
        attribute :>> name = "DoseProgrammingEvidence";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> evidenceType = "test evidence for prescription limits, confirmation, dose ceiling, and event log";
        attribute :>> integrityStatus = "draft";
    }
    part evidenceDeliveryAccuracy : Evidence {
        attribute :>> id = "EVD-007";
        attribute :>> name = "DeliveryAccuracyEvidence";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> evidenceType = "gravimetric bench test evidence";
        attribute :>> integrityStatus = "draft";
    }
}
