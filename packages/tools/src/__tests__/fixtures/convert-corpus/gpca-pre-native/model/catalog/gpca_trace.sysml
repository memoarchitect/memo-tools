package memo_examples_gpca_pump_model_catalog_gpca_trace {
    private import ScalarValues::*;

    private import memo_core_relationships::*;
    private import memo_architecture_operational_context_actors::*;
    private import memo_architecture_operational_context_use_context::*;
    private import memo_architecture_operational_activities::*;
    private import memo_architecture_operational_structure::*;
    private import memo_architecture_functional_functions::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_context::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_operational::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_system::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_requirements::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_architecture::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_physical::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_behavior_subsystems::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_behavior_modes::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_interfaces::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_risk::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_analysis::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_verification::*;
    private import memo_examples_gpca_pump_model_views_document_architecture_description_view::*;
    private import memo_examples_gpca_pump_model_views_document_cyber_assessment_view::*;
    private import memo_examples_gpca_pump_model_views_document_dhf_index_view::*;
    private import memo_examples_gpca_pump_model_views_document_hazard_analysis_view::*;
    private import memo_examples_gpca_pump_model_views_document_rmf_view::*;
    private import memo_examples_gpca_pump_model_views_document_sdd_view::*;
    private import memo_examples_gpca_pump_model_views_document_threat_model_view::*;
    private import memo_examples_gpca_pump_model_views_document_usability_view::*;
    private import memo_examples_gpca_pump_model_views_document_vv_view::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_formal_behavior::*;

    // ── System context interactions (context view) ──────────────
    connection : InteractsWith connect contextParticipant ::> actorPatient to target ::> entityGpcaPump;
    connection : InteractsWith connect contextParticipant ::> actorNurse to target ::> entityGpcaPump;
    connection : InteractsWith connect contextParticipant ::> actorPrescriber to target ::> entityGpcaPump;
    connection : InteractsWith connect contextParticipant ::> actorPharmacist to target ::> entityGpcaPump;
    connection : InteractsWith connect contextParticipant ::> actorTechnician to target ::> entityGpcaPump;
    connection : InteractsWith connect contextParticipant ::> actorPharmacist to target ::> entityPharmacy;

    // ── Fig 2.1 context flows (CriSys §2.1) ─────────────────────
    // Data flows
    connection : ExchangesWith connect source ::> entityPrescription to target ::> actorNurse;
    connection : ExchangesWith connect source ::> actorNurse to target ::> entityGpcaPump;
    connection : ExchangesWith connect source ::> entityGpcaPump to target ::> actorNurse;
    connection : ExchangesWith connect source ::> actorPatient to target ::> entityGpcaPump;
    connection : ExchangesWith connect source ::> entityPharmacyDb to target ::> entityGpcaPump;
    // Physical connections (drug path)
    connection : ConnectsPhysically connect source ::> entityDrugReservoir to target ::> entityGpcaPump;
    connection : ConnectsPhysically connect source ::> entityGpcaPump to target ::> entityNeedle;
    connection : ConnectsPhysically connect source ::> entityNeedle to target ::> actorPatient;
    connection : ConnectsPhysically connect source ::> entityPowerInfrastructure to target ::> entityGpcaPump;
    // Intended use and use context anchoring (no floating context nodes)
    connection : Governs { attribute :>> governKind = GovernKind::'use'; connect governor ::> gpcaIntendedUse to governedElement ::> entityGpcaPump; }
    connection : AppliesInContext connect useContext ::> hospitalWardContext to subjectElement ::> entityGpcaPump;
    connection : AppliesInContext connect useContext ::> hospitalWardContext to subjectElement ::> entityHospital;

    // ── Actor participation (use case view) ─────────────────────
    connection : Initiates connect initiatingUser ::> actorNurse to initiatedUseCase ::> ucDeliverPcaTherapy;
    connection : ParticipatesIn connect participatingActor ::> actorPatient to useCase ::> ucDeliverPcaTherapy;
    connection : ParticipatesIn connect participatingActor ::> actorPrescriber to useCase ::> ucDeliverPcaTherapy;
    connection : ParticipatesIn connect participatingActor ::> actorPharmacist to useCase ::> ucDeliverPcaTherapy;
    connection : Performs connect performer ::> actorPrescriber to performed ::> oaPrescribe;
    connection : Performs connect performer ::> actorPharmacist to performed ::> oaLoadReservoir;
    connection : Performs connect performer ::> actorNurse to performed ::> oaProgram;
    connection : Performs connect performer ::> actorNurse to performed ::> oaStartTherapy;
    connection : Performs connect performer ::> actorNurse to performed ::> oaRespondAlarm;
    connection : Performs connect performer ::> actorNurse to performed ::> oaReviewLog;
    connection : Performs connect performer ::> actorPatient to performed ::> oaRequestBolus;
    connection : Performs connect performer ::> actorTechnician to performed ::> oaMaintain;

    // ── Operational thread (therapy lifecycle) ──────────────────
    connection : Precedes connect predecessor ::> oaPrescribe to successor ::> oaLoadReservoir;
    connection : Precedes connect predecessor ::> oaLoadReservoir to successor ::> oaProgram;
    connection : Precedes connect predecessor ::> oaProgram to successor ::> oaStartTherapy;
    connection : Precedes connect predecessor ::> oaStartTherapy to successor ::> oaRequestBolus;
    connection : Supports { attribute :>> supportKind = SupportKind::capability; connect supporter ::> oaStartTherapy to supported ::> ocTitratedAnalgesia; }
    connection : Supports { attribute :>> supportKind = SupportKind::capability; connect supporter ::> oaRequestBolus to supported ::> ocTitratedAnalgesia; }
    connection : Supports { attribute :>> supportKind = SupportKind::capability; connect supporter ::> oaRespondAlarm to supported ::> ocFailSafeTherapy; }
    connection : DerivesFrom connect sourceDriver ::> oaProgram to targetRequirement ::> reqDrugLibraryLimits;
    connection : DerivesFrom connect sourceDriver ::> oaRequestBolus to targetRequirement ::> reqCs25;
    connection : DerivesFrom connect sourceDriver ::> oaRespondAlarm to targetRequirement ::> reqCs59;

    // ── Functional chains ───────────────────────────────────────
    connection : InvolvesFunction connect functionalChain ::> fcPatientBolus to function ::> fnAcquireSensors;
    connection : InvolvesFunction connect functionalChain ::> fcPatientBolus to function ::> fnEnforceLimits;
    connection : InvolvesFunction connect functionalChain ::> fcPatientBolus to function ::> fnManageInfusion;
    connection : InvolvesFunction connect functionalChain ::> fcPatientBolus to function ::> fnCommandPump;
    connection : InvolvesFunction connect functionalChain ::> fcPatientBolus to function ::> fnLogEvents;
    connection : InvolvesFunction connect functionalChain ::> fcAlarmStop to function ::> fnAcquireSensors;
    connection : InvolvesFunction connect functionalChain ::> fcAlarmStop to function ::> fnMonitorAlarm;
    connection : InvolvesFunction connect functionalChain ::> fcAlarmStop to function ::> fnManageInfusion;
    connection : InvolvesFunction connect functionalChain ::> fcAlarmStop to function ::> fnAnnunciate;
    connection : InvolvesFunction connect functionalChain ::> fcStartup to function ::> fnSelfTest;
    connection : InvolvesFunction connect functionalChain ::> fcStartup to function ::> fnPresentStatus;
    connection : Realizes connect realizing ::> fcPatientBolus to realized ::> ssBolusDuringBasal;
    connection : Realizes connect realizing ::> fcAlarmStop to realized ::> ssAlarmPause;
    connection : IncludesStep connect functionalChain ::> fcPatientBolus to step ::> fcsBolusSense;
    connection : IncludesStep connect functionalChain ::> fcPatientBolus to step ::> fcsBolusValidate;
    connection : IncludesStep connect functionalChain ::> fcPatientBolus to step ::> fcsBolusCommand;
    connection : IncludesStep connect functionalChain ::> fcPatientBolus to step ::> fcsBolusActuate;
    connection : IncludesStep connect functionalChain ::> fcPatientBolus to step ::> fcsBolusLog;
    connection : IncludesStep connect functionalChain ::> fcAlarmStop to step ::> fcsAlarmSense;
    connection : IncludesStep connect functionalChain ::> fcAlarmStop to step ::> fcsAlarmEvaluate;
    connection : IncludesStep connect functionalChain ::> fcAlarmStop to step ::> fcsAlarmStopInfusion;
    connection : IncludesStep connect functionalChain ::> fcAlarmStop to step ::> fcsAlarmAnnunciate;

    // ── Requirement derivation ──────────────────────────────────
    // MEMO extension requirements (REQ-X) derive from needs and risks.
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqPost;
    connection : DerivesFrom connect sourceDriver ::> needEffectiveAnalgesia to targetRequirement ::> reqPumpAccuracy;
    connection : DerivesFrom connect sourceDriver ::> needEffectiveAnalgesia to targetRequirement ::> reqBatteryBackup;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqAlarmLoudness;
    connection : DerivesFrom connect sourceDriver ::> needAuditableRecord to targetRequirement ::> reqEventLogging;
    connection : DerivesFrom connect sourceDriver ::> overdoseHazard to targetRequirement ::> reqCs25;
    connection : DerivesFrom connect sourceDriver ::> underdoseHazard to targetRequirement ::> reqOcclusion;
    connection : DerivesFrom connect sourceDriver ::> airEmbolismHazard to targetRequirement ::> reqCs21;
    connection : DerivesFrom connect sourceDriver ::> wrongDoseHazard to targetRequirement ::> reqDrugLibraryLimits;
    connection : DerivesFrom connect sourceDriver ::> freeFlowHazard to targetRequirement ::> reqFreeFlowPrevention;
    connection : DerivesFrom connect sourceDriver ::> reverseDeliveryHazard to targetRequirement ::> reqCs22;
    connection : DerivesFrom connect sourceDriver ::> vtbiOverInfusionHazard to targetRequirement ::> reqCs20;
    connection : DerivesFrom connect sourceDriver ::> vtbiOverInfusionHazard to targetRequirement ::> reqCs28;
    connection : DerivesFrom connect sourceDriver ::> riskBeforeReverse to targetRequirement ::> reqCs22;
    connection : DerivesFrom connect sourceDriver ::> riskBeforeVtbi to targetRequirement ::> reqCs20;
    connection : DerivesFrom connect sourceDriver ::> riskBefore to targetRequirement ::> reqCs25;
    connection : DerivesFrom connect sourceDriver ::> riskBefore to targetRequirement ::> reqCs19;
    connection : DerivesFrom connect sourceDriver ::> riskBefore to targetRequirement ::> reqMaxHourlyDose;
    connection : DerivesFrom connect sourceDriver ::> riskBefore to targetRequirement ::> reqStuckButton;
    connection : DerivesFrom connect sourceDriver ::> riskBefore to targetRequirement ::> reqWatchdogSafeState;
    connection : DerivesFrom connect sourceDriver ::> riskBefore to targetRequirement ::> reqFlowCrossCheck;
    connection : DerivesFrom connect sourceDriver ::> riskBeforeAir to targetRequirement ::> reqCs21;
    connection : DerivesFrom connect sourceDriver ::> riskBeforeUnderdose to targetRequirement ::> reqOcclusion;
    connection : DerivesFrom connect sourceDriver ::> riskBeforeUnderdose to targetRequirement ::> reqCs23;
    connection : DerivesFrom connect sourceDriver ::> riskBeforeUnderdose to targetRequirement ::> reqPowerLossRetention;
    connection : DerivesFrom connect sourceDriver ::> riskBeforeWrongDose to targetRequirement ::> reqDrugLibraryLimits;
    connection : DerivesFrom connect sourceDriver ::> riskBeforeWrongDose to targetRequirement ::> reqCs09;
    connection : DerivesFrom connect sourceDriver ::> riskBeforeFreeFlow to targetRequirement ::> reqFreeFlowPrevention;
    connection : DerivesFrom connect sourceDriver ::> riskBeforeFreeFlow to targetRequirement ::> reqDoorOpen;
    // CriSys source requirements (REQ-CS) trace to the stakeholder
    // needs they serve. §4.1 GPCA system + OFF/ON/IDLE modes.
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs01;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs02;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs03;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs04;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs05;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs06;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs07;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs08;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs10;
    connection : DerivesFrom connect sourceDriver ::> needAuditableRecord to targetRequirement ::> reqCs11;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs12;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs13;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs14;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs15;
    // §4.1 THERAPY/ACTIVE/BASAL/bolus/PAUSED modes.
    connection : DerivesFrom connect sourceDriver ::> needEffectiveAnalgesia to targetRequirement ::> reqCs16;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs17;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs18;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs20;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs22;
    connection : DerivesFrom connect sourceDriver ::> needEffectiveAnalgesia to targetRequirement ::> reqCs24;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs26;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs27;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs28;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs29;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs30;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs31;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs32;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs33;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs34;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs35;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs36;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs37;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs38;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs39;
    connection : DerivesFrom connect sourceDriver ::> needEffectiveAnalgesia to targetRequirement ::> reqCs40;
    connection : DerivesFrom connect sourceDriver ::> needEffectiveAnalgesia to targetRequirement ::> reqCs41;
    connection : DerivesFrom connect sourceDriver ::> needEffectiveAnalgesia to targetRequirement ::> reqCs42;
    connection : DerivesFrom connect sourceDriver ::> needEffectiveAnalgesia to targetRequirement ::> reqCs43;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs44;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs45;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs46;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs47;
    // §4.2 data configuration.
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs48;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs49;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs50;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs51;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs52;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs53;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs54;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs55;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs56;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs57;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs58;
    // §4.3 notification, §4.4 logs, §4.5 security, Ch.5 non-behavioral.
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs59;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs60;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs61;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs62;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs63;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs64;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs65;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs66;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs67;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs68;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs69;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs70;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs71;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs72;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs73;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs74;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs75;
    connection : DerivesFrom connect sourceDriver ::> needTimelyAlarms to targetRequirement ::> reqCs76;
    connection : DerivesFrom connect sourceDriver ::> needAuditableRecord to targetRequirement ::> reqCs77;
    connection : DerivesFrom connect sourceDriver ::> needAuditableRecord to targetRequirement ::> reqCs78;
    connection : DerivesFrom connect sourceDriver ::> needAuditableRecord to targetRequirement ::> reqCs79;
    connection : DerivesFrom connect sourceDriver ::> needAuditableRecord to targetRequirement ::> reqCs80;
    connection : DerivesFrom connect sourceDriver ::> needAuditableRecord to targetRequirement ::> reqCs81;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs82;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs83;
    connection : DerivesFrom connect sourceDriver ::> needSafeTherapy to targetRequirement ::> reqCs84;
    connection : DerivesFrom connect sourceDriver ::> needAuditableRecord to targetRequirement ::> reqCs85;
    connection : DerivesFrom connect sourceDriver ::> needAuditableRecord to targetRequirement ::> reqCs86;

    // ── Requirement satisfaction ────────────────────────────────
    connection : SatisfiedBy connect requirementElement ::> reqCs01 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs01 to satisfyingElement ::> outputBus;
    connection : SatisfiedBy connect requirementElement ::> reqCs18 to satisfyingElement ::> systemStatus;
    connection : SatisfiedBy connect requirementElement ::> reqCs23 to satisfyingElement ::> systemStatus;
    connection : SatisfiedBy connect requirementElement ::> reqCs25 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqCs19 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqDrugLibraryLimits to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs09 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqPowerLossRetention to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqPost to satisfyingElement ::> systemMonitor;
    connection : SatisfiedBy connect requirementElement ::> reqWatchdogSafeState to satisfyingElement ::> systemMonitor;
    connection : SatisfiedBy connect requirementElement ::> reqWatchdogSafeState to satisfyingElement ::> controllerBoard;
    connection : SatisfiedBy connect requirementElement ::> reqCs59 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs72 to satisfyingElement ::> audibleAlarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs73 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs75 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs21 to satisfyingElement ::> airInLineSensor;
    connection : SatisfiedBy connect requirementElement ::> reqCs21 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqOcclusion to satisfyingElement ::> occlusionSensor;
    connection : SatisfiedBy connect requirementElement ::> reqOcclusion to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs23 to satisfyingElement ::> reservoirSensor;
    connection : SatisfiedBy connect requirementElement ::> reqCs23 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqDoorOpen to satisfyingElement ::> doorSensor;
    connection : SatisfiedBy connect requirementElement ::> reqDoorOpen to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqMaxHourlyDose to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqStuckButton to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqFlowCrossCheck to satisfyingElement ::> flowSensor;
    connection : SatisfiedBy connect requirementElement ::> reqFlowCrossCheck to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs77 to satisfyingElement ::> logging;
    connection : SatisfiedBy connect requirementElement ::> reqCs78 to satisfyingElement ::> logging;
    connection : SatisfiedBy connect requirementElement ::> reqEventLogging to satisfyingElement ::> logging;
    // CriSys REQ-CS allocation to the UMN software subsystems
    // (coarse; refined against the AADL architecture in GR.04).
    // Mode control -> TLM; flow production -> Infusion_Manager;
    // notifications -> Alarm; data configuration -> Config;
    // logs -> Logging; enclosure non-behavioral -> DeviceEnclosure.
    connection : SatisfiedBy connect requirementElement ::> reqCs02 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs03 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqCs04 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs05 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs06 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqCs07 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs08 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs10 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs11 to satisfyingElement ::> logging;
    connection : SatisfiedBy connect requirementElement ::> reqCs12 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs13 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs14 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqCs15 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs16 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqCs17 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs18 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs20 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs22 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs24 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqCs26 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs27 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs28 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs29 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs30 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs31 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs32 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs33 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs34 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs35 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs36 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs37 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs38 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs39 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs40 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqCs41 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqCs42 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqCs43 to satisfyingElement ::> infusionMgr;
    connection : SatisfiedBy connect requirementElement ::> reqCs44 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs45 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs46 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs47 to satisfyingElement ::> tlm;
    connection : SatisfiedBy connect requirementElement ::> reqCs48 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs49 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs50 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs51 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs52 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs53 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs54 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs55 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs56 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs57 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs58 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs60 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs61 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs62 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs63 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs64 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs65 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs66 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs67 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs68 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs69 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs70 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs71 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs74 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs76 to satisfyingElement ::> alarm;
    connection : SatisfiedBy connect requirementElement ::> reqCs79 to satisfyingElement ::> logging;
    connection : SatisfiedBy connect requirementElement ::> reqCs80 to satisfyingElement ::> logging;
    connection : SatisfiedBy connect requirementElement ::> reqCs81 to satisfyingElement ::> logging;
    connection : SatisfiedBy connect requirementElement ::> reqCs82 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqCs83 to satisfyingElement ::> enclosure;
    connection : SatisfiedBy connect requirementElement ::> reqCs84 to satisfyingElement ::> enclosure;
    connection : SatisfiedBy connect requirementElement ::> reqCs85 to satisfyingElement ::> logging;
    connection : SatisfiedBy connect requirementElement ::> reqCs86 to satisfyingElement ::> config;
    connection : SatisfiedBy connect requirementElement ::> reqPumpAccuracy to satisfyingElement ::> pumpMotorAssembly;
    connection : SatisfiedBy connect requirementElement ::> reqAlarmLoudness to satisfyingElement ::> audibleAlarm;
    connection : SatisfiedBy connect requirementElement ::> reqBatteryBackup to satisfyingElement ::> batteryPack;
    connection : SatisfiedBy connect requirementElement ::> reqFreeFlowPrevention to satisfyingElement ::> antiFreeFlowValve;

    // ── Function allocation ─────────────────────────────────────
    connection : AllocatedTo connect function ::> fnAcquireSensors to allocatedElement ::> gpcaDeviceSensors;
    connection : AllocatedTo connect function ::> fnAcquireSensors to allocatedElement ::> systemStatus;
    connection : AllocatedTo connect function ::> fnPresentStatus to allocatedElement ::> outputBus;
    connection : AllocatedTo connect function ::> fnValidatePrescription to allocatedElement ::> config;
    connection : AllocatedTo connect function ::> fnMonitorAlarm to allocatedElement ::> alarm;
    connection : AllocatedTo connect function ::> fnAnnunciate to allocatedElement ::> audibleAlarm;
    connection : AllocatedTo connect function ::> fnManageInfusion to allocatedElement ::> infusionMgr;
    connection : AllocatedTo connect function ::> fnEnforceLimits to allocatedElement ::> infusionMgr;
    connection : AllocatedTo connect function ::> fnCommandPump to allocatedElement ::> pumpMotorAssembly;
    connection : AllocatedTo connect function ::> fnLogEvents to allocatedElement ::> logging;
    connection : AllocatedTo connect function ::> fnManagePower to allocatedElement ::> systemMonitor;
    connection : AllocatedTo connect function ::> fnPresentStatus to allocatedElement ::> operatorDisplay;
    connection : AllocatedTo connect function ::> fnSelfTest to allocatedElement ::> systemMonitor;

    // ── Deployment, hosting, and interface realization ──────────
    connection : DeploysTo connect deploymentUnit ::> gpcaSoftware to node ::> controllerBoard;
    connection : HostedBy connect processingNode ::> mainController to hostAssembly ::> controllerBoard;
    connection : Realizes connect realized ::> sensorInputInterface to realizing ::> hwSoftwareBus;
    connection : Realizes connect realized ::> actuatorCommandInterface to realizing ::> pumpMotorDrive;
    connection : BindsToInterface connect portElement ::> portPatientPendant to boundInterface ::> bolusButtonLine;
    connection : BindsToInterface connect portElement ::> portMotorDrive to boundInterface ::> pumpMotorDrive;
    connection : BindsToInterface connect portElement ::> portSensorHarness to boundInterface ::> occlusionAnalogLine;
    connection : AllocatedTo connect function ::> lfSensorAcquisition to allocatedElement ::> exSensorVector;
    connection : AllocatedTo connect function ::> lfFlowCommand to allocatedElement ::> exFlowCommand;
    connection : AllocatedTo connect function ::> lfAlarmSignal to allocatedElement ::> exAlarmAnnunciation;
    connection : AllocatedTo connect function ::> lfPrescriptionEntry to allocatedElement ::> exPrescriptionEntry;

    // ── Fig 4.1 mode hierarchy (CriSys §4.1) ────────────────────
    connection : Composes connect parent ::> topLevelModeMachine to child ::> modeOFF;
    connection : Composes connect parent ::> topLevelModeMachine to child ::> modeON;
    connection : Composes connect parent ::> modeON to child ::> modeIDLE;
    connection : Composes connect parent ::> modeON to child ::> modeTHERAPY;
    connection : Composes connect parent ::> modeTHERAPY to child ::> modePAUSED;
    connection : Composes connect parent ::> modeTHERAPY to child ::> modeACTIVE;
    connection : Composes connect parent ::> modeACTIVE to child ::> modeBASAL;
    connection : Composes connect parent ::> modeACTIVE to child ::> modeSQUARE;
    connection : Composes connect parent ::> modeACTIVE to child ::> modePBOLUS;

    // ── GPCA_SW.Impl connection topology (AADL, 1:1; CE-101..142) ──
    // Edges mirror the 42 GPCA_SW.Impl port connections; immediate
    // semantics per connection are carried on the CE-1xx elements.
    connection : ExchangesWith connect source ::> portOpCmdIn to target ::> tlm;
    connection : ExchangesWith connect source ::> portConstIn to target ::> tlm;
    connection : ExchangesWith connect source ::> tlm to target ::> outputBus;
    connection : ExchangesWith connect source ::> infusionMgr to target ::> systemStatus;
    connection : ExchangesWith connect source ::> tlm to target ::> systemStatus;
    connection : ExchangesWith connect source ::> portSensorIn to target ::> systemStatus;
    connection : ExchangesWith connect source ::> portConstIn to target ::> systemStatus;
    connection : ExchangesWith connect source ::> config to target ::> systemStatus;
    connection : ExchangesWith connect source ::> systemStatus to target ::> outputBus;
    connection : ExchangesWith connect source ::> infusionMgr to target ::> alarm;
    connection : ExchangesWith connect source ::> tlm to target ::> alarm;
    connection : ExchangesWith connect source ::> systemMonitor to target ::> alarm;
    connection : ExchangesWith connect source ::> portOpCmdIn to target ::> alarm;
    connection : ExchangesWith connect source ::> portDbIn to target ::> alarm;
    connection : ExchangesWith connect source ::> portSensorIn to target ::> alarm;
    connection : ExchangesWith connect source ::> portConstIn to target ::> alarm;
    connection : ExchangesWith connect source ::> systemStatus to target ::> alarm;
    connection : ExchangesWith connect source ::> config to target ::> alarm;
    connection : ExchangesWith connect source ::> alarm to target ::> outputBus;
    connection : ExchangesWith connect source ::> tlm to target ::> config;
    connection : ExchangesWith connect source ::> portPresIn to target ::> config;
    connection : ExchangesWith connect source ::> portOpCmdIn to target ::> config;
    connection : ExchangesWith connect source ::> portDbIn to target ::> config;
    connection : ExchangesWith connect source ::> portConstIn to target ::> config;
    connection : ExchangesWith connect source ::> systemStatus to target ::> config;
    connection : ExchangesWith connect source ::> config to target ::> outputBus;
    connection : ExchangesWith connect source ::> tlm to target ::> infusionMgr;
    connection : ExchangesWith connect source ::> portOpCmdIn to target ::> infusionMgr;
    connection : ExchangesWith connect source ::> portPatientIn to target ::> infusionMgr;
    connection : ExchangesWith connect source ::> config to target ::> infusionMgr;
    connection : ExchangesWith connect source ::> alarm to target ::> infusionMgr;
    connection : ExchangesWith connect source ::> systemStatus to target ::> infusionMgr;
    connection : ExchangesWith connect source ::> infusionMgr to target ::> outputBus;
    connection : ExchangesWith connect source ::> tlm to target ::> systemMonitor;
    connection : ExchangesWith connect source ::> systemMonitor to target ::> outputBus;
    connection : ExchangesWith connect source ::> tlm to target ::> logging;
    connection : ExchangesWith connect source ::> config to target ::> logging;
    connection : ExchangesWith connect source ::> alarm to target ::> logging;
    connection : ExchangesWith connect source ::> systemStatus to target ::> logging;
    connection : ExchangesWith connect source ::> infusionMgr to target ::> logging;
    connection : ExchangesWith connect source ::> logging to target ::> outputBus;
    connection : ExchangesWith connect source ::> outputBus to target ::> portGpcaSwOut;

    // ── GPCA_SW boundary features (AADL GPCA_SW.aadl; CITE-002) ──
    // The seven top-level ports are features of GPCA_Software, so
    // interconnection views pin them on the software boundary.
    connection : Composes connect parent ::> gpcaSoftware to child ::> portOpCmdIn;
    connection : Composes connect parent ::> gpcaSoftware to child ::> portPresIn;
    connection : Composes connect parent ::> gpcaSoftware to child ::> portPatientIn;
    connection : Composes connect parent ::> gpcaSoftware to child ::> portSensorIn;
    connection : Composes connect parent ::> gpcaSoftware to child ::> portConstIn;
    connection : Composes connect parent ::> gpcaSoftware to child ::> portDbIn;
    connection : Composes connect parent ::> gpcaSoftware to child ::> portGpcaSwOut;

    // ── Device/subsystem feature ownership (published AADL, 1:1) ──
    connection : Composes connect parent ::> gpcaDevice to child ::> devOpCmdIn;
    connection : Composes connect parent ::> gpcaDevice to child ::> devDbIn;
    connection : Composes connect parent ::> gpcaDevice to child ::> devPresIn;
    connection : Composes connect parent ::> gpcaDevice to child ::> devPatientIn;
    connection : Composes connect parent ::> gpcaDevice to child ::> devGpcaOut;
    connection : Composes connect parent ::> gpcaDeviceSensors to child ::> snsOpCmdIn;
    connection : Composes connect parent ::> gpcaDeviceSensors to child ::> snsDbIn;
    connection : Composes connect parent ::> gpcaDeviceSensors to child ::> snsPresIn;
    connection : Composes connect parent ::> gpcaDeviceSensors to child ::> snsPatientIn;
    connection : Composes connect parent ::> gpcaDeviceSensors to child ::> snsOpCmdOut;
    connection : Composes connect parent ::> gpcaDeviceSensors to child ::> snsPresOut;
    connection : Composes connect parent ::> gpcaDeviceSensors to child ::> snsPatientOut;
    connection : Composes connect parent ::> gpcaDeviceSensors to child ::> snsSensorOut;
    connection : Composes connect parent ::> gpcaDeviceSensors to child ::> snsConstOut;
    connection : Composes connect parent ::> gpcaDeviceSensors to child ::> snsDbOut;
    connection : Composes connect parent ::> gpcaActuators to child ::> actGpcaSwIn;
    connection : Composes connect parent ::> gpcaActuators to child ::> actGpcaOut;

    // ── GPCA_Device.Impl connections (GPCA_Device.aadl, 1:1) ──
    connection : ExchangesWith connect source ::> devOpCmdIn to target ::> snsOpCmdIn;
    connection : ExchangesWith connect source ::> devDbIn to target ::> snsDbIn;
    connection : ExchangesWith connect source ::> devPresIn to target ::> snsPresIn;
    connection : ExchangesWith connect source ::> devPatientIn to target ::> snsPatientIn;
    connection : ExchangesWith connect source ::> snsOpCmdOut to target ::> portOpCmdIn;
    connection : ExchangesWith connect source ::> snsPresOut to target ::> portPresIn;
    connection : ExchangesWith connect source ::> snsPatientOut to target ::> portPatientIn;
    connection : ExchangesWith connect source ::> snsSensorOut to target ::> portSensorIn;
    connection : ExchangesWith connect source ::> snsConstOut to target ::> portConstIn;
    connection : ExchangesWith connect source ::> snsDbOut to target ::> portDbIn;
    connection : ExchangesWith connect source ::> portGpcaSwOut to target ::> actGpcaSwIn;
    connection : ExchangesWith connect source ::> actGpcaOut to target ::> devGpcaOut;

    // ── Risk chains (ISO 14971, GIIP causal-tree structure) ─────
    // Categorized causes converge on each hazard (GIIP Tables 2-9
    // pattern); hazard -> sequence -> hazardous situation -> harm.
    // HZ-001 opioid over-infusion
    connection : TracesRisk connect sourceRiskElement ::> causeFlowRateTooHigh to targetRiskElement ::> overdoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeFrequentBolus to targetRiskElement ::> overdoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeBolusVolumeTooHigh to targetRiskElement ::> overdoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causePumpCalibration to targetRiskElement ::> overdoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> overdoseHazard to targetRiskElement ::> seqFrequentBolus;
    connection : TracesRisk connect sourceRiskElement ::> seqFrequentBolus to targetRiskElement ::> hsExcessInfusion;
    connection : TracesRisk connect sourceRiskElement ::> hsExcessInfusion to targetRiskElement ::> harmRespiratoryDepression;
    connection : TracesRisk connect sourceRiskElement ::> harmRespiratoryDepression to targetRiskElement ::> riskBefore;
    connection : AssessedAgainst connect risk ::> riskBefore to riskMatrix ::> riskMatrix;
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> lockoutControl to mitigatedElement ::> overdoseHazard; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> drugLibraryControl to mitigatedElement ::> overdoseHazard; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> watchdogControl to mitigatedElement ::> overdoseHazard; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> flowCrossCheckControl to mitigatedElement ::> overdoseHazard; }
    connection : TracesRisk connect sourceRiskElement ::> lockoutControl to targetRiskElement ::> riskAfter;
    connection : AssessedAgainst connect risk ::> riskAfter to riskMatrix ::> riskMatrix;
    connection : TracesRisk connect sourceRiskElement ::> residualEval to targetRiskElement ::> riskAfter;
    // HZ-002 under-infusion
    connection : TracesRisk connect sourceRiskElement ::> causeOcclusion to targetRiskElement ::> underdoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeReservoirEmpty to targetRiskElement ::> underdoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeAirInLine to targetRiskElement ::> underdoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causePumpMechanismFails to targetRiskElement ::> underdoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeFlowRateTooLow to targetRiskElement ::> underdoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> underdoseHazard to targetRiskElement ::> seqOcclusion;
    connection : TracesRisk connect sourceRiskElement ::> seqOcclusion to targetRiskElement ::> hsInterruptedTherapy;
    connection : TracesRisk connect sourceRiskElement ::> hsInterruptedTherapy to targetRiskElement ::> harmUntreatedPain;
    connection : TracesRisk connect sourceRiskElement ::> harmUntreatedPain to targetRiskElement ::> riskBeforeUnderdose;
    connection : AssessedAgainst connect risk ::> riskBeforeUnderdose to riskMatrix ::> riskMatrix;
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> occlusionAlarmControl to mitigatedElement ::> underdoseHazard; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> reservoirMonitorControl to mitigatedElement ::> underdoseHazard; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> flowCrossCheckControl to mitigatedElement ::> underdoseHazard; }
    connection : TracesRisk connect sourceRiskElement ::> occlusionAlarmControl to targetRiskElement ::> riskAfterUnderdose;
    connection : AssessedAgainst connect risk ::> riskAfterUnderdose to riskMatrix ::> riskMatrix;
    connection : TracesRisk connect sourceRiskElement ::> residualEval to targetRiskElement ::> riskAfterUnderdose;
    // HZ-003 air embolism (shares the air-in-line and empty-reservoir causes)
    connection : TracesRisk connect sourceRiskElement ::> causeAirInLine to targetRiskElement ::> airEmbolismHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeReservoirEmpty to targetRiskElement ::> airEmbolismHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeImproperPriming to targetRiskElement ::> airEmbolismHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeTubingLeak to targetRiskElement ::> airEmbolismHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeAirSensorSilent to targetRiskElement ::> airEmbolismHazard;
    connection : TracesRisk connect sourceRiskElement ::> airEmbolismHazard to targetRiskElement ::> seqAirInLine;
    connection : TracesRisk connect sourceRiskElement ::> seqAirInLine to targetRiskElement ::> hsAirTowardPatient;
    connection : TracesRisk connect sourceRiskElement ::> hsAirTowardPatient to targetRiskElement ::> harmAirEmbolism;
    connection : TracesRisk connect sourceRiskElement ::> harmAirEmbolism to targetRiskElement ::> riskBeforeAir;
    connection : AssessedAgainst connect risk ::> riskBeforeAir to riskMatrix ::> riskMatrix;
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> airDetectionControl to mitigatedElement ::> airEmbolismHazard; }
    connection : TracesRisk connect sourceRiskElement ::> airDetectionControl to targetRiskElement ::> riskAfterAir;
    connection : AssessedAgainst connect risk ::> riskAfterAir to riskMatrix ::> riskMatrix;
    connection : TracesRisk connect sourceRiskElement ::> residualEval to targetRiskElement ::> riskAfterAir;
    // HZ-004 misprogramming / wrong drug
    connection : TracesRisk connect sourceRiskElement ::> causeWrongPrescriptionEntered to targetRiskElement ::> wrongDoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeWrongDoseUnits to targetRiskElement ::> wrongDoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeWrongDrugLoaded to targetRiskElement ::> wrongDoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeSettingsChangedInadvertently to targetRiskElement ::> wrongDoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> causePumpRevertsToDefaults to targetRiskElement ::> wrongDoseHazard;
    connection : TracesRisk connect sourceRiskElement ::> wrongDoseHazard to targetRiskElement ::> seqMisprogram;
    connection : TracesRisk connect sourceRiskElement ::> seqMisprogram to targetRiskElement ::> hsWrongTherapy;
    connection : TracesRisk connect sourceRiskElement ::> hsWrongTherapy to targetRiskElement ::> harmRespiratoryDepression;
    connection : TracesRisk connect sourceRiskElement ::> hsWrongTherapy to targetRiskElement ::> riskBeforeWrongDose;
    connection : AssessedAgainst connect risk ::> riskBeforeWrongDose to riskMatrix ::> riskMatrix;
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> drugLibraryControl to mitigatedElement ::> wrongDoseHazard; }
    connection : TracesRisk connect sourceRiskElement ::> drugLibraryControl to targetRiskElement ::> riskAfterWrongDose;
    connection : AssessedAgainst connect risk ::> riskAfterWrongDose to riskMatrix ::> riskMatrix;
    connection : TracesRisk connect sourceRiskElement ::> residualEval to targetRiskElement ::> riskAfterWrongDose;
    // HZ-005 free flow
    connection : TracesRisk connect sourceRiskElement ::> causeSetDisengaged to targetRiskElement ::> freeFlowHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeDoorOpenedDuringInfusion to targetRiskElement ::> freeFlowHazard;
    connection : TracesRisk connect sourceRiskElement ::> freeFlowHazard to targetRiskElement ::> seqFreeFlow;
    connection : TracesRisk connect sourceRiskElement ::> seqFreeFlow to targetRiskElement ::> hsFreeFlow;
    connection : TracesRisk connect sourceRiskElement ::> hsFreeFlow to targetRiskElement ::> harmRespiratoryDepression;
    connection : TracesRisk connect sourceRiskElement ::> hsFreeFlow to targetRiskElement ::> riskBeforeFreeFlow;
    connection : AssessedAgainst connect risk ::> riskBeforeFreeFlow to riskMatrix ::> riskMatrix;
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> freeFlowValveControl to mitigatedElement ::> freeFlowHazard; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> doorInterlockControl to mitigatedElement ::> freeFlowHazard; }
    connection : TracesRisk connect sourceRiskElement ::> freeFlowValveControl to targetRiskElement ::> riskAfterFreeFlow;
    connection : AssessedAgainst connect risk ::> riskAfterFreeFlow to riskMatrix ::> riskMatrix;
    connection : TracesRisk connect sourceRiskElement ::> residualEval to targetRiskElement ::> riskAfterFreeFlow;
    // HZ-006 reverse delivery (CriSys REQ 22; GIP HID 1.14)
    connection : TracesRisk connect sourceRiskElement ::> causeBleedBack to targetRiskElement ::> reverseDeliveryHazard;
    connection : TracesRisk connect sourceRiskElement ::> reverseDeliveryHazard to targetRiskElement ::> seqReverseDelivery;
    connection : TracesRisk connect sourceRiskElement ::> seqReverseDelivery to targetRiskElement ::> hsReverseFlow;
    connection : TracesRisk connect sourceRiskElement ::> hsReverseFlow to targetRiskElement ::> harmUntreatedPain;
    connection : TracesRisk connect sourceRiskElement ::> harmUntreatedPain to targetRiskElement ::> riskBeforeReverse;
    connection : AssessedAgainst connect risk ::> riskBeforeReverse to riskMatrix ::> riskMatrix;
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> reverseDeliveryPauseControl to mitigatedElement ::> reverseDeliveryHazard; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> antiRefluxDesignControl to mitigatedElement ::> reverseDeliveryHazard; }
    connection : TracesRisk connect sourceRiskElement ::> reverseDeliveryPauseControl to targetRiskElement ::> riskAfterReverse;
    connection : AssessedAgainst connect risk ::> riskAfterReverse to riskMatrix ::> riskMatrix;
    connection : TracesRisk connect sourceRiskElement ::> residualEval to targetRiskElement ::> riskAfterReverse;
    // HZ-007 VTBI over-infusion (CriSys REQ 20/28; GIP use hazard 8.1)
    connection : TracesRisk connect sourceRiskElement ::> causeVtbiTooHigh to targetRiskElement ::> vtbiOverInfusionHazard;
    connection : TracesRisk connect sourceRiskElement ::> causeStaleDrugLibrary to targetRiskElement ::> vtbiOverInfusionHazard;
    connection : TracesRisk connect sourceRiskElement ::> vtbiOverInfusionHazard to targetRiskElement ::> seqVtbiExceeded;
    connection : TracesRisk connect sourceRiskElement ::> seqVtbiExceeded to targetRiskElement ::> hsVtbiExceeded;
    connection : TracesRisk connect sourceRiskElement ::> hsVtbiExceeded to targetRiskElement ::> harmRespiratoryDepression;
    connection : TracesRisk connect sourceRiskElement ::> harmRespiratoryDepression to targetRiskElement ::> riskBeforeVtbi;
    connection : AssessedAgainst connect risk ::> riskBeforeVtbi to riskMatrix ::> riskMatrix;
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> vtbiLimitPauseControl to mitigatedElement ::> vtbiOverInfusionHazard; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> infusionCompleteControl to mitigatedElement ::> vtbiOverInfusionHazard; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::hazard; connect control ::> drugLibraryControl to mitigatedElement ::> vtbiOverInfusionHazard; }
    connection : TracesRisk connect sourceRiskElement ::> vtbiLimitPauseControl to targetRiskElement ::> riskAfterVtbi;
    connection : AssessedAgainst connect risk ::> riskAfterVtbi to riskMatrix ::> riskMatrix;
    connection : TracesRisk connect sourceRiskElement ::> residualEval to targetRiskElement ::> riskAfterVtbi;
    // Use errors feeding the risk chains (IEC 62366-1 §5.3)
    connection : TracesRisk connect sourceRiskElement ::> ueMisprogrammedRate to targetRiskElement ::> seqMisprogram;
    connection : TracesRisk connect sourceRiskElement ::> ueWrongDrugLoaded to targetRiskElement ::> seqMisprogram;
    connection : TracesRisk connect sourceRiskElement ::> ueBolusByProxy to targetRiskElement ::> causeFrequentBolus;
    connection : TracesRisk connect sourceRiskElement ::> ueAlarmDisregard to targetRiskElement ::> seqOcclusion;

    // ── FMEA and fault tree integration ─────────────────────────
    connection : AnalyzedBy connect element ::> pumpMotorAssembly to analysisArtifact ::> fmeaDelivery;
    connection : HasFailureMode connect element ::> pumpMotorAssembly to failureMode ::> fmMotorRunaway;
    connection : HasFailureMode connect element ::> airInLineSensor to failureMode ::> fmAirSensorSilent;
    connection : HasFailureMode connect element ::> occlusionSensor to failureMode ::> fmOcclusionDrift;
    connection : HasFailureMode connect element ::> bolusButton to failureMode ::> fmStuckBolusButton;
    connection : HasFailureMode connect element ::> batteryPack to failureMode ::> fmBatteryEarlyDepletion;
    connection : Causes { attribute :>> causeKind = CauseKind::failureCausesEffect; connect cause ::> fmMotorRunaway to effect ::> feOverdose; }
    connection : Causes { attribute :>> causeKind = CauseKind::failureCausesEffect; connect cause ::> fmStuckBolusButton to effect ::> feOverdose; }
    connection : Causes { attribute :>> causeKind = CauseKind::failureCausesEffect; connect cause ::> fmAirSensorSilent to effect ::> feAirDelivered; }
    connection : Causes { attribute :>> causeKind = CauseKind::failureCausesEffect; connect cause ::> fmOcclusionDrift to effect ::> feTherapyInterrupted; }
    connection : Causes { attribute :>> causeKind = CauseKind::failureCausedBy; connect cause ::> fcMotorDriverFault to effect ::> fmMotorRunaway; }
    connection : Causes { attribute :>> causeKind = CauseKind::failureCausedBy; connect cause ::> fcTransducerAging to effect ::> fmAirSensorSilent; }
    connection : Causes { attribute :>> causeKind = CauseKind::failureCausedBy; connect cause ::> fcPendantAbuse to effect ::> fmStuckBolusButton; }
    connection : DetectedBy connect failureMode ::> fmMotorRunaway to detectionMethod ::> dmFlowCrossCheck;
    connection : DetectedBy connect failureMode ::> fmAirSensorSilent to detectionMethod ::> dmPostSensorCheck;
    connection : DetectedBy connect failureMode ::> fmStuckBolusButton to detectionMethod ::> dmStuckInputMonitor;
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::fmeaAction; connect control ::> fmeaActionAirSensor to mitigatedElement ::> fmAirSensorSilent; }
    connection : Causes { attribute :>> causeKind = CauseKind::contributesToHazard; connect cause ::> fmMotorRunaway to effect ::> overdoseHazard; }
    connection : Causes { attribute :>> causeKind = CauseKind::contributesToHazard; connect cause ::> fmStuckBolusButton to effect ::> overdoseHazard; }
    connection : Causes { attribute :>> causeKind = CauseKind::contributesToHazard; connect cause ::> fmAirSensorSilent to effect ::> airEmbolismHazard; }
    connection : Causes { attribute :>> causeKind = CauseKind::contributesToHazard; connect cause ::> fmOcclusionDrift to effect ::> underdoseHazard; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::failureMode; connect control ::> flowCrossCheckControl to mitigatedElement ::> fmMotorRunaway; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::failureMode; connect control ::> lockoutControl to mitigatedElement ::> fmStuckBolusButton; }
    connection : InputToGate connect input ::> fteMotorRunaway to gate ::> ftgMotorAnd;
    connection : InputToGate connect input ::> fteCrossCheckFails to gate ::> ftgMotorAnd;
    connection : InputToGate connect input ::> fteLockoutFault to gate ::> ftgBolusAnd;
    connection : InputToGate connect input ::> fteStuckButtonUndetected to gate ::> ftgBolusAnd;
    connection : InputToGate connect input ::> ftgMotorAnd to gate ::> ftgOverdoseOr;
    connection : InputToGate connect input ::> ftgBolusAnd to gate ::> ftgOverdoseOr;
    connection : ProducesEvent connect gate ::> ftgOverdoseOr to eventElement ::> fteOverdoseTop;
    connection : Causes { attribute :>> causeKind = CauseKind::leadsToHazard; connect cause ::> fteOverdoseTop to effect ::> overdoseHazard; }
    connection : Causes { attribute :>> causeKind = CauseKind::originatesFrom; connect cause ::> pumpMotorAssembly to effect ::> fteMotorRunaway; }
    connection : Causes { attribute :>> causeKind = CauseKind::originatesFrom; connect cause ::> bolusButton to effect ::> fteStuckButtonUndetected; }
    connection : ContainsEvent connect cutSet ::> mcsMotorPath to eventElement ::> fteMotorRunaway;
    connection : ContainsEvent connect cutSet ::> mcsMotorPath to eventElement ::> fteCrossCheckFails;
    connection : ContainsEvent connect cutSet ::> mcsBolusPath to eventElement ::> fteLockoutFault;
    connection : ContainsEvent connect cutSet ::> mcsBolusPath to eventElement ::> fteStuckButtonUndetected;
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::cutSet; connect control ::> flowCrossCheckControl to mitigatedElement ::> mcsMotorPath; }
    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::cutSet; connect control ::> lockoutControl to mitigatedElement ::> mcsBolusPath; }

    // ── Verification coverage (IEC 62304 §5.7) ──────────────────
    connection : VerifiedBy connect verificationTarget ::> reqCs01 to verificationCase ::> vcModeRange;
    connection : VerifiedBy connect verificationTarget ::> reqCs25 to verificationCase ::> vcLockout;
    connection : VerifiedBy connect verificationTarget ::> reqCs19 to verificationCase ::> vcSameStepAlarm;
    connection : VerifiedBy connect verificationTarget ::> reqDrugLibraryLimits to verificationCase ::> vcDrugLibrary;
    connection : VerifiedBy connect verificationTarget ::> reqCs09 to verificationCase ::> vcPrescriptionConfirm;
    connection : VerifiedBy connect verificationTarget ::> reqPost to verificationCase ::> vcPost;
    connection : VerifiedBy connect verificationTarget ::> reqPowerLossRetention to verificationCase ::> vcPowerLoss;
    connection : VerifiedBy connect verificationTarget ::> reqCs72 to verificationCase ::> vcAlarmLoudness;
    connection : VerifiedBy connect verificationTarget ::> reqCs75 to verificationCase ::> vcTemporalModeSafety;
    connection : VerifiedBy connect verificationTarget ::> reqCs21 to verificationCase ::> vcAirInLine;
    connection : VerifiedBy connect verificationTarget ::> reqOcclusion to verificationCase ::> vcOcclusion;
    connection : VerifiedBy connect verificationTarget ::> reqCs23 to verificationCase ::> vcEmptyReservoir;
    connection : VerifiedBy connect verificationTarget ::> reqDoorOpen to verificationCase ::> vcTemporalModeSafety;
    connection : VerifiedBy connect verificationTarget ::> reqMaxHourlyDose to verificationCase ::> vcHourlyMax;
    connection : VerifiedBy connect verificationTarget ::> reqCs78 to verificationCase ::> vcEventLog;
    connection : VerifiedBy connect verificationTarget ::> reqEventLogging to verificationCase ::> vcEventLog;
    connection : VerifiedBy connect verificationTarget ::> reqWatchdogSafeState to verificationCase ::> vcWatchdog;
    connection : VerifiedBy connect verificationTarget ::> reqStuckButton to verificationCase ::> vcStuckButton;
    connection : VerifiedBy connect verificationTarget ::> reqFlowCrossCheck to verificationCase ::> vcFlowCrossCheck;
    connection : VerifiedBy connect verificationTarget ::> reqPumpAccuracy to verificationCase ::> vcPumpAccuracy;
    connection : VerifiedBy connect verificationTarget ::> reqAlarmLoudness to verificationCase ::> vcAlarmLoudness;
    connection : VerifiedBy connect verificationTarget ::> reqBatteryBackup to verificationCase ::> vcPowerLoss;
    connection : VerifiedBy connect verificationTarget ::> reqFreeFlowPrevention to verificationCase ::> vcFreeFlow;
    // risk controls
    connection : VerifiedBy connect verificationTarget ::> lockoutControl to verificationCase ::> vcLockout;
    connection : VerifiedBy connect verificationTarget ::> airDetectionControl to verificationCase ::> vcAirInLine;
    connection : VerifiedBy connect verificationTarget ::> occlusionAlarmControl to verificationCase ::> vcOcclusion;
    connection : VerifiedBy connect verificationTarget ::> reservoirMonitorControl to verificationCase ::> vcEmptyReservoir;
    connection : VerifiedBy connect verificationTarget ::> drugLibraryControl to verificationCase ::> vcDrugLibrary;
    connection : VerifiedBy connect verificationTarget ::> freeFlowValveControl to verificationCase ::> vcFreeFlow;
    connection : VerifiedBy connect verificationTarget ::> watchdogControl to verificationCase ::> vcWatchdog;
    connection : VerifiedBy connect verificationTarget ::> flowCrossCheckControl to verificationCase ::> vcFlowCrossCheck;
    connection : VerifiedBy connect verificationTarget ::> doorInterlockControl to verificationCase ::> vcDoorInterlock;
    connection : VerifiedBy connect verificationTarget ::> reverseDeliveryPauseControl to verificationCase ::> vcReverseDeliveryPause;
    connection : VerifiedBy connect verificationTarget ::> antiRefluxDesignControl to verificationCase ::> vcAntiRefluxMechanism;
    connection : VerifiedBy connect verificationTarget ::> vtbiLimitPauseControl to verificationCase ::> vcVtbiCeiling;
    connection : VerifiedBy connect verificationTarget ::> infusionCompleteControl to verificationCase ::> vcInfusionComplete;
    // behavior properties, contracts, and timing
    connection : VerifiedBy connect verificationTarget ::> propAlarmStopsSameStep to verificationCase ::> vcSameStepAlarm;
    connection : VerifiedBy connect verificationTarget ::> propLockoutTimerMonotonic to verificationCase ::> vcTemporalModeSafety;
    connection : VerifiedBy connect verificationTarget ::> guaranteeExclusiveMode to verificationCase ::> vcModeRange;
    connection : VerifiedBy connect verificationTarget ::> guaranteeLockoutPreventsBolus to verificationCase ::> vcLockout;
    connection : VerifiedBy connect verificationTarget ::> guaranteeAlarmStopsSameStep to verificationCase ::> vcSameStepAlarm;
    connection : VerifiedBy connect verificationTarget ::> temporalNoInvalidTransition to verificationCase ::> vcTemporalModeSafety;
    connection : VerifiedBy connect verificationTarget ::> tcAlarmLatency to verificationCase ::> vcSameStepAlarm;
    connection : VerifiedBy connect verificationTarget ::> tcBolusResponse to verificationCase ::> vcLockout;
    connection : VerifiedBy connect verificationTarget ::> tcWatchdogTimeout to verificationCase ::> vcWatchdog;
    // class-C software items
    connection : VerifiedBy connect verificationTarget ::> tlm to verificationCase ::> vcModeRange;
    connection : VerifiedBy connect verificationTarget ::> alarm to verificationCase ::> vcSameStepAlarm;
    connection : VerifiedBy connect verificationTarget ::> infusionMgr to verificationCase ::> vcLockout;
    connection : VerifiedBy connect verificationTarget ::> config to verificationCase ::> vcDrugLibrary;
    connection : VerifiedBy connect verificationTarget ::> logging to verificationCase ::> vcEventLog;
    connection : VerifiedBy connect verificationTarget ::> systemMonitor to verificationCase ::> vcPost;
    connection : VerifiedBy connect verificationTarget ::> systemStatus to verificationCase ::> vcEmptyReservoir;
    connection : VerifiedBy connect verificationTarget ::> outputBus to verificationCase ::> vcModeRange;

    // ── Validation and usability testing ────────────────────────
    connection : Validates connect validationTarget ::> reqCs59 to validationCase ::> valSimulatedWard;
    connection : Validates connect validationTarget ::> reqCs09 to validationCase ::> valSummativeUsability;
    connection : Validates connect validationTarget ::> reqCs73 to validationCase ::> valSummativeUsability;
    connection : TestedByUsability connect uiElementOrTask ::> ueMisprogrammedRate to usabilityTest ::> valSummativeUsability;
    connection : TestedByUsability connect uiElementOrTask ::> ueBolusByProxy to usabilityTest ::> valSummativeUsability;
    connection : TestedByUsability connect uiElementOrTask ::> ueWrongDrugLoaded to usabilityTest ::> valSummativeUsability;
    connection : TestedByUsability connect uiElementOrTask ::> ueAlarmDisregard to usabilityTest ::> valSummativeUsability;
    connection : TestedByUsability connect uiElementOrTask ::> oaProgram to usabilityTest ::> valSummativeUsability;

    // ── Evidence production and document inclusion ──────────────
    connection : ProducesEvidence connect producer ::> vcLockout to producedEvidence ::> evidenceLockout;
    connection : ProducesEvidence connect producer ::> vcModeRange to producedEvidence ::> evidenceModeRange;
    connection : ProducesEvidence connect producer ::> vcSameStepAlarm to producedEvidence ::> evidenceSameStepAlarm;
    connection : ProducesEvidence connect producer ::> vcTemporalModeSafety to producedEvidence ::> evidenceTemporalModeSafety;
    connection : ProducesEvidence connect producer ::> vcAirInLine to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcOcclusion to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcEmptyReservoir to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcWatchdog to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcPost to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcPowerLoss to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcStuckButton to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcFlowCrossCheck to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcReverseDeliveryPause to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcVtbiCeiling to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcInfusionComplete to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcDoorInterlock to producedEvidence ::> evidenceSafetyAlarmSuite;
    connection : ProducesEvidence connect producer ::> vcAntiRefluxMechanism to producedEvidence ::> evidenceHardwareBench;
    connection : ProducesEvidence connect producer ::> vcAlarmLoudness to producedEvidence ::> evidenceHardwareBench;
    connection : ProducesEvidence connect producer ::> vcFreeFlow to producedEvidence ::> evidenceHardwareBench;
    connection : ProducesEvidence connect producer ::> vcHourlyMax to producedEvidence ::> evidenceDoseProgramming;
    connection : ProducesEvidence connect producer ::> vcDrugLibrary to producedEvidence ::> evidenceDoseProgramming;
    connection : ProducesEvidence connect producer ::> vcPrescriptionConfirm to producedEvidence ::> evidenceDoseProgramming;
    connection : ProducesEvidence connect producer ::> vcEventLog to producedEvidence ::> evidenceDoseProgramming;
    connection : ProducesEvidence connect producer ::> vcPumpAccuracy to producedEvidence ::> evidenceDeliveryAccuracy;
    connection : ProducesEvidence connect producer ::> valSummativeUsability to producedEvidence ::> evidenceUsability;
    connection : IncludedIn connect sourceElement ::> evidenceLockout to targetView ::> rmfView;
    connection : IncludedIn connect sourceElement ::> evidenceSafetyAlarmSuite to targetView ::> vvView;
    connection : IncludedIn connect sourceElement ::> evidenceUsability to targetView ::> usabilityView;
    connection : IncludedIn connect sourceElement ::> fmeaDelivery to targetView ::> hazardAnalysisView;
    connection : IncludedIn connect sourceElement ::> ftaOverdose to targetView ::> hazardAnalysisView;
}
