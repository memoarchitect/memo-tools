package memo_examples_gpca_pump_model_catalog_gpca_context {
    private import ScalarValues::*;

    private import memo_architecture_operational_context_actors::*;
    private import memo_architecture_operational_context_use_context::*;
    private import memo_assurance_requirements::*;
    private import memo_assurance_human_factors::*;
    private import memo_core_enumerations::*;

    // ── Intended use (ISO 14971 §5.2, IEC 62366-1) ──────────────
    part gpcaIntendedUse : IntendedUse {
        attribute :>> id = "IU-001";
        attribute :>> name = "GPCA_IntendedUse";
        attribute :>> title = "GPCA Pump Intended Use";
        attribute :>> shortDescription = "Patient-controlled analgesia infusion of prescribed opioid analgesics.";
        attribute :>> longDescription = "The GPCA pump delivers a prescribed analgesic drug intravenously at a programmed basal rate, supplemented by square boluses delivered automatically at programmed intervals and by patient-requested bolus doses, subject to lockout intervals and maximum-dose limits.";
        attribute :>> indication = "Management of acute post-operative or chronic pain requiring titrated intravenous opioid analgesia.";
        attribute :>> contraindication = "Patients unable to comprehend or operate the bolus request mechanism; drugs without safe-value records in the hospital pharmacy database.";
        attribute :>> patientPopulation = "Adult in-patients under clinical supervision.";
        attribute :>> clinicalBenefit = "Timely, patient-titrated analgesia with lower total opioid consumption than fixed-schedule dosing.";
        attribute :>> regulatoryClassification = "FDA Class II infusion pump (21 CFR 880.5725); IEC 62304 software safety class C.";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §2.1-2.3 (GPCA overview, system functions, user characteristics)";
    }
    part bolusByProxyMisuse : ReasonablyForeseeableMisuse {
        attribute :>> id = "RFM-001";
        attribute :>> name = "BolusRequestBySomeoneOtherThanPatient";
        attribute :>> title = "Bolus by proxy";
        attribute :>> shortDescription = "A caregiver or visitor presses the patient bolus control.";
        attribute :>> longDescription = "A person other than the patient activates the bolus request control, bypassing the intended patient self-limiting behavior.";
        attribute :>> misuseContext = "Patient-controlled analgesia in a supervised hospital setting.";
        attribute :>> foreseeableBasis = "Known PCA use pattern represented in the GPCA hazard analysis.";
        attribute :>> affectedUseContext = "UC-001";
        attribute :>> sourceReference = "CITE-004: GIP Hazard Analysis v1.0 (2009), §2.4.8; CITE-005: Open PCA ISO 14971 risk analysis, bolus-by-proxy event";
    }

    // ── Use contexts ────────────────────────────────────────────
    part hospitalWardContext : UseContext {
        attribute :>> id = "UC-001";
        attribute :>> name = "HospitalWardUseContext";
        attribute :>> careSetting = "acute-care hospital ward and post-anesthesia care unit";
        attribute :>> environment = "indoor clinical environment, mains power with battery backup, pole or bed-rail mounted";
        attribute :>> jurisdiction = "generic (FDA/EU reference model)";
        attribute :>> connectedUse = true;
        attribute :>> intendedUseReference = "IU-001";
    }
    // UC-002 (intra-hospital transport) removed: CriSys §2.4 states the
    // system is used in a fixed location and is not ambulatory.

    // ── Actors ──────────────────────────────────────────────────
    part actorPatient : User {
        attribute :>> actorKind = ActorKind::patient;
        attribute :>> id = "ACT-001";
        attribute :>> name = "Patient";
        attribute :>> actorKind = ActorKind::patient;
        attribute :>> trainingLevel = "instructed by clinician on bolus request button only";
        attribute :>> description = "Receives the infusion and requests bolus doses via the patient pendant.";
    }
    part actorNurse : User {
        attribute :>> actorKind = ActorKind::clinician;
        attribute :>> id = "ACT-002";
        attribute :>> name = "ClinicianNurse";
        attribute :>> actorKind = ActorKind::clinician;
        attribute :>> trainingLevel = "trained clinical user; programs prescriptions and responds to alarms";
        attribute :>> description = "Loads the drug reservoir, programs and confirms the prescription, starts/stops therapy, and responds to alarms.";
    }
    part actorPrescriber : User {
        attribute :>> actorKind = ActorKind::clinician;
        attribute :>> id = "ACT-003";
        attribute :>> name = "PrescribingPhysician";
        attribute :>> actorKind = ActorKind::clinician;
        attribute :>> trainingLevel = "licensed prescriber";
        attribute :>> description = "Prescribes drug, concentration, basal rate, bolus volume, lockout interval, and maximum dose limits.";
    }
    part actorPharmacist : User {
        attribute :>> actorKind = ActorKind::clinician;
        attribute :>> id = "ACT-004";
        attribute :>> name = "Pharmacist";
        attribute :>> actorKind = ActorKind::clinician;
        attribute :>> trainingLevel = "licensed pharmacist";
        attribute :>> description = "Prepares the drug reservoir and verifies drug and concentration against the prescription.";
    }
    part actorTechnician : User {
        attribute :>> actorKind = ActorKind::technician;
        attribute :>> id = "ACT-005";
        attribute :>> name = "BiomedicalTechnician";
        attribute :>> actorKind = ActorKind::technician;
        attribute :>> trainingLevel = "service-trained; authenticated service access";
        attribute :>> description = "Performs maintenance, battery replacement, and calibration through the service interface.";
    }

    // ── Foreseeable use errors (IEC 62366-1, AAMI TIR PCA) ──────
    part ueMisprogrammedRate : UseError {
        attribute :>> id = "UE-001";
        attribute :>> name = "MisprogrammedInfusionParameters";
        attribute :>> errorCategory = UseErrorCategoryKind::actionCategory;
        attribute :>> taskReference = "OA-003: Program prescription";
        attribute :>> severity = SeverityKind::catastrophic;
        attribute :>> rootCauseType = "decimal-point / unit entry slip during prescription programming";
        attribute :>> description = "Clinician enters a basal rate or bolus volume an order of magnitude off (e.g. mg vs mL, misplaced decimal).";
        attribute :>> sourceReference = "CITE-004: GIP Hazard Analysis v1.0 (2009), §2.4.8 Use Hazards (incorrect dose settings)";
    }
    part ueBolusByProxy : UseError {
        attribute :>> id = "UE-002";
        attribute :>> name = "PCAByProxy";
        attribute :>> errorCategory = UseErrorCategoryKind::cognition;
        attribute :>> taskReference = "OA-005: Request patient bolus";
        attribute :>> severity = SeverityKind::catastrophic;
        attribute :>> rootCauseType = "family member or caregiver presses bolus button on behalf of a sedated patient";
        attribute :>> description = "Bolus doses requested by someone other than the patient defeat the inherent safety of patient-limited dosing.";
        attribute :>> sourceReference = "illustrative — no source";
    }
    part ueWrongDrugLoaded : UseError {
        attribute :>> id = "UE-003";
        attribute :>> name = "WrongDrugOrConcentrationLoaded";
        attribute :>> errorCategory = UseErrorCategoryKind::cognition;
        attribute :>> taskReference = "OA-002: Load drug reservoir";
        attribute :>> severity = SeverityKind::catastrophic;
        attribute :>> rootCauseType = "reservoir containing wrong drug or concentration mounted without verification";
        attribute :>> description = "Loaded drug or concentration differs from the programmed prescription, so delivered dose differs from intended dose.";
        attribute :>> sourceReference = "illustrative — no source";
    }
    part ueAlarmDisregard : UseError {
        attribute :>> id = "UE-004";
        attribute :>> name = "AlarmSilencedAndForgotten";
        attribute :>> errorCategory = UseErrorCategoryKind::memoryRecall;
        attribute :>> taskReference = "OA-006: Respond to alarm";
        attribute :>> severity = SeverityKind::serious;
        attribute :>> rootCauseType = "alarm silenced during high workload and the underlying condition never resolved";
        attribute :>> description = "Clinician silences an alarm and does not return to resolve the underlying condition (e.g. occlusion), interrupting therapy.";
        attribute :>> sourceReference = "CITE-004: GIP Hazard Analysis v1.0 (2009), §2.4.8 Use Hazards (attentional/memory failure)";
    }
}
