package memo_examples_gpca_pump_model_catalog_gpca_operational {
    private import ScalarValues::*;

    private import memo_architecture_operational_structure::*;
    private import memo_architecture_operational_activities::*;
    private import memo_architecture_operational_scenarios::*;
    private import memo_architecture_operational_use_cases::*;
    private import memo_architecture_operational_workflows::*;
    private import memo_core_enumerations::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_context::*;

    // ── Operational entities beyond the human actors ────────────
    part entityPharmacy : OperationalEntity {
        attribute :>> id = "OE-001";
        attribute :>> name = "HospitalPharmacy";
        attribute :>> entityKind = OperationalEntityKind::externalSystem;
        attribute :>> operationalDomain = "medication management";
        attribute :>> responsibility = "Prepares labeled drug reservoirs and maintains the hospital pharmacy database of drug safe values.";
    }
    part entityPowerInfrastructure : OperationalEntity {
        attribute :>> id = "OE-002";
        attribute :>> name = "WardPowerInfrastructure";
        attribute :>> entityKind = OperationalEntityKind::environmentalEntity;
        attribute :>> operationalDomain = "facility power";
        attribute :>> responsibility = "Provides mains power; outages are a foreseeable operational condition.";
    }
    part entityGpcaPump : OperationalEntity {
        attribute :>> id = "OE-003";
        attribute :>> name = "GPCA_Pump";
        attribute :>> entityKind = OperationalEntityKind::device;
        attribute :>> operationalDomain = "patient-controlled analgesia therapy";
        attribute :>> responsibility = "System of interest: delivers programmed basal and bolus analgesia subject to prescription limits.";
    }

    // ── External entities per CriSys Fig 2.1 ────────────────────
    part entityPharmacyDb : OperationalEntity {
        attribute :>> id = "OE-004";
        attribute :>> name = "HospitalPharmacyDatabase";
        attribute :>> entityKind = OperationalEntityKind::externalSystem;
        attribute :>> operationalDomain = "medication safety data";
        attribute :>> responsibility = "Repository of drug information from manufacturers; stores the safe value ranges for all drugs usable for infusion, retrieved by the GPCA for the programmed drug.";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §2.1 and §3.5";
    }
    part entityDrugReservoir : OperationalEntity {
        attribute :>> id = "OE-005";
        attribute :>> name = "DrugReservoir";
        attribute :>> entityKind = OperationalEntityKind::device;
        attribute :>> operationalDomain = "drug storage";
        attribute :>> responsibility = "Apparatus storing the liquid analgesic drug to be infused; filled according to the prescription and connected to the GPCA by the clinician.";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §2.1";
    }
    part entityNeedle : OperationalEntity {
        attribute :>> id = "OE-006";
        attribute :>> name = "InfusionNeedle";
        attribute :>> entityKind = OperationalEntityKind::device;
        attribute :>> operationalDomain = "drug delivery path";
        attribute :>> responsibility = "Intravenous needle inserted into the patient by the clinician and connected to the GPCA standard CCC connection point (I 5) to infuse the drug.";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §2.1 and §3.3 (I 5)";
    }
    part entityPrescription : OperationalEntity {
        attribute :>> id = "OE-007";
        attribute :>> name = "Prescription";
        attribute :>> entityKind = OperationalEntityKind::informationArtifact;
        attribute :>> operationalDomain = "plan of care";
        attribute :>> responsibility = "Instructions governing the plan of care for an individual patient: the drug to be infused and all administration details; provided by a certified medical practitioner.";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §2.1";
    }
    part entityHospital : OperationalEntity {
        attribute :>> id = "OE-008";
        attribute :>> name = "Hospital";
        attribute :>> entityKind = OperationalEntityKind::environmentalEntity;
        attribute :>> operationalDomain = "care environment boundary";
        attribute :>> responsibility = "Environment boundary: fixed (non-ambulatory) usage location with authorized clinicians and the pharmacy database holding drug safe values.";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §2.4";
    }

    // ── Operational activities (therapy lifecycle) ──────────────
    action oaPrescribe : OperationalActivity {
        attribute :>> id = "OA-001";
        attribute :>> name = "PrescribeTherapy";
        attribute :>> trigger = "patient requires titrated analgesia";
        attribute :>> preCondition = "patient assessed; drug has safe-value records in the hospital pharmacy database";
        attribute :>> postCondition = "prescription with basal rate, bolus volume, lockout, and max dose limits exists";
        attribute :>> criticality = CriticalityKind::high;
    }
    action oaLoadReservoir : OperationalActivity {
        attribute :>> id = "OA-002";
        attribute :>> name = "LoadDrugReservoir";
        attribute :>> trigger = "prescription issued or reservoir empty";
        attribute :>> preCondition = "labeled reservoir prepared by pharmacy";
        attribute :>> postCondition = "reservoir mounted, door closed and latched";
        attribute :>> criticality = CriticalityKind::high;
    }
    action oaProgram : OperationalActivity {
        attribute :>> id = "OA-003";
        attribute :>> name = "ProgramPrescription";
        attribute :>> trigger = "reservoir loaded";
        attribute :>> preCondition = "pump in IDLE; clinician authenticated by key or code";
        attribute :>> postCondition = "prescription entered, checked against pharmacy-database safe values (I 9-I 11), and confirmed by second review";
        attribute :>> criticality = CriticalityKind::catastrophic;
    }
    action oaStartTherapy : OperationalActivity {
        attribute :>> id = "OA-004";
        attribute :>> name = "StartInfusion";
        attribute :>> trigger = "prescription confirmed";
        attribute :>> preCondition = "confirmed prescription saved; no active alarm";
        attribute :>> postCondition = "basal infusion running";
        attribute :>> criticality = CriticalityKind::catastrophic;
    }
    action oaRequestBolus : OperationalActivity {
        attribute :>> id = "OA-005";
        attribute :>> name = "RequestPatientBolus";
        attribute :>> trigger = "patient presses bolus request button";
        attribute :>> preCondition = "therapy active";
        attribute :>> postCondition = "bolus delivered, or request ignored when lockout or max-dose limits apply";
        attribute :>> criticality = CriticalityKind::catastrophic;
    }
    action oaRespondAlarm : OperationalActivity {
        attribute :>> id = "OA-006";
        attribute :>> name = "RespondToAlarm";
        attribute :>> trigger = "audible or visual alarm annunciated";
        attribute :>> preCondition = "alarm condition raised by the pump";
        attribute :>> postCondition = "cause resolved and therapy resumed, or therapy stopped";
        attribute :>> criticality = CriticalityKind::catastrophic;
    }
    action oaReviewLog : OperationalActivity {
        attribute :>> id = "OA-007";
        attribute :>> name = "ReviewEventLog";
        attribute :>> trigger = "shift change, incident review, or dose audit";
        attribute :>> preCondition = "event log populated during therapy";
        attribute :>> postCondition = "delivered doses and alarm history reviewed";
        attribute :>> criticality = CriticalityKind::medium;
    }
    action oaMaintain : OperationalActivity {
        attribute :>> id = "OA-008";
        attribute :>> name = "MaintainDevice";
        attribute :>> trigger = "scheduled maintenance or fault";
        attribute :>> preCondition = "pump out of clinical use; technician authenticated";
        attribute :>> postCondition = "battery, calibration, and pharmacy-database connection verified";
        attribute :>> criticality = CriticalityKind::medium;
    }

    // ── Scenario-driven operational model ──────────────────────
    // The use case is the patient and clinician goal. It is supported by
    // several workflows, each of which owns multiple selected scenarios.
    use case ucDeliverPcaTherapy : UseCase {
        attribute :>> useCaseKind = UseCaseKind::clinical;
        attribute :>> id = "UC-001";
        attribute :>> name = "DeliverPatientControlledAnalgesia";
        attribute :>> goalStatement = "Deliver prescribed analgesia safely while allowing patient-controlled bolus requests within configured limits.";
        attribute :>> trigger = "A clinician starts prescribed patient-controlled analgesia therapy.";
        attribute :>> successOutcome = "The patient receives prescribed analgesia without exceeding dose, lockout, or safety limits.";
        ref :>> primaryUser = actorNurse;
        ref :>> supportingActors = (actorPatient, actorPrescriber, actorPharmacist);
        ref :>> useContext = hospitalWardContext;
    }

    action wfPrepareAndStartTherapy : OperationalWorkflow {
        attribute :>> name = "PrepareAndStartTherapy";
        attribute :>> workflowState = WorkflowStateKind::toBe;
        attribute :>> entryCondition = "A valid prescription and prepared reservoir are available.";
        attribute :>> completionCondition = "Therapy is started with confirmed prescription limits.";
    }
    action wfManageActiveTherapy : OperationalWorkflow {
        attribute :>> name = "ManageActiveTherapy";
        attribute :>> workflowState = WorkflowStateKind::toBe;
        attribute :>> entryCondition = "Basal therapy is active.";
        attribute :>> completionCondition = "A bolus is handled or active therapy continues safely.";
    }
    action wfRespondToTherapyAlarm : OperationalWorkflow {
        attribute :>> name = "RespondToTherapyAlarm";
        attribute :>> workflowState = WorkflowStateKind::toBe;
        attribute :>> entryCondition = "A therapy alarm or degraded condition is detected.";
        attribute :>> completionCondition = "The pump is safe and the clinician has resolved or escalated the condition.";
    }
    action wsProgram : WorkflowStep { ref :>> performedActivity = oaProgram; }
    action wsStart : WorkflowStep { ref :>> performedActivity = oaStartTherapy; }
    action wsRequestBolus : WorkflowStep { ref :>> performedActivity = oaRequestBolus; }
    action wsRespondAlarm : WorkflowStep { ref :>> performedActivity = oaRespondAlarm; }
    connection : Supports { attribute :>> supportKind = SupportKind::useCase; connect supporter ::> wfPrepareAndStartTherapy to supported ::> ucDeliverPcaTherapy; }
    connection : Supports { attribute :>> supportKind = SupportKind::useCase; connect supporter ::> wfManageActiveTherapy to supported ::> ucDeliverPcaTherapy; }
    connection : Supports { attribute :>> supportKind = SupportKind::useCase; connect supporter ::> wfRespondToTherapyAlarm to supported ::> ucDeliverPcaTherapy; }
    connection : Composes connect parent ::> wfPrepareAndStartTherapy to child ::> wsProgram;
    connection : Composes connect parent ::> wfPrepareAndStartTherapy to child ::> wsStart;
    connection : Composes connect parent ::> wfManageActiveTherapy to child ::> wsRequestBolus;
    connection : Composes connect parent ::> wfRespondToTherapyAlarm to child ::> wsRespondAlarm;

    // ── Scenario-owned operational activities and action flows ──
    action oaCompleteNominalTherapy : OperationalActivity {
        attribute :>> name = "CompleteNominalTherapy";
        action deliverWithinLimits; action recordTherapyEvent;
        first start then deliverWithinLimits; first deliverWithinLimits then recordTherapyEvent; first recordTherapyEvent then done;
    }
    action oaRejectBolusDuringLockout : OperationalActivity {
        attribute :>> name = "RejectBolusDuringLockout";
        action checkLockout; action rejectAndLog;
        first start then checkLockout; first checkLockout then rejectAndLog; first rejectAndLog then done;
    }
    action oaRespondToOcclusion : OperationalActivity {
        attribute :>> name = "RespondToOcclusion";
        action pauseInfusion; action annunciateOcclusion; action resolveAndResume;
        first start then pauseInfusion; first pauseInfusion then annunciateOcclusion; first annunciateOcclusion then resolveAndResume; first resolveAndResume then done;
    }
    action oaRespondToAirInLine : OperationalActivity {
        attribute :>> name = "RespondToAirInLine";
        action stopOrKvo; action annunciateAir; action reprimeAndRestart;
        first start then stopOrKvo; first stopOrKvo then annunciateAir; first annunciateAir then reprimeAndRestart; first reprimeAndRestart then done;
    }
    action oaReplaceEmptyReservoir : OperationalActivity {
        attribute :>> name = "ReplaceEmptyReservoir";
        action stopAndAnnunciate; action replaceReservoir; action resumeTherapy;
        first start then stopAndAnnunciate; first stopAndAnnunciate then replaceReservoir; first replaceReservoir then resumeTherapy; first resumeTherapy then done;
    }
    action oaRecoverAfterPowerLoss : OperationalActivity {
        attribute :>> name = "RecoverAfterPowerLoss";
        action switchToBattery; action restorePrescription; action confirmRestart;
        first start then switchToBattery; first switchToBattery then restorePrescription; first restorePrescription then confirmRestart; first confirmRestart then done;
    }

    // ── Operational capabilities ────────────────────────────────
    part ocTitratedAnalgesia : OperationalCapability {
        attribute :>> id = "OC-001";
        attribute :>> name = "DeliverTitratedAnalgesia";
        attribute :>> capabilityLevel = "primary";
        attribute :>> preCondition = "confirmed prescription and loaded reservoir";
        attribute :>> postCondition = "drug delivered within prescribed limits at all times";
    }
    part ocFailSafeTherapy : OperationalCapability {
        attribute :>> id = "OC-002";
        attribute :>> name = "FailSafeTherapyManagement";
        attribute :>> capabilityLevel = "safety";
        attribute :>> preCondition = "any single failure or foreseeable misuse";
        attribute :>> postCondition = "pump reaches a safe state (infusion stopped or paused) and the operator is alerted";
    }

    // ── Operational scenarios ───────────────────────────────────
    action osNominalTherapy : OperativeScenario {
        attribute :>> id = "OS-001";
        attribute :>> name = "NominalTherapySession";
        attribute :>> variantKind = ScenarioVariantKind::nominal;
        attribute :>> operationalCondition = OperationalConditionKind::normal;
        attribute :>> preCondition = "prescription issued, reservoir loaded";
        attribute :>> postCondition = "therapy completed and stopped by clinician";
        attribute :>> pathSummary = "Prescribe > load reservoir > program and confirm > start basal > patient boluses within limits > stop therapy > review log.";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §2.2 Main GPCA System Functions";
        ref :>> parentWorkflow = wfManageActiveTherapy;
        ref :>> parentUseCase = ucDeliverPcaTherapy;
        ref :>> activities = oaCompleteNominalTherapy;
    }
    action osLockoutBolus : OperativeScenario {
        attribute :>> id = "OS-002";
        attribute :>> name = "BolusRequestDuringLockout";
        attribute :>> variantKind = ScenarioVariantKind::alternate;
        attribute :>> variationPoint = "patient bolus request during the nominal therapy lockout interval";
        attribute :>> operationalCondition = OperationalConditionKind::foreseeableMisuse;
        attribute :>> preCondition = "basal infusion active; lockout interval running";
        attribute :>> postCondition = "request ignored, logged; basal continues unchanged";
        attribute :>> pathSummary = "Patient presses bolus button during lockout > infusion manager rejects request > event logged > no additional drug delivered.";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.9 PATIENT BOLUS mode (lockout requirements)";
        ref :>> parentWorkflow = wfManageActiveTherapy;
        ref :>> parentUseCase = ucDeliverPcaTherapy;
        ref :>> baseScenario = osNominalTherapy;
        ref :>> activities = oaRejectBolusDuringLockout;
    }
    action osOcclusionAlarm : OperativeScenario {
        attribute :>> id = "OS-003";
        attribute :>> name = "OcclusionDetectedDuringInfusion";
        attribute :>> variantKind = ScenarioVariantKind::exception;
        attribute :>> variationPoint = "occlusion detected while nominal infusion is active";
        attribute :>> operationalCondition = OperationalConditionKind::degraded;
        attribute :>> preCondition = "therapy active; downstream line becomes blocked";
        attribute :>> postCondition = "infusion paused, alarm annunciated, clinician clears occlusion and resumes";
        attribute :>> pathSummary = "Occlusion sensor exceeds pressure threshold > alarm raised same step > infusion paused > audible and visual annunciation > clinician resolves and resumes.";
        attribute :>> sourceReference = "CITE-004: GIP Hazard Analysis v1.0 (2009), §2.2 Alarms and Alerts (occlusion)";
        ref :>> parentWorkflow = wfRespondToTherapyAlarm;
        ref :>> parentUseCase = ucDeliverPcaTherapy;
        ref :>> baseScenario = osNominalTherapy;
        ref :>> activities = oaRespondToOcclusion;
    }
    action osAirInLine : OperativeScenario {
        attribute :>> id = "OS-004";
        attribute :>> name = "AirInLineDetected";
        attribute :>> variantKind = ScenarioVariantKind::exception;
        attribute :>> variationPoint = "air-in-line detected while nominal infusion is active";
        attribute :>> operationalCondition = OperationalConditionKind::degraded;
        attribute :>> preCondition = "therapy active; air bubble enters tubing";
        attribute :>> postCondition = "infusion stopped before air reaches patient; alarm annunciated";
        attribute :>> pathSummary = "Air-in-line sensor detects bubble above threshold > transition to PAUSED (KVO flow) > High-priority Air embolism notification > clinician re-primes line and restarts.";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 Notification Requirements (REQ 59: Air embolism)";
        ref :>> parentWorkflow = wfRespondToTherapyAlarm;
        ref :>> parentUseCase = ucDeliverPcaTherapy;
        ref :>> baseScenario = osNominalTherapy;
        ref :>> activities = oaRespondToAirInLine;
    }
    action osEmptyReservoir : OperativeScenario {
        attribute :>> id = "OS-005";
        attribute :>> name = "ReservoirEmptyDuringTherapy";
        attribute :>> variantKind = ScenarioVariantKind::exception;
        attribute :>> variationPoint = "reservoir-empty threshold reached during nominal therapy";
        attribute :>> operationalCondition = OperationalConditionKind::degraded;
        attribute :>> preCondition = "therapy active; reservoir volume reaches empty threshold";
        attribute :>> postCondition = "infusion stopped, alarm raised, reservoir replaced";
        attribute :>> pathSummary = "Reservoir-empty condition detected > transition to PAUSED (KVO flow) > High-priority Empty Reservoir notification > clinician loads new reservoir > therapy resumed with saved prescription.";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 Notification Requirements (REQ 59: Empty Reservoir)";
        ref :>> parentWorkflow = wfRespondToTherapyAlarm;
        ref :>> parentUseCase = ucDeliverPcaTherapy;
        ref :>> baseScenario = osNominalTherapy;
        ref :>> activities = oaReplaceEmptyReservoir;
    }
    action osPowerLoss : OperativeScenario {
        attribute :>> id = "OS-006";
        attribute :>> name = "MainsPowerLossAndRecovery";
        attribute :>> variantKind = ScenarioVariantKind::recovery;
        attribute :>> variationPoint = "mains supply lost during nominal therapy";
        attribute :>> operationalCondition = OperationalConditionKind::degraded;
        attribute :>> preCondition = "therapy active on mains power";
        attribute :>> postCondition = "therapy continues on battery; prescription preserved across full power loss";
        attribute :>> pathSummary = "Mains lost > battery takes over with notification > if battery depletes, pump stops safely > on power restore, saved prescription recovered and therapy resumed only after clinician confirmation.";
        attribute :>> sourceReference = "CITE-004: GIP Hazard Analysis v1.0 (2009), §2.4.3 Electrical Hazards (battery failure)";
        ref :>> parentWorkflow = wfRespondToTherapyAlarm;
        ref :>> parentUseCase = ucDeliverPcaTherapy;
        ref :>> baseScenario = osNominalTherapy;
        ref :>> activities = oaRecoverAfterPowerLoss;
    }
    connection : Realizes connect realizing ::> osNominalTherapy to realized ::> ucDeliverPcaTherapy;
    connection : Realizes connect realizing ::> osLockoutBolus to realized ::> ucDeliverPcaTherapy;
    connection : Realizes connect realizing ::> osOcclusionAlarm to realized ::> ucDeliverPcaTherapy;
    connection : Realizes connect realizing ::> osAirInLine to realized ::> ucDeliverPcaTherapy;
    connection : Realizes connect realizing ::> osEmptyReservoir to realized ::> ucDeliverPcaTherapy;
    connection : Realizes connect realizing ::> osPowerLoss to realized ::> ucDeliverPcaTherapy;
    connection : Composes connect parent ::> osNominalTherapy to child ::> oaCompleteNominalTherapy;
    connection : Composes connect parent ::> osLockoutBolus to child ::> oaRejectBolusDuringLockout;
    connection : Composes connect parent ::> osOcclusionAlarm to child ::> oaRespondToOcclusion;
    connection : Composes connect parent ::> osAirInLine to child ::> oaRespondToAirInLine;
    connection : Composes connect parent ::> osEmptyReservoir to child ::> oaReplaceEmptyReservoir;
    connection : Composes connect parent ::> osPowerLoss to child ::> oaRecoverAfterPowerLoss;
}
