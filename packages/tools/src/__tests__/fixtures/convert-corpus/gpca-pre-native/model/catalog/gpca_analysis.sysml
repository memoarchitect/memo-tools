package memo_examples_gpca_pump_model_catalog_gpca_analysis {
    private import ScalarValues::*;

    private import memo_assurance_safety_risk_analysis::*;
    private import memo_core_enumerations::*;

    // ── FMEA (IEC 60812) ────────────────────────────────────────
    part fmeaDelivery : FMEAWorksheet {
        attribute :>> id = "FMEA-001";
        attribute :>> name = "DrugDeliveryFMEA";
        attribute :>> analysisScope = "Fluid path, pump mechanism, delivery sensors, and patient pendant";
        attribute :>> standardReference = "IEC 60812";
        attribute :>> analysisBasis = "UMN CriSys GPCA architecture v2.0";
        attribute :>> revisionDate = "2026-07-03";
        attribute :>> reviewer = "Safety review board";
    }
    part fmMotorRunaway : FailureMode {
        attribute :>> id = "FM-001";
        attribute :>> name = "PumpMotorRunaway";
        attribute :>> failureModeKind = FailureModeKind::unintendedFunction;
        attribute :>> severityRating = 10;
        attribute :>> occurrenceRating = 2;
        attribute :>> detectionRating = 3;
        attribute :>> rpn = 60;
        attribute :>> criticality = CriticalityKind::catastrophic;
        attribute :>> description = "Motor steps faster than commanded, delivering more drug than prescribed.";
    }
    part fmAirSensorSilent : FailureMode {
        attribute :>> id = "FM-002";
        attribute :>> name = "AirSensorFailsSilent";
        attribute :>> failureModeKind = FailureModeKind::lossOfFunction;
        attribute :>> severityRating = 10;
        attribute :>> occurrenceRating = 3;
        attribute :>> detectionRating = 4;
        attribute :>> rpn = 120;
        attribute :>> criticality = CriticalityKind::catastrophic;
        attribute :>> description = "Air-in-line sensor reports 'no air' regardless of actual line state.";
    }
    part fmOcclusionDrift : FailureMode {
        attribute :>> id = "FM-003";
        attribute :>> name = "OcclusionSensorDrift";
        attribute :>> failureModeKind = FailureModeKind::degradedFunction;
        attribute :>> severityRating = 7;
        attribute :>> occurrenceRating = 4;
        attribute :>> detectionRating = 4;
        attribute :>> rpn = 112;
        attribute :>> criticality = CriticalityKind::high;
        attribute :>> description = "Pressure sensor drifts so occlusions are detected late or not at all.";
    }
    part fmStuckBolusButton : FailureMode {
        attribute :>> id = "FM-004";
        attribute :>> name = "BolusButtonStuckClosed";
        attribute :>> failureModeKind = FailureModeKind::unintendedFunction;
        attribute :>> severityRating = 9;
        attribute :>> occurrenceRating = 3;
        attribute :>> detectionRating = 2;
        attribute :>> rpn = 54;
        attribute :>> criticality = CriticalityKind::high;
        attribute :>> description = "Pendant switch shorted, continuously asserting bolus requests.";
    }
    part fmBatteryEarlyDepletion : FailureMode {
        attribute :>> id = "FM-005";
        attribute :>> name = "BatteryDepletesEarly";
        attribute :>> failureModeKind = FailureModeKind::prematureFunction;
        attribute :>> severityRating = 6;
        attribute :>> occurrenceRating = 4;
        attribute :>> detectionRating = 3;
        attribute :>> rpn = 72;
        attribute :>> criticality = CriticalityKind::medium;
        attribute :>> description = "Aged battery sustains less than the specified backup duration during transport.";
    }
    part feOverdose : FailureEffect {
        attribute :>> id = "FE-001";
        attribute :>> name = "ExcessDrugDelivered";
        attribute :>> effectLevel = FailureEffectLevelKind::endEffect;
        attribute :>> effectOnPatient = "opioid overdose, respiratory depression";
        attribute :>> effectOnOperator = "emergency intervention required";
        attribute :>> effectOnSystem = "therapy stopped by cross-check or clinician";
        attribute :>> severity = SeverityKind::catastrophic;
    }
    part feAirDelivered : FailureEffect {
        attribute :>> id = "FE-002";
        attribute :>> name = "AirReachesPatientLine";
        attribute :>> effectLevel = FailureEffectLevelKind::endEffect;
        attribute :>> effectOnPatient = "risk of vascular air embolism";
        attribute :>> effectOnOperator = "line re-prime and incident report";
        attribute :>> effectOnSystem = "undetected hazardous state";
        attribute :>> severity = SeverityKind::catastrophic;
    }
    part feTherapyInterrupted : FailureEffect {
        attribute :>> id = "FE-003";
        attribute :>> name = "TherapyInterruptedUnnoticed";
        attribute :>> effectLevel = FailureEffectLevelKind::endEffect;
        attribute :>> effectOnPatient = "untreated pain; possible post-occlusion bolus";
        attribute :>> effectOnOperator = "delayed response";
        attribute :>> effectOnSystem = "under-delivery until detected";
        attribute :>> severity = SeverityKind::serious;
    }
    part fcMotorDriverFault : FailureCause {
        attribute :>> id = "FCA-001";
        attribute :>> name = "MotorDriverElectronicsFault";
        attribute :>> causeCategory = FailureCauseCategoryKind::design;
        attribute :>> causeDescription = "Driver stage latch-up or firmware step-rate computation fault";
        attribute :>> occurrenceRating = ProbabilityKind::remote;
        attribute :>> preventionMethod = "independent flow cross-check; watchdog";
    }
    part fcTransducerAging : FailureCause {
        attribute :>> id = "FCA-002";
        attribute :>> name = "UltrasonicTransducerAging";
        attribute :>> causeCategory = FailureCauseCategoryKind::wear;
        attribute :>> causeDescription = "Air sensor transducer sensitivity degrades with age";
        attribute :>> occurrenceRating = ProbabilityKind::occasional;
        attribute :>> preventionMethod = "POST sensor plausibility check; periodic maintenance";
    }
    part fcPendantAbuse : FailureCause {
        attribute :>> id = "FCA-003";
        attribute :>> name = "PendantCableAbuse";
        attribute :>> causeCategory = FailureCauseCategoryKind::misuse;
        attribute :>> causeDescription = "Cable crushed in bed rail shorts the switch line";
        attribute :>> occurrenceRating = ProbabilityKind::occasional;
        attribute :>> preventionMethod = "stuck-input detection (REQ-X-09); strain-relieved cable";
    }
    part dmFlowCrossCheck : DetectionMethod {
        attribute :>> id = "DM-001";
        attribute :>> name = "CommandedVsMeasuredFlowComparison";
        attribute :>> methodKind = DetectionMethodKind::monitoring;
        attribute :>> detectionPoint = "every execution step during ACTIVE therapy";
        attribute :>> confidence = DetectionKind::high;
    }
    part dmPostSensorCheck : DetectionMethod {
        attribute :>> id = "DM-002";
        attribute :>> name = "POSTSensorPlausibilityCheck";
        attribute :>> methodKind = DetectionMethodKind::selfDiagnostic;
        attribute :>> detectionPoint = "power-on and periodic in-service test";
        attribute :>> confidence = DetectionKind::moderate;
    }
    part dmStuckInputMonitor : DetectionMethod {
        attribute :>> id = "DM-003";
        attribute :>> name = "StuckInputMonitor";
        attribute :>> methodKind = DetectionMethodKind::monitoring;
        attribute :>> detectionPoint = "bolus input asserted beyond 60 s";
        attribute :>> confidence = DetectionKind::high;
    }
    part fmeaActionAirSensor : FMEAAction {
        attribute :>> id = "FMA-001";
        attribute :>> name = "AddRedundantAirDetectionWindow";
        attribute :>> actionKind = FMEAActionKind::designChange;
        attribute :>> responsible = "hardware lead";
        attribute :>> targetCompletionDate = "2026-09-30";
        attribute :>> revisedRpn = 40;
        attribute :>> description = "Add second sensing window downstream so a single silent transducer cannot mask air.";
    }

    // ── Fault tree (overdose top event) ─────────────────────────
    part ftaOverdose : FaultTree {
        attribute :>> id = "FTA-001";
        attribute :>> name = "OverdoseFaultTree";
        attribute :>> standardReference = "IEC 61025";
        attribute :>> analysisScope = "Drug over-delivery during ACTIVE therapy";
        attribute :>> topEventDescription = "Drug delivered in excess of prescription limits";
        attribute :>> cutSetSummary = "All minimal cut sets are order 2 or higher after mitigation";
        attribute :>> revisionDate = "2026-07-03";
    }
    part fteOverdoseTop : FaultTreeEvent {
        attribute :>> id = "FTE-001";
        attribute :>> name = "ExcessDrugDeliveredTopEvent";
        attribute :>> eventKind = FaultTreeEventKind::topEvent;
        attribute :>> description = "Delivered volume exceeds prescribed limits";
    }
    part fteMotorRunaway : FaultTreeEvent {
        attribute :>> id = "FTE-002";
        attribute :>> name = "MotorRunawayBasicEvent";
        attribute :>> eventKind = FaultTreeEventKind::basicEvent;
        attribute :>> failureRate = 0.000001;
        attribute :>> exposureTime = 100.0;
        attribute :>> description = "Pump motor delivers faster than commanded (FM-001)";
    }
    part fteCrossCheckFails : FaultTreeEvent {
        attribute :>> id = "FTE-003";
        attribute :>> name = "FlowCrossCheckUnavailable";
        attribute :>> eventKind = FaultTreeEventKind::basicEvent;
        attribute :>> failureRate = 0.00001;
        attribute :>> exposureTime = 100.0;
        attribute :>> description = "Independent flow sensor or comparison logic fails (FM-003 family)";
    }
    part fteLockoutFault : FaultTreeEvent {
        attribute :>> id = "FTE-004";
        attribute :>> name = "LockoutEnforcementFault";
        attribute :>> eventKind = FaultTreeEventKind::basicEvent;
        attribute :>> failureRate = 0.0000001;
        attribute :>> exposureTime = 100.0;
        attribute :>> description = "Infusion manager authorizes bolus despite active lockout";
    }
    part fteStuckButtonUndetected : FaultTreeEvent {
        attribute :>> id = "FTE-005";
        attribute :>> name = "StuckBolusButtonUndetected";
        attribute :>> eventKind = FaultTreeEventKind::basicEvent;
        attribute :>> failureRate = 0.000001;
        attribute :>> exposureTime = 100.0;
        attribute :>> description = "Pendant stuck closed and stuck-input monitor fails (FM-004)";
    }
    part ftgOverdoseOr : FaultTreeGate {
        attribute :>> id = "FTG-001";
        attribute :>> name = "OverdelivryPathOrGate";
        attribute :>> gateKind = FaultTreeGateKind::orGate;
    }
    part ftgMotorAnd : FaultTreeGate {
        attribute :>> id = "FTG-002";
        attribute :>> name = "MotorRunawayAndCrossCheckGate";
        attribute :>> gateKind = FaultTreeGateKind::andGate;
    }
    part ftgBolusAnd : FaultTreeGate {
        attribute :>> id = "FTG-003";
        attribute :>> name = "UnauthorizedBolusAndGate";
        attribute :>> gateKind = FaultTreeGateKind::andGate;
    }
    part mcsMotorPath : MinimalCutSet {
        attribute :>> id = "MCS-001";
        attribute :>> name = "MotorRunawayWithLostCrossCheck";
        attribute :>> cutSetOrder = 2;
        attribute :>> involvedEvents = "FTE-002, FTE-003";
        attribute :>> significance = "dominant contributor; controlled by RC-008 independence";
    }
    part mcsBolusPath : MinimalCutSet {
        attribute :>> id = "MCS-002";
        attribute :>> name = "StuckButtonWithLockoutFault";
        attribute :>> cutSetOrder = 2;
        attribute :>> involvedEvents = "FTE-004, FTE-005";
        attribute :>> significance = "requires simultaneous software and detection failure; controlled by RC-001 and REQ-X-09";
    }
}
