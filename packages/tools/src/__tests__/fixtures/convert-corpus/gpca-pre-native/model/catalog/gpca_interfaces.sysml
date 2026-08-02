package memo_examples_gpca_pump_model_catalog_gpca_interfaces {
    private import ScalarValues::*;

    private import memo_architecture_logical_interfaces::*;
    private import memo_architecture_realization_physical::*;
    private import memo_architecture_functional_functions::*;
    private import memo_core_common::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_architecture::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_behavior_subsystems::*;
    private import memo_core_enumerations::*;
    private import memo_core_dimensions::*;
    abstract interface def SensorDataInterface :> DataInterface {
        attribute :>> interfaceKind = InterfaceKind::data;
        attribute :>> protocolSemantics = "flow, air, occlusion, door, battery, cpu, memory, pump state";
    }
    port def SensorInputPort :> SensorPort {
        in item sensorData : MemoExchangeItem;
        attribute :>> interfaceType = "SensorDataInterface";
        attribute :>> sensorDomain = "physiological and device state";
    }
    interface sensorInputInterface : Interface {
        attribute :>> id = "LI-005";
        attribute :>> name = "SensorInputInterface";
        attribute :>> interfaceKind = InterfaceKind::data;
        attribute :>> direction = DirectionKind::input;
        attribute :>> interactionPattern = "sensor feed";
        attribute :>> protocolSemantics = "flow, air, occlusion, door, battery, cpu, memory, pump state";
    }
    interface actuatorCommandInterface : Interface {
        attribute :>> id = "LI-006";
        attribute :>> name = "ActuatorCommandInterface";
        attribute :>> interfaceKind = InterfaceKind::control;
        attribute :>> direction = DirectionKind::output;
        attribute :>> interactionPattern = "commanded flow and annunciation outputs";
        attribute :>> protocolSemantics = "pump flow command, buzzer tone select, display content";
    }
    interface operatorEntryInterface : Interface {
        attribute :>> id = "LI-007";
        attribute :>> name = "OperatorEntryInterface";
        attribute :>> interfaceKind = InterfaceKind::userInteraction;
        attribute :>> direction = DirectionKind::input;
        attribute :>> interactionPattern = "keypad entry with confirmation readback";
        attribute :>> protocolSemantics = "prescription fields, alarm silence, start/stop commands";
    }
    interface eventLogInterface : Interface {
        attribute :>> id = "LI-008";
        attribute :>> name = "EventLogInterface";
        attribute :>> interfaceKind = InterfaceKind::logging;
        attribute :>> direction = DirectionKind::output;
        attribute :>> interactionPattern = "append-only audit records";
        attribute :>> protocolSemantics = "timestamped therapy, alarm, and configuration events";
    }
    interface hwSoftwareBus : Interface {
        attribute :>> id = "PI-001";
        attribute :>> name = "HW_SW_DataBus";
        attribute :>> interfaceKind = InterfaceKind::digitalSignal;
        attribute :>> protocol = "immediate data port mapping";
        attribute :>> directionality = DirectionKind::inputOutput;
        attribute :>> bandwidth = "implementation-defined";
        attribute :>> timingConstraint = "same execution step where required";
        attribute :>> electricalStandard = "logical/AADL";
        attribute :>> nominalVoltageV = 3.3;
        attribute :>> nominalCurrentA = 0.02;
    }
    interface pumpMotorDrive : Interface {
        attribute :>> id = "PI-002";
        attribute :>> name = "PumpMotorStepDrive";
        attribute :>> interfaceKind = InterfaceKind::digitalSignal;
        attribute :>> protocol = "step/direction pulse train";
        attribute :>> directionality = DirectionKind::output;
        attribute :>> timingConstraint = "step rate proportional to commanded flow";
        attribute :>> electricalStandard = "3.3V CMOS";
        attribute :>> nominalVoltageV = 3.3;
        attribute :>> nominalCurrentA = 0.5;
        attribute :>> signaling = "step/dir with enable interlock";
    }
    interface bolusButtonLine : Interface {
        attribute :>> id = "PI-003";
        attribute :>> name = "BolusButtonInputLine";
        attribute :>> interfaceKind = InterfaceKind::digitalSignal;
        attribute :>> protocol = "debounced discrete input";
        attribute :>> directionality = DirectionKind::input;
        attribute :>> timingConstraint = "debounce 50 ms; stuck-high detection after 60 s";
        attribute :>> electricalStandard = "3.3V CMOS, normally open";
        attribute :>> nominalVoltageV = 3.3;
        attribute :>> nominalCurrentA = 0.001;
    }
    interface occlusionAnalogLine : Interface {
        attribute :>> id = "PI-004";
        attribute :>> name = "OcclusionPressureAnalogLine";
        attribute :>> interfaceKind = InterfaceKind::analogSignal;
        attribute :>> directionality = DirectionKind::input;
        attribute :>> electricalStandard = "ratiometric 0.5-4.5V";
        attribute :>> nominalVoltageV = 5.0;
        attribute :>> nominalCurrentA = 0.01;
        attribute :>> signalRange = "0 to 30 psi line pressure";
    }
    interface batteryMonitorLine : Interface {
        attribute :>> id = "PI-005";
        attribute :>> name = "BatteryVoltageMonitorLine";
        attribute :>> interfaceKind = InterfaceKind::power;
        attribute :>> directionality = DirectionKind::input;
        attribute :>> electricalStandard = "divided battery rail to ADC";
        attribute :>> nominalVoltageV = 12.0;
        attribute :>> nominalCurrentA = 0.001;
        attribute :>> signalRange = "9.0V (depleted) to 12.6V (full)";
    }

    // ── System-level interfaces (CriSys Ch.3, I 1-I 11) ─────────
    interface siDataEntry : Interface {
        attribute :>> id = "SI-001";
        attribute :>> name = "DataEntryInterface";
        attribute :>> interfaceKind = InterfaceKind::userInteraction;
        attribute :>> direction = DirectionKind::input;
        attribute :>> protocol = "CriSys I 1, I 2, I 3";
        attribute :>> protocolSemantics = "Prescription data entry (13 fields, PatientID_prog..NumberMax_pbolus_prog), control commands (9 mode-gated Boolean events), and drug reservoir data (ReservoirInitialVolume_prog)";
        attribute :>> interactionPattern = "clinician enter/edit/save with mode-gated commands";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1 Data Entry Interface";
    }
    interface siBolusRequest : Interface {
        attribute :>> id = "SI-002";
        attribute :>> name = "BolusRequestInterface";
        attribute :>> interfaceKind = InterfaceKind::userInteraction;
        attribute :>> direction = DirectionKind::input;
        attribute :>> protocol = "CriSys I 4";
        attribute :>> protocolSemantics = "BolusRequest_prog: patient request for a patient bolus; accepted only in ACTIVE mode";
        attribute :>> interactionPattern = "patient pendant button press";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.2 Bolus Request Interface";
    }
    interface siDrugFlow : Interface {
        attribute :>> id = "SI-003";
        attribute :>> name = "DrugFlowInterface";
        attribute :>> interfaceKind = InterfaceKind::fluidic;
        attribute :>> direction = DirectionKind::output;
        attribute :>> protocol = "CriSys I 5, I 6";
        attribute :>> protocolSemantics = "Physical drug delivery to the patient through the needle connected at the standard CCC connection point; represented by FlowRate_output (ml/hr)";
        attribute :>> interactionPattern = "continuous fluid path while infusing";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.3 Drug Flow Interface";
    }
    interface siNotification : Interface {
        attribute :>> id = "SI-004";
        attribute :>> name = "NotificationInterface";
        attribute :>> interfaceKind = InterfaceKind::notification;
        attribute :>> direction = DirectionKind::output;
        attribute :>> protocol = "CriSys I 7, I 8";
        attribute :>> protocolSemantics = "Visual display of all active notification messages plus audio output (50 dB for 2 seconds per notification), ON mode only";
        attribute :>> interactionPattern = "visual list with per-notification audio annunciation";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.4 Notification Interface";
    }
    interface siPharmacyDb : Interface {
        attribute :>> id = "SI-005";
        attribute :>> name = "HospitalPharmacyDatabaseInterface";
        attribute :>> interfaceKind = InterfaceKind::data;
        attribute :>> direction = DirectionKind::inputOutput;
        attribute :>> protocol = "CriSys I 9, I 10, I 11";
        attribute :>> protocolSemantics = "Retrieves the safe-value set (concentration, VTBI, flow rate, bolus interval/count, KVO rate) where DrugName_hd = DrugName_prog; resets to defaults when no record matches";
        attribute :>> interactionPattern = "query/response safe-value lookup";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }

    // ── CriSys Ch.3 data dictionary (prog / hd / output families) ─
    item ddPatientIDProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-005";
        attribute :>> name = "PatientID_prog";
        attribute :>> description = "Identifier of the patient in the hospital; provided in the prescription and programmed by the clinician.";
        attribute :>> semantics = "Cannot be empty; alphanumeric without space.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "String";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddDrugNameProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-006";
        attribute :>> name = "DrugName_prog";
        attribute :>> description = "Name of the drug prescribed for infusion.";
        attribute :>> semantics = "Cannot be empty; entered value must match DrugName_hd in the hospital pharmacy database.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "String";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddDrugConcentrationProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-007";
        attribute :>> name = "DrugConcentration_prog";
        attribute :>> description = "Concentration of the drug in the solution prescribed for infusion.";
        attribute :>> semantics = "Must be between DrugConcentration_lo_hd and DrugConcentration_hi_hd for DrugName_prog in the hospital database.";
        attribute :>> unit = "mg/ml";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddVTBITotalProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-008";
        attribute :>> name = "VTBI_total_prog";
        attribute :>> description = "Maximum total volume of the drug solution that can be infused for the prescription.";
        attribute :>> semantics = "Must be between VTBI_lo_hd and VTBI_hi_hd for DrugName_prog in the hospital database.";
        attribute :>> unit = "ml/hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddDurationTotalProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-009";
        attribute :>> name = "Duration_total_prog";
        attribute :>> description = "Prescribed total duration of drug infusion across all delivery modes (BASAL, SQUARE BOLUS, PATIENT BOLUS).";
        attribute :>> semantics = "Cannot be empty; should be >= 0.";
        attribute :>> unit = "minutes";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Time";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddFlowRateBasalProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-010";
        attribute :>> name = "FlowRate_basal_prog";
        attribute :>> description = "Prescribed rate of flow of drug during BASAL delivery mode; default FlowRate_lo_hd.";
        attribute :>> semantics = "Between FlowRate_lo_hd and FlowRate_hi_hd for DrugName_prog; should be < VTBI_total_prog / Duration_total_prog.";
        attribute :>> unit = "ml/hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddFlowRateSbolusProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-011";
        attribute :>> name = "FlowRate_sbolus_prog";
        attribute :>> description = "Prescribed flow rate of drug during SQUARE bolus delivery.";
        attribute :>> semantics = ">= 0; if Duration_sbolus_prog or Interval_sbolus_prog > 0, must be between FlowRate_lo_hd and FlowRate_hi_hd.";
        attribute :>> unit = "ml/hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddDurationSbolusProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-012";
        attribute :>> name = "Duration_sbolus_prog";
        attribute :>> description = "Maximum duration of a single uninterrupted square bolus delivery.";
        attribute :>> semantics = ">= 0; if FlowRate_sbolus_prog or Interval_sbolus_prog > 0, must be < Interval_sbolus_prog and Duration_total_prog.";
        attribute :>> unit = "minutes";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Time";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddIntervalSbolusProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-013";
        attribute :>> name = "Interval_sbolus_prog";
        attribute :>> description = "Minimum interval between two consecutive square bolus initiations; the first square bolus starts Interval_sbolus_prog minutes after infusion initiation.";
        attribute :>> semantics = ">= 0; if FlowRate_sbolus_prog or Duration_sbolus_prog > 0, must be > Duration_sbolus_prog.";
        attribute :>> unit = "minutes";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddFlowRatePbolusProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-014";
        attribute :>> name = "FlowRate_pbolus_prog";
        attribute :>> description = "Prescribed flow rate of drug during patient bolus delivery.";
        attribute :>> semantics = ">= 0; if Duration_pbolus_prog or LockOutPeriod_pbolus_prog > 0, must be between FlowRate_lo_hd and FlowRate_hi_hd.";
        attribute :>> unit = "ml/hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddDurationPbolusProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-015";
        attribute :>> name = "Duration_pbolus_prog";
        attribute :>> description = "Maximum duration of a single uninterrupted patient bolus delivery.";
        attribute :>> semantics = ">= 0; if FlowRate_pbolus_prog or LockOutPeriod_pbolus_prog > 0, must be < LockOutPeriod_pbolus_prog and Duration_total_prog.";
        attribute :>> unit = "minutes";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Time";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddLockOutPeriodPbolusProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-016";
        attribute :>> name = "LockOutPeriod_pbolus_prog";
        attribute :>> description = "Minimum interval between two consecutive patient bolus initiations (the lockout period), irrespective of interruption or completion.";
        attribute :>> semantics = ">= 0; if FlowRate_pbolus_prog or Duration_pbolus_prog > 0, must be > Duration_pbolus_prog.";
        attribute :>> unit = "minutes";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddNumberMaxPbolusProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-017";
        attribute :>> name = "NumberMax_pbolus_prog";
        attribute :>> description = "Maximum total number of patient boluses that may be initiated during Duration_total_prog.";
        attribute :>> semantics = ">= 0; must be <= NumberMax_pbolus_hd for DrugName_prog in the hospital database.";
        attribute :>> unit = "per hour";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddSystemStartProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-018";
        attribute :>> name = "System_start_prog";
        attribute :>> description = "Command to start the system.";
        attribute :>> semantics = "Can be commanded only if the system is in OFF mode.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "Boolean event";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.2 Commands";
    }
    item ddSystemStopProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-019";
        attribute :>> name = "System_stop_prog";
        attribute :>> description = "Command to stop the system.";
        attribute :>> semantics = "Can be commanded only if the system is in ON mode.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "Boolean event";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.2 Commands";
    }
    item ddInfusionInitiateProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-020";
        attribute :>> name = "Infusion_initiate_prog";
        attribute :>> description = "Command to initiate infusion of drug.";
        attribute :>> semantics = "Can be commanded only if the system is in ON mode.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "Boolean event";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.2 Commands";
    }
    item ddInfusionInhibitProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-021";
        attribute :>> name = "Infusion_inhibit_prog";
        attribute :>> description = "Command to inhibit infusion of drug.";
        attribute :>> semantics = "Can be commanded only if the system is in ON mode.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "Boolean event";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.2 Commands";
    }
    item ddSystemSaveProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-022";
        attribute :>> name = "System_save_prog";
        attribute :>> description = "Command to save the prescription and reservoir initial volume data.";
        attribute :>> semantics = "Can be commanded only if the system is in ON mode.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "Boolean event";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.2 Commands";
    }
    item ddNotificationCancelProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-023";
        attribute :>> name = "Notification_cancel_prog";
        attribute :>> description = "Command to cancel a selected notification.";
        attribute :>> semantics = "Can be commanded only in ON mode and if a notification is selected.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "Boolean event";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.2 Commands";
    }
    item ddDisableAudioProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-024";
        attribute :>> name = "Disable_audio_prog";
        attribute :>> description = "Command to disable audio notifications, permanently or temporarily.";
        attribute :>> semantics = "Default FALSE.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "PERM | TEMP | FALSE";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.2 Commands";
    }
    item ddEnableAudioProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-025";
        attribute :>> name = "Enable_audio_prog";
        attribute :>> description = "Command to enable audio notifications.";
        attribute :>> semantics = "Can be commanded only if audio is disabled.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "Boolean event";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.2 Commands";
    }
    item ddDataConfigProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-026";
        attribute :>> name = "DataConfig_prog";
        attribute :>> description = "Command to configure prescription data (printed as 'DataCofig_prog' in the source).";
        attribute :>> semantics = "Can be commanded only if the system is in ON mode.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "Boolean event";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.2 Commands";
    }
    item ddReservoirInitialVolumeProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-027";
        attribute :>> name = "ReservoirInitialVolume_prog";
        attribute :>> description = "Initial volume of drug in the reservoir at the time of entering the prescription; read from the reservoir label.";
        attribute :>> semantics = "Mandatory; shall be >= X ml (threshold left unspecified in the source draft).";
        attribute :>> unit = "ml";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.3 Drug Reservoir Data";
    }
    item ddBolusRequestProg : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-028";
        attribute :>> name = "BolusRequest_prog";
        attribute :>> description = "Request by the patient to deliver a patient bolus.";
        attribute :>> semantics = "Can be commanded only if the system is in ACTIVE mode.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "Boolean event";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.2 Bolus Request Interface";
    }
    item ddFlowRateOutput : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-029";
        attribute :>> name = "FlowRate_output";
        attribute :>> description = "Flow rate of the drug through the hose delivering the drug, measured every X seconds when the system is in ON mode.";
        attribute :>> semantics = "None stated.";
        attribute :>> unit = "ml/hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.3 Drug Flow Interface";
    }
    item ddNotificationVisualOutput : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-030";
        attribute :>> name = "Notification_Visual_output";
        attribute :>> description = "Visual display of the messages of all active notifications in the system.";
        attribute :>> semantics = "Messages displayed only when the system is in ON mode.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "List of String";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.4 Notification Interface";
    }
    item ddNotificationAudioOutput : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-031";
        attribute :>> name = "Notification_Audio_output";
        attribute :>> description = "Audio output for each active notification, in the same order as Notification_Visual_output.";
        attribute :>> semantics = "Audio output possible only when the system is in ON mode.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "List of Boolean";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.4 Notification Interface";
    }
    item ddDrugNameHd : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-032";
        attribute :>> name = "DrugName_hd";
        attribute :>> description = "Name of a drug usable for infusion in the hospital that matches DrugName_prog.";
        attribute :>> semantics = "None stated.";
        attribute :>> unit = "NA";
        attribute :>> encoding = "String";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }
    item ddDrugConcentrationHiHd : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-033";
        attribute :>> name = "DrugConcentration_hi_hd";
        attribute :>> description = "Maximum concentration of the drug in a solution that can safely be used for infusion for DrugName_hd.";
        attribute :>> semantics = "None stated.";
        attribute :>> unit = "mg/ml";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }
    item ddDrugConcentrationLoHd : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-034";
        attribute :>> name = "DrugConcentration_lo_hd";
        attribute :>> description = "Minimum concentration of the drug in a solution that can safely be used for infusion for DrugName_hd.";
        attribute :>> semantics = "None stated.";
        attribute :>> unit = "mg/ml";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }
    item ddVTBIHiHd : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-035";
        attribute :>> name = "VTBI_hi_hd";
        attribute :>> description = "Maximum volume of drug that is safe to be infused for DrugName_hd.";
        attribute :>> semantics = "None stated.";
        attribute :>> unit = "ml/hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }
    item ddVTBILoHd : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-036";
        attribute :>> name = "VTBI_lo_hd";
        attribute :>> description = "Minimum volume of drug that is safe to be infused for DrugName_hd.";
        attribute :>> semantics = "Mandatory.";
        attribute :>> unit = "ml/hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }
    item ddFlowRateHiHd : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-037";
        attribute :>> name = "FlowRate_hi_hd";
        attribute :>> description = "Maximum safe flow rate of the drug for DrugName_hd.";
        attribute :>> semantics = "Mandatory.";
        attribute :>> unit = "ml/hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }
    item ddFlowRateLoHd : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-038";
        attribute :>> name = "FlowRate_lo_hd";
        attribute :>> description = "Minimum safe flow rate of the drug for DrugName_hd.";
        attribute :>> semantics = "Mandatory.";
        attribute :>> unit = "ml/hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }
    item ddIntervalPbolusHd : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-039";
        attribute :>> name = "Interval_pbolus_hd";
        attribute :>> description = "Minimum safe interval between two consecutive patient bolus initiations for DrugName_hd.";
        attribute :>> semantics = "Mandatory.";
        attribute :>> unit = "minutes";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }
    item ddNumberMaxPbolusHd : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-040";
        attribute :>> name = "NumberMax_pbolus_hd";
        attribute :>> description = "Maximum number of patient bolus initiations safe to be self-administered for DrugName_hd.";
        attribute :>> semantics = "Mandatory.";
        attribute :>> unit = "per hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "999";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }
    item ddFlowRateKvoHd : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-041";
        attribute :>> name = "FlowRate_kvo_hd";
        attribute :>> description = "Minimum flow rate of DrugName_hd that should be maintained to keep the vein open (KVO); default 0.1.";
        attribute :>> semantics = "Mandatory.";
        attribute :>> unit = "ml/hr";
        attribute :>> minValue = "0";
        attribute :>> maxValue = "5";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.5 Hospital Pharmacy Database Interface";
    }

    // ── MEMO functional-to-physical allocation abstractions ────
    // These four exchanges summarize requirements-derived physical design
    // intent. They are not the named port connections in GPCA_Device.aadl;
    // the exact AADL feature topology is authored below and in gpca_trace.
    part exSensorVector : ComponentExchange {
        attribute :>> id = "CE-001";
        attribute :>> name = "SensorStatusVectorExchange";
        attribute :>> exchangeKind = FlowKind::measurement;
        ref :>> sourceEndpoint = gpcaDeviceSensors;
        attribute :>> sourcePortPath = "HW-001: GPCA_HW_Sensors";
        ref :>> targetEndpoint = portSensorIn;
        attribute :>> targetPortPath = "GPCA_SW.SENSOR_IN (PORT-04)";
        ref :>> allocatedExchanges = lfSensorAcquisition;
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "MEMO design extension allocated from LF-001; not a GPCA_Device.aadl connection";
    }
    part exFlowCommand : ComponentExchange {
        attribute :>> id = "CE-002";
        attribute :>> name = "FlowCommandExchange";
        attribute :>> exchangeKind = FlowKind::command;
        ref :>> sourceEndpoint = portGpcaSwOut;
        attribute :>> sourcePortPath = "GPCA_SW.GPCA_SW_OUT (Commanded_Flow_Rate)";
        ref :>> targetEndpoint = pumpMotorAssembly;
        attribute :>> targetPortPath = "HW-003: PumpMotorAssembly";
        ref :>> allocatedExchanges = lfFlowCommand;
        attribute :>> direction = DirectionKind::output;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "MEMO design extension allocated from LF-002; not a GPCA_Device.aadl connection";
    }
    part exAlarmAnnunciation : ComponentExchange {
        attribute :>> id = "CE-003";
        attribute :>> name = "AlarmAnnunciationExchange";
        attribute :>> exchangeKind = FlowKind::alarm;
        ref :>> sourceEndpoint = portGpcaSwOut;
        attribute :>> sourcePortPath = "GPCA_SW.GPCA_SW_OUT (Notification_Message, Is_Audio_Disabled)";
        ref :>> targetEndpoint = audibleAlarm;
        attribute :>> targetPortPath = "HW-004: AudibleAlarmAnnunciator / HW-005: OperatorDisplay";
        ref :>> allocatedExchanges = lfAlarmSignal;
        attribute :>> direction = DirectionKind::output;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "MEMO design extension allocated from LF-003; not a GPCA_Device.aadl connection";
    }
    part exPrescriptionEntry : ComponentExchange {
        attribute :>> id = "CE-004";
        attribute :>> name = "PrescriptionEntryExchange";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = operatorKeypad;
        attribute :>> sourcePortPath = "HW-012: OperatorKeypad";
        ref :>> targetEndpoint = portPresIn;
        attribute :>> targetPortPath = "GPCA_SW.PRES_IN / GPCA_SW.OP_CMD_IN (PORT-02, PORT-01)";
        ref :>> allocatedExchanges = lfPrescriptionEntry;
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "MEMO design extension allocated from LF-004; not a GPCA_Device.aadl connection";
    }

    // ── GPCA_Device and hardware-subsystem ports (AADL, 1:1) ───
    // The published AADL hardware packages are interface wrappers: they do
    // not decompose into the individual physical parts modelled elsewhere in
    // this MEMO example. These features and their connections are therefore
    // kept exact and separate from that extended physical design content.
    part devOpCmdIn : PhysicalPort { attribute :>> id = "PORT-DEV-01"; attribute :>> name = "OP_CMD_IN"; attribute :>> direction = DirectionKind::input; attribute :>> sourceReference = "CITE-002: GPCA_Device.aadl"; }
    part devDbIn : PhysicalPort { attribute :>> id = "PORT-DEV-02"; attribute :>> name = "DB_IN"; attribute :>> direction = DirectionKind::input; attribute :>> sourceReference = "CITE-002: GPCA_Device.aadl"; }
    part devPresIn : PhysicalPort { attribute :>> id = "PORT-DEV-03"; attribute :>> name = "PRES_IN"; attribute :>> direction = DirectionKind::input; attribute :>> sourceReference = "CITE-002: GPCA_Device.aadl"; }
    part devPatientIn : PhysicalPort { attribute :>> id = "PORT-DEV-04"; attribute :>> name = "PATIENT_IN"; attribute :>> direction = DirectionKind::input; attribute :>> sourceReference = "CITE-002: GPCA_Device.aadl"; }
    part devGpcaOut : PhysicalPort { attribute :>> id = "PORT-DEV-05"; attribute :>> name = "GPCA_OUT"; attribute :>> direction = DirectionKind::output; attribute :>> sourceReference = "CITE-002: GPCA_Device.aadl"; }

    part snsOpCmdIn : PhysicalPort { attribute :>> id = "PORT-SNS-01"; attribute :>> name = "OP_CMD_IN"; attribute :>> direction = DirectionKind::input; attribute :>> sourceReference = "CITE-002: GPCA_HW_Sensors.aadl"; }
    part snsDbIn : PhysicalPort { attribute :>> id = "PORT-SNS-02"; attribute :>> name = "DB_IN"; attribute :>> direction = DirectionKind::input; attribute :>> sourceReference = "CITE-002: GPCA_HW_Sensors.aadl"; }
    part snsPresIn : PhysicalPort { attribute :>> id = "PORT-SNS-03"; attribute :>> name = "PRES_IN"; attribute :>> direction = DirectionKind::input; attribute :>> sourceReference = "CITE-002: GPCA_HW_Sensors.aadl"; }
    part snsPatientIn : PhysicalPort { attribute :>> id = "PORT-SNS-04"; attribute :>> name = "PATIENT_IN"; attribute :>> direction = DirectionKind::input; attribute :>> sourceReference = "CITE-002: GPCA_HW_Sensors.aadl"; }
    part snsOpCmdOut : PhysicalPort { attribute :>> id = "PORT-SNS-05"; attribute :>> name = "OP_CMD_OUT"; attribute :>> direction = DirectionKind::output; attribute :>> sourceReference = "CITE-002: GPCA_HW_Sensors.aadl"; }
    part snsPresOut : PhysicalPort { attribute :>> id = "PORT-SNS-06"; attribute :>> name = "PRES_OUT"; attribute :>> direction = DirectionKind::output; attribute :>> sourceReference = "CITE-002: GPCA_HW_Sensors.aadl"; }
    part snsPatientOut : PhysicalPort { attribute :>> id = "PORT-SNS-07"; attribute :>> name = "PATIENT_OUT"; attribute :>> direction = DirectionKind::output; attribute :>> sourceReference = "CITE-002: GPCA_HW_Sensors.aadl"; }
    part snsSensorOut : PhysicalPort { attribute :>> id = "PORT-SNS-08"; attribute :>> name = "SENSOR_OUT"; attribute :>> direction = DirectionKind::output; attribute :>> sourceReference = "CITE-002: GPCA_HW_Sensors.aadl"; }
    part snsConstOut : PhysicalPort { attribute :>> id = "PORT-SNS-09"; attribute :>> name = "CONST_OUT"; attribute :>> direction = DirectionKind::output; attribute :>> sourceReference = "CITE-002: GPCA_HW_Sensors.aadl"; }
    part snsDbOut : PhysicalPort { attribute :>> id = "PORT-SNS-10"; attribute :>> name = "DB_OUT"; attribute :>> direction = DirectionKind::output; attribute :>> sourceReference = "CITE-002: GPCA_HW_Sensors.aadl"; }

    part actGpcaSwIn : PhysicalPort { attribute :>> id = "PORT-ACT-01"; attribute :>> name = "GPCA_SW_IN"; attribute :>> direction = DirectionKind::input; attribute :>> sourceReference = "CITE-002: GPCA_HW_Actuators.aadl"; }
    part actGpcaOut : PhysicalPort { attribute :>> id = "PORT-ACT-02"; attribute :>> name = "GPCA_OUT"; attribute :>> direction = DirectionKind::output; attribute :>> sourceReference = "CITE-002: GPCA_HW_Actuators.aadl"; }

    // ── GPCA_SW top-level ports (AADL GPCA_SW.aadl features) ────
    part portOpCmdIn : SoftwarePort {
        attribute :>> id = "PORT-01"; attribute :>> name = "OP_CMD_IN";
        attribute :>> description = "Operator commands (System_Start/Stop, Infusion_Initiate/Inhibit, Notification_Cancel, Disable/Enable_Audio, DataConfig) from the data entry interface (I 2).";
        attribute :>> portKind = InterfaceKind::control;
        attribute :>> direction = DirectionKind::input;
        attribute :>> dataTypeName = "DATATYPES::Operator_Commands.Impl";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part portPresIn : SoftwarePort {
        attribute :>> id = "PORT-02"; attribute :>> name = "PRES_IN";
        attribute :>> description = "Prescription data entry fields (I 1, 13 fields PatientID_prog..NumberMax_pbolus_prog).";
        attribute :>> portKind = InterfaceKind::data;
        attribute :>> direction = DirectionKind::input;
        attribute :>> dataTypeName = "DATATYPES::Prescription_Inputs.Impl";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part portPatientIn : SoftwarePort {
        attribute :>> id = "PORT-03"; attribute :>> name = "PATIENT_IN";
        attribute :>> description = "Patient bolus request (I 4, BolusRequest_prog).";
        attribute :>> portKind = InterfaceKind::userInteraction;
        attribute :>> direction = DirectionKind::input;
        attribute :>> dataTypeName = "DATATYPES::Patient_Inputs.Impl";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part portSensorIn : SoftwarePort {
        attribute :>> id = "PORT-04"; attribute :>> name = "SENSOR_IN";
        attribute :>> description = "Device sensor inputs (air-in-line, occlusion, door, reservoir, flow).";
        attribute :>> portKind = InterfaceKind::digitalSignal;
        attribute :>> direction = DirectionKind::input;
        attribute :>> dataTypeName = "DATATYPES::Device_Sensor_Inputs.Impl";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part portConstIn : SoftwarePort {
        attribute :>> id = "PORT-05"; attribute :>> name = "CONST_IN";
        attribute :>> description = "Device configuration constants (App. A.4 values such as Empty_Reservoir, tolerances).";
        attribute :>> portKind = InterfaceKind::data;
        attribute :>> direction = DirectionKind::input;
        attribute :>> dataTypeName = "DATATYPES::Device_Configuration_Inputs.Impl";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part portDbIn : SoftwarePort {
        attribute :>> id = "PORT-06"; attribute :>> name = "DB_IN";
        attribute :>> description = "Hospital pharmacy database safe values (I 9-I 11); realizes SI-005 HospitalPharmacyDatabaseInterface.";
        attribute :>> portKind = InterfaceKind::data;
        attribute :>> direction = DirectionKind::input;
        attribute :>> dataTypeName = "DATATYPES::Drug_Database_Inputs.Impl";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part portGpcaSwOut : SoftwarePort {
        attribute :>> id = "PORT-07"; attribute :>> name = "GPCA_SW_OUT";
        attribute :>> description = "Aggregated software output vector (Current_System_Mode, Commanded_Flow_Rate, notifications, prescription echo, status).";
        attribute :>> portKind = InterfaceKind::data;
        attribute :>> direction = DirectionKind::output;
        attribute :>> dataTypeName = "DATATYPES::GPCA_SW_Outputs.Impl";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }

    // ── GPCA_SW.Impl inter-component connections (AADL, 1:1) ────
    // ALARM_to_IM immediate is the same-step alarm-response
    // mechanism the formal properties rely on.
    part ceOpCmdToTlm : ComponentExchange {
        attribute :>> id = "CE-101"; attribute :>> name = "OP_CMDtoTLM";
        attribute :>> exchangeKind = FlowKind::command;
        ref :>> sourceEndpoint = portOpCmdIn;
        attribute :>> sourcePortPath = "OP_CMD_IN";
        ref :>> targetEndpoint = tlm;
        attribute :>> targetPortPath = "TLM.OP_CMD_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceConstToTlm : ComponentExchange {
        attribute :>> id = "CE-102"; attribute :>> name = "CONSTtoTLM";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = portConstIn;
        attribute :>> sourcePortPath = "CONST_IN";
        ref :>> targetEndpoint = tlm;
        attribute :>> targetPortPath = "TLM.CONST_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceTlmOutToOutput : ComponentExchange {
        attribute :>> id = "CE-103"; attribute :>> name = "TLM_OUT_toOUTPUT";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = tlm;
        attribute :>> sourcePortPath = "TLM.TLM_MODE_OUT";
        ref :>> targetEndpoint = outputBus;
        attribute :>> targetPortPath = "OUTPUT.TLM_MODE_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceImToSysStat : ComponentExchange {
        attribute :>> id = "CE-104"; attribute :>> name = "IM_to_SYS_STAT";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = infusionMgr;
        attribute :>> sourcePortPath = "IM.IM_OUT";
        ref :>> targetEndpoint = systemStatus;
        attribute :>> targetPortPath = "SYS_STAT.IM_IN";
        attribute :>> timingSemantics = "sampled (no timing property in source; AADL default breaks the feedback cycle)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceTlmToSysStat : ComponentExchange {
        attribute :>> id = "CE-105"; attribute :>> name = "TLM_to_SYS_STAT";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = tlm;
        attribute :>> sourcePortPath = "TLM.TLM_MODE_OUT";
        ref :>> targetEndpoint = systemStatus;
        attribute :>> targetPortPath = "SYS_STAT.TLM_MODE_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceSensorToSysStat : ComponentExchange {
        attribute :>> id = "CE-106"; attribute :>> name = "SENSOR_to_SYS_STAT";
        attribute :>> exchangeKind = FlowKind::measurement;
        ref :>> sourceEndpoint = portSensorIn;
        attribute :>> sourcePortPath = "SENSOR_IN";
        ref :>> targetEndpoint = systemStatus;
        attribute :>> targetPortPath = "SYS_STAT.SENSOR_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceConstToSysStat : ComponentExchange {
        attribute :>> id = "CE-107"; attribute :>> name = "CONST_to_SYS_STAT";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = portConstIn;
        attribute :>> sourcePortPath = "CONST_IN";
        ref :>> targetEndpoint = systemStatus;
        attribute :>> targetPortPath = "SYS_STAT.CONST_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceConfigToSysStat : ComponentExchange {
        attribute :>> id = "CE-108"; attribute :>> name = "CONFIG_to_SYS_STAT";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = config;
        attribute :>> sourcePortPath = "CONFIG.CONFIG_OUT";
        ref :>> targetEndpoint = systemStatus;
        attribute :>> targetPortPath = "SYS_STAT.CONFIG_IN";
        attribute :>> timingSemantics = "sampled (no timing property in source; AADL default breaks the feedback cycle)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceSysStatOutToOutput : ComponentExchange {
        attribute :>> id = "CE-109"; attribute :>> name = "SYS_STAT_OUT_toOUTPUT";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = systemStatus;
        attribute :>> sourcePortPath = "SYS_STAT.SYS_STAT_OUT";
        ref :>> targetEndpoint = outputBus;
        attribute :>> targetPortPath = "OUTPUT.SYS_STAT_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceImToAlarm : ComponentExchange {
        attribute :>> id = "CE-110"; attribute :>> name = "IM_to_ALARM";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = infusionMgr;
        attribute :>> sourcePortPath = "IM.IM_OUT";
        ref :>> targetEndpoint = alarm;
        attribute :>> targetPortPath = "ALARM.IM_IN";
        attribute :>> timingSemantics = "sampled (no timing property in source; AADL default breaks the feedback cycle)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceTlmToAlarm : ComponentExchange {
        attribute :>> id = "CE-111"; attribute :>> name = "TLM_to_ALARM";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = tlm;
        attribute :>> sourcePortPath = "TLM.TLM_MODE_OUT";
        ref :>> targetEndpoint = alarm;
        attribute :>> targetPortPath = "ALARM.TLM_MODE_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceSysMonToAlarm : ComponentExchange {
        attribute :>> id = "CE-112"; attribute :>> name = "SYS_MON_to_ALARM";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = systemMonitor;
        attribute :>> sourcePortPath = "SYS_MON.SYS_MON_OUT";
        ref :>> targetEndpoint = alarm;
        attribute :>> targetPortPath = "ALARM.SYS_MON_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceOpCmdToAlarm : ComponentExchange {
        attribute :>> id = "CE-113"; attribute :>> name = "OP_CMD_to_ALARM";
        attribute :>> exchangeKind = FlowKind::command;
        ref :>> sourceEndpoint = portOpCmdIn;
        attribute :>> sourcePortPath = "OP_CMD_IN";
        ref :>> targetEndpoint = alarm;
        attribute :>> targetPortPath = "ALARM.OP_CMD_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceDbToAlarm : ComponentExchange {
        attribute :>> id = "CE-114"; attribute :>> name = "DB_to_ALARM";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = portDbIn;
        attribute :>> sourcePortPath = "DB_IN";
        ref :>> targetEndpoint = alarm;
        attribute :>> targetPortPath = "ALARM.DB_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceSensorToAlarm : ComponentExchange {
        attribute :>> id = "CE-115"; attribute :>> name = "SENSOR_to_ALARM";
        attribute :>> exchangeKind = FlowKind::measurement;
        ref :>> sourceEndpoint = portSensorIn;
        attribute :>> sourcePortPath = "SENSOR_IN";
        ref :>> targetEndpoint = alarm;
        attribute :>> targetPortPath = "ALARM.SENSOR_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceConstToAlarm : ComponentExchange {
        attribute :>> id = "CE-116"; attribute :>> name = "CONST_to_ALARM";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = portConstIn;
        attribute :>> sourcePortPath = "CONST_IN";
        ref :>> targetEndpoint = alarm;
        attribute :>> targetPortPath = "ALARM.CONST_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceSysStatToAlarm : ComponentExchange {
        attribute :>> id = "CE-117"; attribute :>> name = "SYS_STAT_to_ALARM";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = systemStatus;
        attribute :>> sourcePortPath = "SYS_STAT.SYS_STAT_OUT";
        ref :>> targetEndpoint = alarm;
        attribute :>> targetPortPath = "ALARM.SYS_STAT_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceConfigToAlarm : ComponentExchange {
        attribute :>> id = "CE-118"; attribute :>> name = "CONFIG_to_ALARM";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = config;
        attribute :>> sourcePortPath = "CONFIG.CONFIG_OUT";
        ref :>> targetEndpoint = alarm;
        attribute :>> targetPortPath = "ALARM.CONFIG_IN";
        attribute :>> timingSemantics = "sampled (no timing property in source; AADL default breaks the feedback cycle)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceAlarmOutToOutput : ComponentExchange {
        attribute :>> id = "CE-119"; attribute :>> name = "ALARM_OUT_toOUTPUT";
        attribute :>> exchangeKind = FlowKind::alarm;
        ref :>> sourceEndpoint = alarm;
        attribute :>> sourcePortPath = "ALARM.ALARM_OUT";
        ref :>> targetEndpoint = outputBus;
        attribute :>> targetPortPath = "OUTPUT.ALARM_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceTlmToConfig : ComponentExchange {
        attribute :>> id = "CE-120"; attribute :>> name = "TLM_to_CONFIG";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = tlm;
        attribute :>> sourcePortPath = "TLM.TLM_MODE_OUT";
        ref :>> targetEndpoint = config;
        attribute :>> targetPortPath = "CONFIG.TLM_MODE_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part cePresToConfig : ComponentExchange {
        attribute :>> id = "CE-121"; attribute :>> name = "PRES_to_CONFIG";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = portPresIn;
        attribute :>> sourcePortPath = "PRES_IN";
        ref :>> targetEndpoint = config;
        attribute :>> targetPortPath = "CONFIG.PRES_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceOpCmdToConfig : ComponentExchange {
        attribute :>> id = "CE-122"; attribute :>> name = "OP_CMD_to_CONFIG";
        attribute :>> exchangeKind = FlowKind::command;
        ref :>> sourceEndpoint = portOpCmdIn;
        attribute :>> sourcePortPath = "OP_CMD_IN";
        ref :>> targetEndpoint = config;
        attribute :>> targetPortPath = "CONFIG.OP_CMD_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceDbToConfig : ComponentExchange {
        attribute :>> id = "CE-123"; attribute :>> name = "DB_to_CONFIG";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = portDbIn;
        attribute :>> sourcePortPath = "DB_IN";
        ref :>> targetEndpoint = config;
        attribute :>> targetPortPath = "CONFIG.DB_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceConsToConfig : ComponentExchange {
        attribute :>> id = "CE-124"; attribute :>> name = "CONS_to_CONFIG";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = portConstIn;
        attribute :>> sourcePortPath = "CONST_IN";
        ref :>> targetEndpoint = config;
        attribute :>> targetPortPath = "CONFIG.CONST_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceSysStatToConfig : ComponentExchange {
        attribute :>> id = "CE-125"; attribute :>> name = "SYS_STAT_to_CONFIG";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = systemStatus;
        attribute :>> sourcePortPath = "SYS_STAT.SYS_STAT_OUT";
        ref :>> targetEndpoint = config;
        attribute :>> targetPortPath = "CONFIG.SYS_STAT_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceConfigToOutput : ComponentExchange {
        attribute :>> id = "CE-126"; attribute :>> name = "CONFIG_toOUTPUT";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = config;
        attribute :>> sourcePortPath = "CONFIG.CONFIG_OUT";
        ref :>> targetEndpoint = outputBus;
        attribute :>> targetPortPath = "OUTPUT.CONFIG_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceTlmToIm : ComponentExchange {
        attribute :>> id = "CE-127"; attribute :>> name = "TLM_to_IM";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = tlm;
        attribute :>> sourcePortPath = "TLM.TLM_MODE_OUT";
        ref :>> targetEndpoint = infusionMgr;
        attribute :>> targetPortPath = "IM.TLM_MODE_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceOpCmdToIm : ComponentExchange {
        attribute :>> id = "CE-128"; attribute :>> name = "OP_CMD_to_IM";
        attribute :>> exchangeKind = FlowKind::command;
        ref :>> sourceEndpoint = portOpCmdIn;
        attribute :>> sourcePortPath = "OP_CMD_IN";
        ref :>> targetEndpoint = infusionMgr;
        attribute :>> targetPortPath = "IM.OP_CMD_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part cePatientToIm : ComponentExchange {
        attribute :>> id = "CE-129"; attribute :>> name = "PATIENT_to_IM";
        attribute :>> exchangeKind = FlowKind::command;
        ref :>> sourceEndpoint = portPatientIn;
        attribute :>> sourcePortPath = "PATIENT_IN";
        ref :>> targetEndpoint = infusionMgr;
        attribute :>> targetPortPath = "IM.PATIENT_IN";
        attribute :>> direction = DirectionKind::input;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceConfigToIm : ComponentExchange {
        attribute :>> id = "CE-130"; attribute :>> name = "CONFIG_to_IM";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = config;
        attribute :>> sourcePortPath = "CONFIG.CONFIG_OUT";
        ref :>> targetEndpoint = infusionMgr;
        attribute :>> targetPortPath = "IM.CONFIG_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceAlarmToIm : ComponentExchange {
        attribute :>> id = "CE-131"; attribute :>> name = "ALARM_to_IM";
        attribute :>> exchangeKind = FlowKind::alarm;
        ref :>> sourceEndpoint = alarm;
        attribute :>> sourcePortPath = "ALARM.ALARM_OUT";
        ref :>> targetEndpoint = infusionMgr;
        attribute :>> targetPortPath = "IM.ALARM_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceSysStatToIm : ComponentExchange {
        attribute :>> id = "CE-132"; attribute :>> name = "SYS_STAT_to_IM";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = systemStatus;
        attribute :>> sourcePortPath = "SYS_STAT.SYS_STAT_OUT";
        ref :>> targetEndpoint = infusionMgr;
        attribute :>> targetPortPath = "IM.SYS_STAT_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceImToOutput : ComponentExchange {
        attribute :>> id = "CE-133"; attribute :>> name = "IM_toOUTPUT";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = infusionMgr;
        attribute :>> sourcePortPath = "IM.IM_OUT";
        ref :>> targetEndpoint = outputBus;
        attribute :>> targetPortPath = "OUTPUT.IM_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceTlmToSysMon : ComponentExchange {
        attribute :>> id = "CE-134"; attribute :>> name = "TLM_to_SYS_MON";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = tlm;
        attribute :>> sourcePortPath = "TLM.TLM_MODE_OUT";
        ref :>> targetEndpoint = systemMonitor;
        attribute :>> targetPortPath = "SYS_MON.TLM_MODE_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceSysMonToOutput : ComponentExchange {
        attribute :>> id = "CE-135"; attribute :>> name = "SYS_MON_toOUTPUT";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = systemMonitor;
        attribute :>> sourcePortPath = "SYS_MON.SYS_MON_OUT";
        ref :>> targetEndpoint = outputBus;
        attribute :>> targetPortPath = "OUTPUT.SYS_MON_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceTlmToLog : ComponentExchange {
        attribute :>> id = "CE-136"; attribute :>> name = "TLM_to_LOG";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = tlm;
        attribute :>> sourcePortPath = "TLM.TLM_MODE_OUT";
        ref :>> targetEndpoint = logging;
        attribute :>> targetPortPath = "LOG.TLM_MODE_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceConfigToLog : ComponentExchange {
        attribute :>> id = "CE-137"; attribute :>> name = "CONFIG_to_LOG";
        attribute :>> exchangeKind = FlowKind::configuration;
        ref :>> sourceEndpoint = config;
        attribute :>> sourcePortPath = "CONFIG.CONFIG_OUT";
        ref :>> targetEndpoint = logging;
        attribute :>> targetPortPath = "LOG.CONFIG_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceAlarmToLog : ComponentExchange {
        attribute :>> id = "CE-138"; attribute :>> name = "ALARM_to_LOG";
        attribute :>> exchangeKind = FlowKind::alarm;
        ref :>> sourceEndpoint = alarm;
        attribute :>> sourcePortPath = "ALARM.ALARM_OUT";
        ref :>> targetEndpoint = logging;
        attribute :>> targetPortPath = "LOG.ALARM_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceSysStatToLog : ComponentExchange {
        attribute :>> id = "CE-139"; attribute :>> name = "SYS_STAT_to_LOG";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = systemStatus;
        attribute :>> sourcePortPath = "SYS_STAT.SYS_STAT_OUT";
        ref :>> targetEndpoint = logging;
        attribute :>> targetPortPath = "LOG.SYS_STAT_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceImToLog : ComponentExchange {
        attribute :>> id = "CE-140"; attribute :>> name = "IM_to_LOG";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = infusionMgr;
        attribute :>> sourcePortPath = "IM.IM_OUT";
        ref :>> targetEndpoint = logging;
        attribute :>> targetPortPath = "LOG.IM_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceLogToOutput : ComponentExchange {
        attribute :>> id = "CE-141"; attribute :>> name = "LOG_toOUTPUT";
        attribute :>> exchangeKind = FlowKind::audit;
        ref :>> sourceEndpoint = logging;
        attribute :>> sourcePortPath = "LOG.LOG_OUT";
        ref :>> targetEndpoint = outputBus;
        attribute :>> targetPortPath = "OUTPUT.LOG_IN";
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    part ceOutputToGpcaOut : ComponentExchange {
        attribute :>> id = "CE-142"; attribute :>> name = "OUTPUT_to_GPCA_OUT";
        attribute :>> exchangeKind = FlowKind::status;
        ref :>> sourceEndpoint = outputBus;
        attribute :>> sourcePortPath = "OUTPUT.GPCA_SW_OUT";
        ref :>> targetEndpoint = portGpcaSwOut;
        attribute :>> targetPortPath = "GPCA_SW_OUT";
        attribute :>> direction = DirectionKind::output;
        attribute :>> timingSemantics = "immediate (same-step delivery, Communication_Properties::Timing => immediate)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/GPCA_SW.aadl (GPCA_SW.Impl)";
    }
    // ── Text macros (App. A.3 internal state variables) ─────────
    item ddActualInfusionDurationMacro : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-042";
        attribute :>> name = "Actual_Infusion_Duration_macro";
        attribute :>> description = "Total duration the system has been in ACTIVE mode since infusion was initiated with the current prescription.";
        attribute :>> semantics = "Internal variable; reset to 0 every time infusion is initiated with a new prescription (REQ 12/13).";
        attribute :>> unit = "minutes";
        attribute :>> encoding = "Time";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.3 Text Macros";
    }
    item ddActualVolumeInfusedMacro : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-043";
        attribute :>> name = "Actual_Volume_Infused_macro";
        attribute :>> description = "Total volume of drug infused during Actual_Infusion_Duration_macro; drives the infusion-complete condition (REQ 28) and over-infusion VTBI (REQ 20).";
        attribute :>> semantics = "Internal variable; default 0; reset to 0 on infusion initiation.";
        attribute :>> unit = "ml/hr";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.3 Text Macros";
    }
    item ddFlowRateModeMacro : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-044";
        attribute :>> name = "FlowRate_Mode_macro";
        attribute :>> description = "Programmed flow rate of the current mode: FlowRate_kvo_hd in PAUSED, FlowRate_basal_prog in BASAL, FlowRate_sbolus_prog in SQUARE BOLUS, FlowRate_pbolus_prog in PATIENT BOLUS (§4.1.5).";
        attribute :>> semantics = "Internal variable; set by the system when entering the respective mode.";
        attribute :>> unit = "ml/hr";
        attribute :>> encoding = "Positive Integer";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.3 Text Macros";
    }
    item ddInhibitedInfusionMacro : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-045";
        attribute :>> name = "Inhibited_Infusion_macro";
        attribute :>> description = "TRUE when the notification in effect requires all infusion to be inhibited ('Inhibit Infusion' column of REQ 59); FALSE when that notification is cancelled or the system transitions to OFF.";
        attribute :>> semantics = "Internal variable set per the REQ 59 action table; drives REQ 30/37 transitions.";
        attribute :>> unit = "-";
        attribute :>> encoding = "Boolean";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.3 Text Macros";
    }
    item ddInhibitedBolusMacro : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-046";
        attribute :>> name = "Inhibited_Bolus_macro";
        attribute :>> description = "TRUE when the notification in effect requires square boluses to be inhibited ('Inhibit Square Bolus' column of REQ 59); cleared on cancel or OFF.";
        attribute :>> semantics = "Internal variable set per the REQ 59 action table; drives REQ 31/34/39 guards.";
        attribute :>> unit = "-";
        attribute :>> encoding = "Boolean";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.3 Text Macros";
    }
    item ddInhibitedPatientBolusMacro : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-047";
        attribute :>> name = "Inhibited_PatientBolus_macro";
        attribute :>> description = "TRUE when the notification in effect requires PATIENT BOLUS inhibit ('Inhibit Patient Bolus' column of REQ 59); cleared on cancel or OFF.";
        attribute :>> semantics = "Internal variable set per the REQ 59 action table; drives REQ 25/35/36/38 guards.";
        attribute :>> unit = "-";
        attribute :>> encoding = "Boolean";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.3 Text Macros";
    }
}
