package memo_examples_gpca_pump_model_catalog_gpca_requirements {
    private import ScalarValues::*;

    private import memo_assurance_requirements::*;
    private import memo_assurance_requirements_needs::*;
    private import memo_core_enumerations::*;

    // ═════════════════════════════════════════════════════════════
    // GPCA requirements layer.
    //
    // REQ-CS-01..86 mirror the CriSys GPCA System Requirements
    // (Murugesan/Rayadurgam/Heimdahl 2013, CITE-001) 1:1 by number,
    // organized by the source mode hierarchy. Formal macro/constant
    // expressions from the source are carried in acceptanceCriteria.
    //
    // REQ-X-01..14 are MEMO methodology extensions (sourceKind =
    // extension) that are NOT in the CriSys source; they showcase
    // POST, watchdog, cross-check, and hardware requirements.
    //
    // CONST-01..22 model the App. A.4 constants (plus I 8 audio and
    // Ch.5 retention durations) as first-class elements.
    // NOTIF-01..20 model the REQ 59 notification action table.
    // ═════════════════════════════════════════════════════════════

    // ── Stakeholder needs ───────────────────────────────────────
    requirement needSafeTherapy : Need {
        attribute :>> needKind = NeedKind::'stakeholder';
        attribute :>> id = "NEED-001"; attribute :>> name = "SafePatientControlledTherapy";
        attribute :>> statement = "The device shall support safe patient controlled analgesic infusion therapy.";
        attribute :>> priority = "high";
    }
    requirement needEffectiveAnalgesia : Need {
        attribute :>> needKind = NeedKind::'stakeholder';
        attribute :>> id = "NEED-002"; attribute :>> name = "EffectivePainManagement";
        attribute :>> statement = "The device shall deliver the prescribed basal and bolus doses accurately so the patient receives effective analgesia.";
        attribute :>> priority = "high";
    }
    requirement needTimelyAlarms : Need {
        attribute :>> needKind = NeedKind::'stakeholder';
        attribute :>> id = "NEED-003"; attribute :>> name = "TimelyAlarmNotification";
        attribute :>> statement = "Clinicians shall be notified promptly and unambiguously of any condition that interrupts or endangers therapy.";
        attribute :>> priority = "high";
    }
    requirement needAuditableRecord : Need {
        attribute :>> needKind = NeedKind::'stakeholder';
        attribute :>> id = "NEED-004"; attribute :>> name = "AuditableTherapyRecord";
        attribute :>> statement = "All delivered doses, alarms, and prescription changes shall be reviewable after the fact.";
        attribute :>> priority = "medium";
    }

    // ── System constants (CriSys App. A.4; I 8; Ch.5) ───────────
    part constMaxRateofFlowChange : SystemConstant {
        attribute :>> id = "CONST-01"; attribute :>> name = "Max_Rateof_Flow_Change";
        attribute :>> symbol = "Max_Rateof_Flow_Change_const";
        attribute :>> description = "Maximum rate of change of flow of drug in the hose.";
        attribute :>> unit = "ml/sec2"; attribute :>> valueType = "Numeric";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constMaxModeChangeDuration : SystemConstant {
        attribute :>> id = "CONST-02"; attribute :>> name = "Max_Mode_Change_Duration";
        attribute :>> symbol = "Max_Mode_Change_Duration_const";
        attribute :>> description = "Maximum time to be taken for mode transition.";
        attribute :>> unit = "sec"; attribute :>> valueType = "Time";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constConfigWarningDuration : SystemConstant {
        attribute :>> id = "CONST-03"; attribute :>> name = "Config_Warning_Duration";
        attribute :>> symbol = "Config_Warning_Duration_const";
        attribute :>> description = "Recommended duration of prescription values configuration.";
        attribute :>> unit = "sec"; attribute :>> valueType = "Time";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constMaxConfigDuration : SystemConstant {
        attribute :>> id = "CONST-04"; attribute :>> name = "Max_Config_Duration";
        attribute :>> symbol = "Max_Config_Duration_const";
        attribute :>> description = "Maximum time allowed for configuration.";
        attribute :>> unit = "sec"; attribute :>> valueType = "Time";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constMaxIdleDuration : SystemConstant {
        attribute :>> id = "CONST-05"; attribute :>> name = "Max_IDLE_Duration";
        attribute :>> symbol = "Max_IDLE_Duration_const";
        attribute :>> description = "Maximum duration the system is allowed to be in IDLE mode continuously.";
        attribute :>> unit = "sec"; attribute :>> valueType = "Time";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constMaxDurationUnderInfusion : SystemConstant {
        attribute :>> id = "CONST-06"; attribute :>> name = "Max_Duration_UnderInfusion";
        attribute :>> symbol = "Max_Duration_UnderInfusion_const";
        attribute :>> description = "Maximum cumulative duration the system can infuse below the respective mode's flow rate minus Tolerance_Min_const in any delta time interval.";
        attribute :>> unit = "sec"; attribute :>> valueType = "Time";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constMaxDurationOverInfusion : SystemConstant {
        attribute :>> id = "CONST-07"; attribute :>> name = "Max_Duration_OverInfusion";
        attribute :>> symbol = "Max_Duration_OverInfusion_const";
        attribute :>> description = "Maximum cumulative duration the system can infuse above the respective mode's flow rate plus Tolerance_Min_const in any delta time interval.";
        attribute :>> unit = "sec"; attribute :>> valueType = "Time";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constLowReservoir : SystemConstant {
        attribute :>> id = "CONST-08"; attribute :>> name = "Low_Reservoir";
        attribute :>> symbol = "Low_Reservoir_const";
        attribute :>> description = "Volume in the drug reservoir that needs notification for Low Reservoir.";
        attribute :>> unit = "ml"; attribute :>> valueType = "Numeric";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "should be greater than Empty_Reservoir_const";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constEmptyReservoir : SystemConstant {
        attribute :>> id = "CONST-09"; attribute :>> name = "Empty_Reservoir";
        attribute :>> symbol = "Empty_Reservoir_const";
        attribute :>> description = "Volume in the drug reservoir that needs notification for Empty Reservoir.";
        attribute :>> unit = "ml"; attribute :>> valueType = "Numeric";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "should be greater than FlowRate_kvo_hd (as written in the source)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constSingleAirBubbleVolume : SystemConstant {
        attribute :>> id = "CONST-10"; attribute :>> name = "Single_AirBubble_Volume";
        attribute :>> symbol = "Single_AirBubble_Volume_const";
        attribute :>> description = "Maximum volume of a single air bubble that is safe to be infused.";
        attribute :>> unit = "ml"; attribute :>> valueType = "Numeric";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constCumulativeAirBubbleVolume : SystemConstant {
        attribute :>> id = "CONST-11"; attribute :>> name = "Cumulative_AirBubble_Volume";
        attribute :>> symbol = "Cumulative_AirBubble_Volume_const";
        attribute :>> description = "Maximum volume of air bubbles cumulatively in a delta time interval that is safe to be infused.";
        attribute :>> unit = "ml"; attribute :>> valueType = "Numeric";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constRevDeliveryContinuousDuration : SystemConstant {
        attribute :>> id = "CONST-12"; attribute :>> name = "Rev_Delivery_Continuous_Duration";
        attribute :>> symbol = "Rev_Delivery_Continuous_Duration_const";
        attribute :>> description = "Maximum duration the system is acceptable to be in reverse delivery continuously.";
        attribute :>> unit = "minutes"; attribute :>> valueType = "Time";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constRevDeliveryCumulativeDuration : SystemConstant {
        attribute :>> id = "CONST-13"; attribute :>> name = "Rev_Delivery_Cumulative_Duration";
        attribute :>> symbol = "Rev_Delivery_Cumulative_Duration_const";
        attribute :>> description = "Maximum duration the system is acceptable to be in reverse delivery cumulatively in a delta time interval.";
        attribute :>> unit = "minutes"; attribute :>> valueType = "Time";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constMaxPausedDuration : SystemConstant {
        attribute :>> id = "CONST-14"; attribute :>> name = "Max_PAUSED_Duration";
        attribute :>> symbol = "Max_PAUSED_Duration_const";
        attribute :>> description = "Maximum duration the system is allowed to be in PAUSED mode continuously.";
        attribute :>> unit = "sec"; attribute :>> valueType = "Time";
        attribute :>> constantValue = ""; attribute :>> valueCondition = "value left open by the source";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constToleranceMax : SystemConstant {
        attribute :>> id = "CONST-15"; attribute :>> name = "Tolerance_Max";
        attribute :>> symbol = "Tolerance_Max_const";
        attribute :>> description = "Maximum acceptable variation in flow rate in any mode, specified as a percentage of the respective mode's flow rate.";
        attribute :>> unit = "%"; attribute :>> valueType = "Positive Integer";
        attribute :>> constantValue = "20 %"; attribute :>> valueCondition = "";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constToleranceMin : SystemConstant {
        attribute :>> id = "CONST-16"; attribute :>> name = "Tolerance_Min";
        attribute :>> symbol = "Tolerance_Min_const";
        attribute :>> description = "Tolerance in flow rate variation that is acceptable for a certain duration of time (Max_Duration_OverInfusion_const, Max_Duration_UnderInfusion_const); computed like Tolerance_Max_const.";
        attribute :>> unit = "%"; attribute :>> valueType = "Positive Integer";
        attribute :>> constantValue = "5 %"; attribute :>> valueCondition = "";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constAudioLevel : SystemConstant {
        attribute :>> id = "CONST-17"; attribute :>> name = "Audio_level";
        attribute :>> symbol = "Audio_level_const";
        attribute :>> description = "Acceptable level of sound for audio notification. Interface spec I 8 states 50 db for 2 seconds per notification; the App. A.4 value cell is inconsistent in the source (lists '5 %').";
        attribute :>> unit = "decibels"; attribute :>> valueType = "Positive Integer";
        attribute :>> constantValue = "50 db for 2 seconds per notification"; attribute :>> valueCondition = "";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.4 (I 8) and App. A.4";
    }
    part constAudioEnableDuration : SystemConstant {
        attribute :>> id = "CONST-18"; attribute :>> name = "Audio_Enable_Duration";
        attribute :>> symbol = "Audio_Enable_Duration_const";
        attribute :>> description = "Audio notification temporary silencing duration.";
        attribute :>> unit = "minutes"; attribute :>> valueType = "Positive Integer";
        attribute :>> constantValue = "30"; attribute :>> valueCondition = "";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constLogInterval : SystemConstant {
        attribute :>> id = "CONST-19"; attribute :>> name = "Log_Interval";
        attribute :>> symbol = "Log_Interval_const";
        attribute :>> description = "Interval at which operational information should be recorded.";
        attribute :>> unit = "minutes"; attribute :>> valueType = "Positive Integer";
        attribute :>> constantValue = "5"; attribute :>> valueCondition = "";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), App. A.4";
    }
    part constErrorLogRetention : SystemConstant {
        attribute :>> id = "CONST-20"; attribute :>> name = "Error_Log_Retention";
        attribute :>> symbol = "Error_Log_Retention";
        attribute :>> description = "Duration for which the most recent error log data shall persist (REQ 85).";
        attribute :>> unit = "days"; attribute :>> valueType = "Time";
        attribute :>> constantValue = "30"; attribute :>> valueCondition = "";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §5.1 (REQ 85)";
    }
    part constOperationalLogRetention : SystemConstant {
        attribute :>> id = "CONST-21"; attribute :>> name = "Operational_Log_Retention";
        attribute :>> symbol = "Operational_Log_Retention";
        attribute :>> description = "Duration for which the most recent operational log data shall persist (REQ 85).";
        attribute :>> unit = "days"; attribute :>> valueType = "Time";
        attribute :>> constantValue = "15"; attribute :>> valueCondition = "";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §5.1 (REQ 85)";
    }
    part constPrescriptionPersistDuration : SystemConstant {
        attribute :>> id = "CONST-22"; attribute :>> name = "Prescription_Persist_Duration";
        attribute :>> symbol = "Prescription_Persist_Duration";
        attribute :>> description = "Duration for which the last saved prescription data shall persist (REQ 86).";
        attribute :>> unit = "days"; attribute :>> valueType = "Time";
        attribute :>> constantValue = "15"; attribute :>> valueCondition = "";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §5.1 (REQ 86)";
    }

    // ── REQ 59 notification action table (20 notifications) ─────
    // Priority High/Med/Low with actions Visual / Audio / Inhibit
    // Infusion / Inhibit Square Bolus / Inhibit Patient Bolus /
    // Stop Bolus, exactly as tabulated in the source. Order of
    // restriction: Inhibit All Infusion > Inhibit Square Bolus >
    // Inhibit Patient Bolus.
    part notifLowReservoir : NotificationSpec {
        attribute :>> id = "NOTIF-01"; attribute :>> name = "Low_Reservoir";
        attribute :>> priority = NotificationPriorityKind::high;
        attribute :>> visualNotification = true; attribute :>> audioNotification = false;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = true;
        attribute :>> inhibitPatientBolus = true; attribute :>> stopBolus = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifEmptyReservoir : NotificationSpec {
        attribute :>> id = "NOTIF-02"; attribute :>> name = "Empty_Reservoir";
        attribute :>> priority = NotificationPriorityKind::high;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = true; attribute :>> inhibitSquareBolus = true;
        attribute :>> inhibitPatientBolus = true; attribute :>> stopBolus = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifAirEmbolism : NotificationSpec {
        attribute :>> id = "NOTIF-03"; attribute :>> name = "Air_embolism";
        attribute :>> priority = NotificationPriorityKind::high;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = true; attribute :>> inhibitSquareBolus = true;
        attribute :>> inhibitPatientBolus = true; attribute :>> stopBolus = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifReverseDelivery : NotificationSpec {
        attribute :>> id = "NOTIF-04"; attribute :>> name = "Reverse_Delivery";
        attribute :>> priority = NotificationPriorityKind::high;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = true; attribute :>> inhibitSquareBolus = true;
        attribute :>> inhibitPatientBolus = true; attribute :>> stopBolus = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifOverInfusionFlowRate : NotificationSpec {
        attribute :>> id = "NOTIF-05"; attribute :>> name = "Over_Infusion_FlowRate";
        attribute :>> priority = NotificationPriorityKind::high;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = true; attribute :>> inhibitSquareBolus = true;
        attribute :>> inhibitPatientBolus = true; attribute :>> stopBolus = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifOverInfusionVtbi : NotificationSpec {
        attribute :>> id = "NOTIF-06"; attribute :>> name = "Over_Infusion_VTBI";
        attribute :>> priority = NotificationPriorityKind::high;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = true; attribute :>> inhibitSquareBolus = true;
        attribute :>> inhibitPatientBolus = true; attribute :>> stopBolus = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifBolusExceeded : NotificationSpec {
        attribute :>> id = "NOTIF-07"; attribute :>> name = "Bolus_Exceeded";
        attribute :>> priority = NotificationPriorityKind::medium;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = true; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifInfusionInhibited : NotificationSpec {
        attribute :>> id = "NOTIF-08"; attribute :>> name = "Infusion_Inhibited";
        attribute :>> priority = NotificationPriorityKind::medium;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = true; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifInfusionManuallyInhibited : NotificationSpec {
        attribute :>> id = "NOTIF-09"; attribute :>> name = "Infusion_Manually_Inhibited";
        attribute :>> priority = NotificationPriorityKind::medium;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = true; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifInfusionStoppedManually : NotificationSpec {
        attribute :>> id = "NOTIF-10"; attribute :>> name = "Infusion_Stopped_Manually";
        attribute :>> priority = NotificationPriorityKind::medium;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = true; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifUnderInfusionFlowRate : NotificationSpec {
        attribute :>> id = "NOTIF-11"; attribute :>> name = "Under_Infusion_FlowRate";
        attribute :>> priority = NotificationPriorityKind::medium;
        attribute :>> visualNotification = true; attribute :>> audioNotification = false;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifUnderInfusionVtbi : NotificationSpec {
        attribute :>> id = "NOTIF-12"; attribute :>> name = "Under_Infusion_VTBI";
        attribute :>> priority = NotificationPriorityKind::medium;
        attribute :>> visualNotification = true; attribute :>> audioNotification = false;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifInfusionComplete : NotificationSpec {
        attribute :>> id = "NOTIF-13"; attribute :>> name = "Infusion_Complete";
        attribute :>> priority = NotificationPriorityKind::low;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifFrequentBolusRequests : NotificationSpec {
        attribute :>> id = "NOTIF-14"; attribute :>> name = "Frequent_Bolus_Requests";
        attribute :>> priority = NotificationPriorityKind::low;
        attribute :>> visualNotification = true; attribute :>> audioNotification = false;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifIdleTime : NotificationSpec {
        attribute :>> id = "NOTIF-15"; attribute :>> name = "IDLE_Time";
        attribute :>> priority = NotificationPriorityKind::low;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifPausedTime : NotificationSpec {
        attribute :>> id = "NOTIF-16"; attribute :>> name = "PAUSED_Time";
        attribute :>> priority = NotificationPriorityKind::low;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifConfigTime : NotificationSpec {
        attribute :>> id = "NOTIF-17"; attribute :>> name = "Config_Time";
        attribute :>> priority = NotificationPriorityKind::low;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifValidationFailed : NotificationSpec {
        attribute :>> id = "NOTIF-18"; attribute :>> name = "Validation_Failed";
        attribute :>> priority = NotificationPriorityKind::low;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifDrugSafeValueNotPresent : NotificationSpec {
        attribute :>> id = "NOTIF-19"; attribute :>> name = "Drug_safe_value_not_present";
        attribute :>> description = "Raised with the missing field names appended.";
        attribute :>> priority = NotificationPriorityKind::low;
        attribute :>> visualNotification = true; attribute :>> audioNotification = false;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }
    part notifDrugDatabaseNotReachable : NotificationSpec {
        attribute :>> id = "NOTIF-20"; attribute :>> name = "Drug_database_not_reachable";
        attribute :>> priority = NotificationPriorityKind::low;
        attribute :>> visualNotification = true; attribute :>> audioNotification = true;
        attribute :>> inhibitInfusion = false; attribute :>> inhibitSquareBolus = false;
        attribute :>> inhibitPatientBolus = false; attribute :>> stopBolus = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 REQ 59 table";
    }

    // ═════ CriSys system requirements — §4.1.1 GPCA System ══════
    requirement reqCs01 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-01"; attribute :>> name = "SingleActiveMode";
        attribute :>> statement = "The system shall always be in only one of the following modes: OFF (default mode), IDLE, PAUSED, BASAL, SQUARE BOLUS or PATIENT BOLUS.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Mode output is always exactly one valid exclusive value.";
        attribute :>> subjectDescription = "GPCA system";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.1.1 (REQ 1)";
    }
    requirement reqCs02 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-02"; attribute :>> name = "ModeChangeDurationWithoutFlowChange";
        attribute :>> statement = "If there are mode transitions without change in flow rates between the two modes, the system shall transition within Max_Mode_Change_Duration_const.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::performance;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "transition time <= Max_Mode_Change_Duration_const";
        attribute :>> subjectDescription = "GPCA system";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.1.1 (REQ 2)";
    }
    requirement reqCs03 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-03"; attribute :>> name = "ModeChangeFlowRamp";
        attribute :>> statement = "If there are mode transitions with change in flow rates between the two modes, the system shall change from the current mode flow rate to the new mode flow rate at a rate not more than Max_Rateof_Flow_Change_const or within Max_Mode_Change_Duration_const, whichever achieves the new desired flow rate the quickest.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::performance;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "flow ramp rate <= Max_Rateof_Flow_Change_const OR transition time <= Max_Mode_Change_Duration_const (quickest wins)";
        attribute :>> subjectDescription = "GPCA system";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.1.1 (REQ 3)";
    }
    requirement reqCs04 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-04"; attribute :>> name = "OffToIdleOnSystemStart";
        attribute :>> statement = "The system shall transition from OFF mode to ON > IDLE mode when System_start_prog is commanded. At this transition, the variables in App. A.4 shall be set to their default values.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "System_start_prog in OFF => mode = ON > IDLE and A.4 variables at defaults";
        attribute :>> subjectDescription = "GPCA system (OFF -> ON transition)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.1.2 (REQ 4)";
    }
    requirement reqCs05 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-05"; attribute :>> name = "OnToOffOnSystemStop";
        attribute :>> statement = "While in ON mode, when System_stop_prog is commanded, the system shall stop infusion, cancel all notifications and transition to OFF mode.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "System_stop_prog in ON => infusion stopped, active notifications cancelled, mode = OFF";
        attribute :>> subjectDescription = "GPCA system (ON -> OFF transition)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.1.2 (REQ 5)";
    }

    // ── §4.1.2 OFF mode ─────────────────────────────────────────
    requirement reqCs06 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-06"; attribute :>> name = "OffModeNoDelivery";
        attribute :>> statement = "While in OFF mode, the system shall not deliver any drug.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "FlowRate_output = 0";
        attribute :>> subjectDescription = "OFF mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.2.1 (REQ 6)";
    }

    // ── §4.1.3 ON mode ──────────────────────────────────────────
    requirement reqCs07 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-07"; attribute :>> name = "InfusionRequiresSavedPrescription";
        attribute :>> statement = "While in ON mode, the system shall allow initiation of infusion only when a saved prescription is available.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Infusion initiation is rejected when no saved prescription exists.";
        attribute :>> subjectDescription = "ON mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3.1 (REQ 7)";
    }
    requirement reqCs08 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-08"; attribute :>> name = "AllowDataConfigurationInOn";
        attribute :>> statement = "While in ON mode, the system shall allow configuring (DataConfig_prog) new or saved prescription data and reservoir initial volume, as described in the Data Configuration Requirements (§4.2).";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "DataConfig_prog is accepted in ON mode and enters the §4.2 configuration flow.";
        attribute :>> subjectDescription = "ON mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3.1 (REQ 8)";
    }
    requirement reqCs09 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-09"; attribute :>> name = "PrescriptionDisplayAndConfirm";
        attribute :>> statement = "While in ON mode, if Infusion_initiate_prog, the system shall display the saved prescription values and allow the clinician to confirm the prescription with another Infusion_initiate_prog.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "First Infusion_initiate_prog displays saved values; therapy starts only after a second Infusion_initiate_prog.";
        attribute :>> subjectDescription = "ON mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3.1 (REQ 9)";
    }
    requirement reqCs10 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-10"; attribute :>> name = "AllowNotificationsInOn";
        attribute :>> statement = "While in ON mode, the system shall allow visual and audio notification as described in §4.3.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Notification behaviors of §4.3 are available whenever the system is in ON mode.";
        attribute :>> subjectDescription = "ON mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3.1 (REQ 10)";
    }
    requirement reqCs11 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-11"; attribute :>> name = "AllowLoggingInOn";
        attribute :>> statement = "While in ON mode, the system shall allow logging as described in §4.4.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::regulatory;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Log behaviors of §4.4 are available whenever the system is in ON mode.";
        attribute :>> subjectDescription = "ON mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3.1 (REQ 11)";
    }
    requirement reqCs12 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-12"; attribute :>> name = "ConfirmedInitiateStartsBasal";
        attribute :>> statement = "While in ON mode, when the second Infusion_initiate_prog is commanded as per REQ 9 and Inhibited_Infusion_macro = FALSE, the system shall reset Actual_Infusion_Duration_macro = 0 and Actual_Volume_Infused_macro = 0 and shall transition to ON > THERAPY > ACTIVE > BASAL mode.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Actual_Infusion_Duration_macro = 0 AND Actual_Volume_Infused_macro = 0 AND mode = ON > THERAPY > ACTIVE > BASAL";
        attribute :>> subjectDescription = "ON mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3.2 (REQ 12)";
    }
    requirement reqCs13 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-13"; attribute :>> name = "ConfirmedInitiateWhileInhibitedPauses";
        attribute :>> statement = "While in ON mode, when the second Infusion_initiate_prog is commanded as per REQ 9 and Inhibited_Infusion_macro = TRUE, the system shall reset Actual_Infusion_Duration_macro = 0 and Actual_Volume_Infused_macro = 0, shall transition to ON > THERAPY > PAUSED mode and perform actions as described in REQ 59 for 'Infusion Inhibited'.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Inhibited_Infusion_macro = TRUE => mode = ON > THERAPY > PAUSED and 'Infusion Inhibited' actions taken";
        attribute :>> subjectDescription = "ON mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3.2 (REQ 13)";
    }

    // ── §4.1.4 ON > IDLE mode ───────────────────────────────────
    requirement reqCs14 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-14"; attribute :>> name = "IdleModeNoDelivery";
        attribute :>> statement = "While in IDLE mode, the system shall not deliver any drug.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "FlowRate_output = 0";
        attribute :>> subjectDescription = "ON > IDLE mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.4.1 (REQ 14)";
    }
    requirement reqCs15 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-15"; attribute :>> name = "IdleTimeNotification";
        attribute :>> statement = "While in IDLE mode for more than Max_IDLE_Duration_const, the system shall take actions as defined in REQ 59 for 'IDLE Time'.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "time in IDLE > Max_IDLE_Duration_const => 'IDLE Time' actions taken";
        attribute :>> subjectDescription = "ON > IDLE mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.4.1 (REQ 15)";
    }

    // ── §4.1.5 ON > THERAPY mode ────────────────────────────────
    requirement reqCs16 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-16"; attribute :>> name = "TherapyDeliveryWithinTolerance";
        attribute :>> statement = "While in THERAPY mode, the system shall deliver the drug as per the respective sub-mode's programmed flow rate, FlowRate_Mode_macro, within a tolerance of Tolerance_Max_const.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "FlowRate_output < FlowRate_Mode_macro + Tolerance_Max_const";
        attribute :>> subjectDescription = "ON > THERAPY mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5.1 (REQ 16)";
    }
    requirement reqCs17 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-17"; attribute :>> name = "UnderInfusionFlowRateNotification";
        attribute :>> statement = "While in THERAPY mode, the system shall take actions as defined in REQ 59 for 'Under Infusion FlowRate' if the output flow rate falls below the mode flow rate beyond the tolerance windows.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "FlowRate_output < FlowRate_Mode_macro - Tolerance_Min_const for more than Max_Duration_UnderInfusion_const OR FlowRate_output < FlowRate_Mode_macro - Tolerance_Max_const OR FlowRate_output < FlowRate_lo_hd";
        attribute :>> subjectDescription = "ON > THERAPY mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5.1 (REQ 17)";
    }
    requirement reqCs18 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-18"; attribute :>> name = "LowReservoirNotification";
        attribute :>> statement = "While in THERAPY mode, when the current volume of drug in the reservoir is less than Low_Reservoir_const, the system shall perform the actions defined in REQ 59 for 'Low Reservoir'.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "reservoir volume < Low_Reservoir_const => 'Low Reservoir' actions taken";
        attribute :>> subjectDescription = "ON > THERAPY mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5.1 (REQ 18)";
    }
    requirement reqCs19 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-19"; attribute :>> name = "OverInfusionFlowRatePause";
        attribute :>> statement = "While in THERAPY mode, the system shall transition to PAUSED mode and perform the actions described in REQ 59 for 'Over Infusion FlowRate' if the output flow rate exceeds the mode flow rate beyond the tolerance windows.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "FlowRate_output > FlowRate_Mode_macro + Tolerance_Min_const for more than Max_Duration_OverInfusion_const OR FlowRate_output > FlowRate_Mode_macro + Tolerance_Max_const OR FlowRate_output > FlowRate_hi_hd";
        attribute :>> subjectDescription = "ON > THERAPY mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5.2 (REQ 19)";
    }
    requirement reqCs20 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-20"; attribute :>> name = "OverInfusionVtbiPause";
        attribute :>> statement = "While in THERAPY mode, the system shall transition to PAUSED mode and take the actions described in REQ 59 for 'Over Infusion VTBI' if the actual volume infused exceeds the drug-database maximum VTBI.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Actual_Volume_Infused_macro > VTBI_hi_hd";
        attribute :>> subjectDescription = "ON > THERAPY mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5.2 (REQ 20)";
    }
    requirement reqCs21 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-21"; attribute :>> name = "AirEmbolismPause";
        attribute :>> statement = "While in THERAPY mode, the system shall transition to PAUSED mode and perform the actions defined in REQ 59 for 'Air embolism' if an air bubble of a volume larger than Single_AirBubble_Volume_const flows through the hose, or the sum of volume of all air bubbles flowing through the hose exceeds Cumulative_AirBubble_Volume_const for the same time interval defined for Cumulative_AirBubble_Volume_const.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "single bubble volume > Single_AirBubble_Volume_const OR cumulative bubble volume > Cumulative_AirBubble_Volume_const";
        attribute :>> subjectDescription = "ON > THERAPY mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5.2 (REQ 21)";
    }
    requirement reqCs22 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-22"; attribute :>> name = "ReverseDeliveryPause";
        attribute :>> statement = "While in THERAPY mode, the system shall transition to PAUSED mode and perform actions defined in REQ 59 for 'Reverse Delivery' if there is continuous reverse delivery for more than Rev_Delivery_Continuous_Duration_const, or the cumulative time of all reverse delivery episodes exceeds Rev_Delivery_Cumulative_Duration_const.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "continuous reverse delivery > Rev_Delivery_Continuous_Duration_const OR cumulative reverse delivery > Rev_Delivery_Cumulative_Duration_const";
        attribute :>> subjectDescription = "ON > THERAPY mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5.2 (REQ 22)";
    }
    requirement reqCs23 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-23"; attribute :>> name = "EmptyReservoirPause";
        attribute :>> statement = "While in THERAPY mode and if the volume of drug in the reservoir is less than Empty_Reservoir_const, the system shall transition to PAUSED mode and perform actions as listed in REQ 59 for 'Empty Reservoir'.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "reservoir volume < Empty_Reservoir_const => mode = PAUSED and 'Empty Reservoir' actions taken";
        attribute :>> subjectDescription = "ON > THERAPY mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5.2 (REQ 23)";
    }

    // ── §4.1.6 ON > THERAPY > ACTIVE mode ───────────────────────
    requirement reqCs24 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-24"; attribute :>> name = "SquareBolusAutoSchedule";
        attribute :>> statement = "While in ACTIVE mode, the system shall schedule to start a SQUARE BOLUS every Interval_sbolus_prog and end after Duration_sbolus_prog during the Duration_total_prog.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Square boluses are auto-scheduled by the system every Interval_sbolus_prog for Duration_sbolus_prog; no external trigger is required.";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.1 (REQ 24)";
    }
    requirement reqCs25 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-25"; attribute :>> name = "IgnorePatientBolusRequestConditions";
        attribute :>> statement = "While in ACTIVE mode, when BolusRequest_prog, the system shall ignore the patient bolus request (BolusRequest_prog = FALSE) if: (1) Inhibited_Infusion_macro = TRUE, OR (2) Inhibited_PatientBolus_macro = TRUE, OR (3) the interval between the most recent PATIENT BOLUS mode end time and the current BolusRequest_prog time violates LockOutPeriod_pbolus_prog, OR (4) the total number of delivered patient boluses for the current prescription violates the programmed maximum number of patient boluses, OR (5) the system is currently in PATIENT BOLUS mode.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Source formal conditions: (3) (BolusRequest_prog time - most recent PATIENT BOLUS end time) > LockOutPeriod_pbolus_prog; (4) sum of occurrences of all PATIENT BOLUS modes > NumberMax_pbolus_prog (source prose and formal expressions are inconsistent; transcribed as written).";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.1 (REQ 25)";
    }
    requirement reqCs26 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-26"; attribute :>> name = "FrequentBolusRequestsNotification";
        attribute :>> statement = "While in ACTIVE mode, the system shall perform the actions described in REQ 59 for 'Frequent Bolus Requests' if the condition described in REQ 25.3 or REQ 25.5 occurs.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "REQ 25 condition 3 or 5 => 'Frequent Bolus Requests' actions taken";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.1 (REQ 26)";
    }
    requirement reqCs27 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-27"; attribute :>> name = "BolusExceededNotification";
        attribute :>> statement = "While in ACTIVE mode, the system shall perform the actions described in REQ 59 for 'Bolus Exceeded' if the condition described in REQ 25.4 occurs.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "REQ 25 condition 4 => 'Bolus Exceeded' actions taken";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.1 (REQ 27)";
    }
    requirement reqCs28 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-28"; attribute :>> name = "InfusionCompleteToIdle";
        attribute :>> statement = "While in ACTIVE mode, the system shall transition to IDLE and perform actions described in REQ 59 for 'Infusion Complete' if the actual duration of infusion is greater than or equal to the programmed prescription total duration, or the total volume infused is greater than or equal to the programmed prescription maximum VTBI.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Actual_Infusion_Duration_macro >= Duration_total_prog OR Actual_Volume_Infused_macro >= VTBI_total_prog";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 28)";
    }
    requirement reqCs29 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-29"; attribute :>> name = "ManualInhibitToPaused";
        attribute :>> statement = "While in ACTIVE mode, when Infusion_inhibit_prog, the system shall transition to PAUSED mode and perform actions described in REQ 59 for 'Infusion Manually Inhibited'.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Infusion_inhibit_prog => mode = PAUSED and 'Infusion Manually Inhibited' actions taken";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 29)";
    }
    requirement reqCs30 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-30"; attribute :>> name = "AllInhibitedToPaused";
        attribute :>> statement = "While in ACTIVE mode, when Inhibited_Infusion_macro = TRUE, Inhibited_Bolus_macro = TRUE and Inhibited_PatientBolus_macro = TRUE, the system shall transition to PAUSED mode.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Inhibited_Infusion_macro AND Inhibited_Bolus_macro AND Inhibited_PatientBolus_macro => mode = PAUSED";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 30)";
    }
    requirement reqCs31 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-31"; attribute :>> name = "BasalToSquareBolus";
        attribute :>> statement = "While in BASAL mode, when SQUARE BOLUS is initiated as described in REQ 24, the system shall transition to SQUARE BOLUS mode if (1) Inhibited_Bolus_macro = FALSE, AND (2) Inhibited_Infusion_macro = FALSE, AND (3) either there is no BolusRequest_prog, or there is a BolusRequest_prog and at least one of the conditions listed in REQ 25 is true.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "NOT Inhibited_Bolus_macro AND NOT Inhibited_Infusion_macro AND (no BolusRequest_prog OR a REQ 25 ignore condition holds)";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 31)";
    }
    requirement reqCs32 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-32"; attribute :>> name = "BasalToPatientBolus";
        attribute :>> statement = "While in BASAL mode, the system shall transition to PATIENT BOLUS mode when BolusRequest_prog and none of the conditions listed in REQ 25 are true.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "BolusRequest_prog AND no REQ 25 ignore condition holds => mode = PATIENT BOLUS";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 32)";
    }
    requirement reqCs33 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-33"; attribute :>> name = "SquareBolusToPatientBolus";
        attribute :>> statement = "While in SQUARE BOLUS mode, the system shall transition to PATIENT BOLUS mode if BolusRequest_prog and none of the conditions listed in REQ 25 are true.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "BolusRequest_prog AND no REQ 25 ignore condition holds => mode = PATIENT BOLUS";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 33)";
    }
    requirement reqCs34 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-34"; attribute :>> name = "SquareBolusToBasal";
        attribute :>> statement = "While in SQUARE BOLUS mode, if Inhibited_Bolus_macro = TRUE or the SQUARE BOLUS is scheduled to end (as described in REQ 24), the system shall transition to BASAL mode if (1) Inhibited_Infusion_macro = FALSE, AND (2) there is no BolusRequest_prog, or BolusRequest_prog and at least one of the conditions listed in REQ 25 is true.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "(Inhibited_Bolus_macro OR scheduled end) AND NOT Inhibited_Infusion_macro AND (no BolusRequest_prog OR a REQ 25 ignore condition holds) => mode = BASAL";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 34)";
    }
    requirement reqCs35 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-35"; attribute :>> name = "PatientBolusToBasal";
        attribute :>> statement = "While in PATIENT BOLUS mode, when Inhibited_PatientBolus_macro = TRUE or the total duration in the current PATIENT BOLUS mode is greater than or equal to Duration_pbolus_prog, the system shall stop the PATIENT BOLUS delivery and transition to BASAL mode if (1) Inhibited_Infusion_macro = FALSE, AND (2) no SQUARE BOLUS is scheduled to be in progress at the time of transition, OR (3) a SQUARE BOLUS is scheduled to be in progress at the time of transition and Inhibited_Bolus_macro = TRUE.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "(Inhibited_PatientBolus_macro OR patient-bolus duration >= Duration_pbolus_prog) AND NOT Inhibited_Infusion_macro AND (no square bolus scheduled OR (square bolus scheduled AND Inhibited_Bolus_macro)) => mode = BASAL";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 35)";
    }
    requirement reqCs36 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-36"; attribute :>> name = "PatientBolusToSquareBolus";
        attribute :>> statement = "While in PATIENT BOLUS mode, when Inhibited_PatientBolus_macro = TRUE or the total duration in the current PATIENT BOLUS mode is greater than or equal to Duration_pbolus_prog, the system shall stop the PATIENT BOLUS delivery and transition to SQUARE BOLUS mode if (1) Inhibited_Infusion_macro = FALSE, AND (2) a SQUARE BOLUS is scheduled to be in progress at the time of transition, AND (3) Inhibited_Bolus_macro = FALSE.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "(Inhibited_PatientBolus_macro OR patient-bolus duration >= Duration_pbolus_prog) AND NOT Inhibited_Infusion_macro AND square bolus scheduled AND NOT Inhibited_Bolus_macro => mode = SQUARE BOLUS";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 36)";
    }
    requirement reqCs37 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-37"; attribute :>> name = "BasalToPauseOnInhibit";
        attribute :>> statement = "While in BASAL mode, if Inhibited_Infusion_macro = TRUE, the system shall transition to PAUSE mode.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Inhibited_Infusion_macro => mode = PAUSED";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 37)";
    }
    requirement reqCs38 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-38"; attribute :>> name = "PatientBolusToPauseOnInhibit";
        attribute :>> statement = "While in PATIENT BOLUS mode, the system shall transition to PAUSE mode if Inhibited_PatientBolus_macro = TRUE and Inhibited_Infusion_macro = TRUE.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Inhibited_PatientBolus_macro AND Inhibited_Infusion_macro => mode = PAUSED";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 38)";
    }
    requirement reqCs39 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-39"; attribute :>> name = "SquareBolusToPauseOnInhibit";
        attribute :>> statement = "While in SQUARE BOLUS mode, the system shall transition to PAUSE mode if Inhibited_Bolus_macro = TRUE and Inhibited_Infusion_macro = TRUE.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Inhibited_Bolus_macro AND Inhibited_Infusion_macro => mode = PAUSED";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 39)";
    }

    // ── §4.1.7–4.1.9 BASAL / SQUARE BOLUS / PATIENT BOLUS ───────
    requirement reqCs40 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-40"; attribute :>> name = "BasalDeliveryRate";
        attribute :>> statement = "While in BASAL mode, the system shall deliver the drug at a flow rate FlowRate_basal_prog with a variation up to Tolerance_Max_const.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "FlowRate_output within Tolerance_Max_const of FlowRate_basal_prog";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE > BASAL mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.7.1 (REQ 40)";
    }
    requirement reqCs41 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-41"; attribute :>> name = "SquareBolusDeliveryRate";
        attribute :>> statement = "While in SQUARE BOLUS mode, the system shall deliver the drug at a flow rate FlowRate_sbolus_prog with a variation up to Tolerance_Max_const.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "FlowRate_output within Tolerance_Max_const of FlowRate_sbolus_prog";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE > SQUARE BOLUS mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.8.1 (REQ 41)";
    }
    requirement reqCs42 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-42"; attribute :>> name = "PatientBolusDeliveryRate";
        attribute :>> statement = "While in PATIENT BOLUS mode, the system shall deliver the drug at a flow rate FlowRate_pbolus_prog with a variation up to Tolerance_Max_const.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "FlowRate_output within Tolerance_Max_const of FlowRate_pbolus_prog";
        attribute :>> subjectDescription = "ON > THERAPY > ACTIVE > PATIENT BOLUS mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.9.1 (REQ 42)";
    }

    // ── §4.1.10 ON > THERAPY > PAUSED mode ──────────────────────
    requirement reqCs43 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-43"; attribute :>> name = "PausedKvoDelivery";
        attribute :>> statement = "While in PAUSED mode, the system shall allow drug infusion at a flow rate FlowRate_kvo_hd with a variation up to Tolerance_Max_const, to keep the vein open when infusion is paused.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "FlowRate_Mode_macro = FlowRate_kvo_hd; FlowRate_output within Tolerance_Max_const of FlowRate_kvo_hd (KVO flow, not zero)";
        attribute :>> subjectDescription = "ON > THERAPY > PAUSED mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.10.1 (REQ 43)";
    }
    requirement reqCs44 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-44"; attribute :>> name = "PausedTimeNotification";
        attribute :>> statement = "While in PAUSED mode for more than Max_PAUSED_Duration_const, the system shall perform actions as described in REQ 59 for 'PAUSED Time'.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "time in PAUSED > Max_PAUSED_Duration_const => 'PAUSED Time' actions taken";
        attribute :>> subjectDescription = "ON > THERAPY > PAUSED mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.10.1 (REQ 44)";
    }
    requirement reqCs45 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-45"; attribute :>> name = "PausedInitiateWhileInhibitedNoTransition";
        attribute :>> statement = "While in PAUSED mode, when Infusion_initiate_prog and Inhibited_Infusion_macro = TRUE, the system shall not perform any transition.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Infusion_initiate_prog AND Inhibited_Infusion_macro => mode unchanged";
        attribute :>> subjectDescription = "ON > THERAPY > PAUSED mode";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.10.1 (REQ 45)";
    }
    requirement reqCs46 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-46"; attribute :>> name = "PausedResumeToBasal";
        attribute :>> statement = "While in PAUSED mode, when Infusion_initiate_prog and Inhibited_Infusion_macro = FALSE, the system shall transition to ON > THERAPY > ACTIVE > BASAL mode.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Infusion_initiate_prog AND NOT Inhibited_Infusion_macro => mode = ON > THERAPY > ACTIVE > BASAL";
        attribute :>> subjectDescription = "ON > THERAPY > PAUSED mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.10.2 (REQ 46)";
    }
    requirement reqCs47 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-47"; attribute :>> name = "PausedInhibitToIdle";
        attribute :>> statement = "While in PAUSED mode, when Infusion_inhibit_prog, the system shall transition to ON > IDLE mode and perform actions as described in REQ 59 for 'Infusion Stopped Manually'.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Infusion_inhibit_prog => mode = ON > IDLE and 'Infusion Stopped Manually' actions taken";
        attribute :>> subjectDescription = "ON > THERAPY > PAUSED mode transitions";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.10.2 (REQ 47)";
    }

    // ═════ §4.2 Data Configuration Requirements ═════════════════
    requirement reqCs48 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-48"; attribute :>> name = "DisplaySavedPrescriptionOnConfig";
        attribute :>> statement = "When in ON mode, if DataConfig_prog as described in REQ 8, the system shall display the saved prescription and reservoir initial volume values or their default values (if there are no saved prescription and reservoir initial volume values) in the order listed in §3.1.1 and §3.1.3.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Displayed values equal saved values (or defaults) in the interface-specified order.";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 48)";
    }
    requirement reqCs49 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-49"; attribute :>> name = "EditValuesOneAtATime";
        attribute :>> statement = "When the prescription and reservoir initial volume data are displayed as described in REQ 48, the system shall allow editing the values one at a time in the order they are displayed.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Exactly one value is editable at a time, in display order.";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 49)";
    }
    requirement reqCs50 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-50"; attribute :>> name = "AllowInitiateWithNewValues";
        attribute :>> statement = "When the values are modified as described in REQ 49, the system shall allow infusion initiation with the new set of values (Infusion_initiate_prog).";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Infusion_initiate_prog is accepted with the modified value set.";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 50)";
    }
    requirement reqCs51 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-51"; attribute :>> name = "ValidateValuesOnInitiate";
        attribute :>> statement = "When Infusion_initiate_prog as described in REQ 50, the system shall validate if all the values are consistent with the conditions specified in their respective Type Condition fields in §3.1.1 and §3.1.3.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Every entered value satisfies its Type Condition constraints before saving.";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 51)";
    }
    requirement reqCs52 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-52"; attribute :>> name = "DrugDatabaseNotReachable";
        attribute :>> statement = "When the system is validating data as described in REQ 51, if the system is unable to access the drug database safe values, the system shall not save the values and perform actions as described in REQ 59 for 'Drug database not reachable'.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Database unreachable => values not saved and 'Drug database not reachable' actions taken";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 52)";
    }
    requirement reqCs53 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-53"; attribute :>> name = "DrugSafeValueNotPresent";
        attribute :>> statement = "When the system is validating data as described in REQ 51, if any of the drug database safe values listed in §3.5 is not present, the system shall not perform the validation with respect to that missing field, perform actions as described in REQ 59 for 'Drug safe value not present' and continue validation.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Missing safe value => that field's validation skipped, 'Drug safe value not present' actions taken, validation continues";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 53)";
    }
    requirement reqCs54 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-54"; attribute :>> name = "SaveValidatedPrescription";
        attribute :>> statement = "If there are no notifications from REQ 51 and REQ 52, the system shall save the prescription values, clear all the notifications previously generated by REQ 51, REQ 52 and REQ 53 if any, and allow initiate infusion with the new values as described in REQ 9.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Validation clean => values saved, prior validation notifications cleared, initiation enabled per REQ 9.";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 54)";
    }
    requirement reqCs55 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-55"; attribute :>> name = "RejectInvalidPrescription";
        attribute :>> statement = "If REQ 51 or REQ 52 had generated a notification, the system shall not save the prescription values, allow the clinician to edit the values of the fields as described in REQ 49 and then repeat steps from REQ 50 until all validations are passed as described in REQ 54.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Validation notification present => values not saved; edit-and-revalidate loop until clean.";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 55)";
    }
    requirement reqCs56 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-56"; attribute :>> name = "RemainInModeDuringConfig";
        attribute :>> statement = "While data configuration is in progress, the system shall remain in its current mode with the currently active prescription values, until infusion is initiated with the new prescription values as described in REQ 54.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Mode and active prescription are unchanged during configuration.";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 56)";
    }
    requirement reqCs57 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-57"; attribute :>> name = "ConfigWarningNotification";
        attribute :>> statement = "When the clinician has attempted to configure the data for more than Config_Warning_Duration_const continuously, the system shall perform actions as described in REQ 59 for 'Config Time'.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "continuous configuration time > Config_Warning_Duration_const => 'Config Time' actions taken";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 57)";
    }
    requirement reqCs58 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-58"; attribute :>> name = "MaxConfigDurationClears";
        attribute :>> statement = "When the clinician has attempted to configure the data for more than Max_Config_Duration_const continuously, the system shall clear all unsaved prescription values and shall perform actions as described in REQ 59 for 'Unsaved Configuration Cleared'.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "continuous configuration time > Max_Config_Duration_const => unsaved values cleared ('Unsaved Configuration Cleared' is referenced by the source but absent from the REQ 59 table — a documented source inconsistency).";
        attribute :>> subjectDescription = "Data configuration";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.2 (REQ 58)";
    }

    // ═════ §4.3 Notification Requirements ═══════════════════════
    requirement reqCs59 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-59"; attribute :>> name = "NotificationActionTable";
        attribute :>> statement = "The system shall perform all the actions listed in the notification action table for the respective notification. The table defines, for each of the 20 notifications, its priority (High/Med/Low) and the actions Visual, Audio, Inhibit Infusion, Inhibit Square Bolus, Inhibit Patient Bolus, and Stop Bolus. Notification requirements have higher precedence over all other requirements in the system.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "For every raised notification, the actions equal the NOTIF-01..NOTIF-20 table row: Inhibit Infusion => Inhibited_Infusion_macro = TRUE; Inhibit Square Bolus => Inhibited_Bolus_macro = TRUE; Inhibit Patient Bolus => Inhibited_PatientBolus_macro = TRUE; Stop Bolus => stop all boluses in progress.";
        attribute :>> subjectDescription = "Notification handling (see NOTIF-01..NOTIF-20)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 (REQ 59)";
    }
    requirement reqCs60 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-60"; attribute :>> name = "HighestPriorityActionsFirst";
        attribute :>> statement = "When more than one notification having different priorities occurs at the same time, the system shall take actions listed for the highest priority notification.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Simultaneous notifications with different priorities => actions of the highest priority notification are taken.";
        attribute :>> subjectDescription = "Notification precedence";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 (REQ 60)";
    }
    requirement reqCs61 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-61"; attribute :>> name = "MostRestrictiveSamePriority";
        attribute :>> statement = "When more than one notification having same priorities and different set of actions occurs at the same time, the system shall take actions listed for the most restrictive notification.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Order of restriction: Inhibit All Infusion > Inhibit Square Bolus > Inhibit Patient Bolus.";
        attribute :>> subjectDescription = "Notification precedence";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 (REQ 61)";
    }
    requirement reqCs62 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-62"; attribute :>> name = "MostRestrictiveTieBreak";
        attribute :>> statement = "When more than one notification having same priorities and same set of actions occurs at the same time, the system will take actions for the notification that has the most restrictive actions as listed in REQ 59.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Tie on priority and actions => REQ 59 restriction ordering breaks the tie.";
        attribute :>> subjectDescription = "Notification precedence";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 (REQ 62)";
    }
    requirement reqCs63 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-63"; attribute :>> name = "EscalateToMoreRestrictive";
        attribute :>> statement = "While a low priority or less restrictive notification is in effect and a higher priority or more restrictive same-priority notification occurs, the system shall take actions for the high priority or more restrictive notification as listed in REQ 59.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "In-effect notification is superseded by a higher-priority or more restrictive notification.";
        attribute :>> subjectDescription = "Notification precedence";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 (REQ 63)";
    }
    requirement reqCs64 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-64"; attribute :>> name = "LowPriorityListedOnly";
        attribute :>> statement = "While a high priority notification is in effect and a low priority notification occurs, the system shall only add the notification to the active notification list and shall not take any other actions for the low priority notification.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Lower-priority notification is listed but its actions are not taken while a higher-priority notification is in effect.";
        attribute :>> subjectDescription = "Notification precedence";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 (REQ 64)";
    }
    requirement reqCs65 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-65"; attribute :>> name = "CancelNotificationsOneAtATime";
        attribute :>> statement = "The system shall allow the clinician to cancel the active notifications, starting from the first in the list, one at a time (Notification_cancel_prog).";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Cancellation proceeds one notification at a time from the head of the list.";
        attribute :>> subjectDescription = "Notification cancellation";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 (REQ 65)";
    }
    requirement reqCs66 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-66"; attribute :>> name = "CancelClearsRestrictions";
        attribute :>> statement = "When Notification_cancel_prog for a notification, the system shall cancel and clear the restrictions for that notification: Inhibited_Infusion_macro = FALSE, Inhibited_Bolus_macro = FALSE, Inhibited_PatientBolus_macro = FALSE, and cancel and clear the corresponding audio notification.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "After cancel: Inhibited_Infusion_macro = FALSE AND Inhibited_Bolus_macro = FALSE AND Inhibited_PatientBolus_macro = FALSE AND audio cleared for that notification.";
        attribute :>> subjectDescription = "Notification cancellation";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 (REQ 66)";
    }
    requirement reqCs67 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-67"; attribute :>> name = "NextNotificationAfterCancel";
        attribute :>> statement = "When Notification_cancel_prog for a notification, the system takes actions for the next active notification in order of priority and descending order of occurrence.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "After cancel, the next active notification (by priority, then recency) becomes the notification in effect.";
        attribute :>> subjectDescription = "Notification cancellation";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3 (REQ 67)";
    }

    // ── §4.3.1 Visual notification ──────────────────────────────
    requirement reqCs68 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-68"; attribute :>> name = "DisplayActiveNotificationsOrdered";
        attribute :>> statement = "The system shall display all active notifications in order of priority and descending order of occurrence (Notification_Visual_output).";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Notification_Visual_output lists active notifications ordered by priority, then most recent first.";
        attribute :>> subjectDescription = "Visual notification";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3.1 (REQ 68)";
    }
    requirement reqCs69 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-69"; attribute :>> name = "DisplayNotificationNameAndTime";
        attribute :>> statement = "The system shall display the name of all the active notifications and the time of the occurrence.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Every active notification is shown with name and occurrence time.";
        attribute :>> subjectDescription = "Visual notification";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3.1 (REQ 69)";
    }
    requirement reqCs70 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-70"; attribute :>> name = "DisplaySimultaneousNotifications";
        attribute :>> statement = "When more than one notification occurs at the same time, the system shall display all the notifications as per REQ 68.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Simultaneous notifications are all displayed in REQ 68 order.";
        attribute :>> subjectDescription = "Visual notification";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3.1 (REQ 70)";
    }
    requirement reqCs71 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-71"; attribute :>> name = "RemoveCancelledNotificationFromList";
        attribute :>> statement = "When Notification_cancel_prog for a notification, the system shall remove the notification from the list and shall display the list of remaining notifications.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Cancelled notification disappears from the displayed list; remaining list stays displayed.";
        attribute :>> subjectDescription = "Visual notification";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3.1 (REQ 71)";
    }

    // ── §4.3.2 Audio notification ───────────────────────────────
    requirement reqCs72 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-72"; attribute :>> name = "AudibleSoundPerNotification";
        attribute :>> statement = "When each notification occurs that requires an audio alarm as listed in REQ 59, the system shall produce a single audible sound of Audio_level_const, unless the audio is disabled or silenced.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Audio-flagged notification => one audible sound at Audio_level_const (50 db for 2 seconds per I 8) unless Disable_audio_prog is set.";
        attribute :>> subjectDescription = "Audio notification";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3.2 (REQ 72)";
    }
    requirement reqCs73 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-73"; attribute :>> name = "AudioDisableSilenceEnable";
        attribute :>> statement = "The system shall allow the clinician to disable audible alarm, silence the alarm temporarily and enable a disabled or silenced alarm.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Notification_Audio_output = FALSE if Disable_audio_prog = 'PERM' (disabled) or 'TEMP' (silenced); Notification_Audio_output = TRUE if Disable_audio_prog = FALSE.";
        attribute :>> subjectDescription = "Audio notification";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3.2 (REQ 73)";
    }
    requirement reqCs74 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-74"; attribute :>> name = "NoAudioWhileDisabled";
        attribute :>> statement = "If Disable_audio_prog = 'PERM' or 'TEMP', the system shall not produce audible alarm until it is enabled (Disable_audio_prog = FALSE).";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "No audible alarm while Disable_audio_prog is 'PERM' or 'TEMP'.";
        attribute :>> subjectDescription = "Audio notification";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3.2 (REQ 74)";
    }
    requirement reqCs75 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-75"; attribute :>> name = "TempSilenceAutoReenable";
        attribute :>> statement = "If Disable_audio_prog = 'TEMP', the system shall automatically enable it (Disable_audio_prog = FALSE) after Audio_Enable_Duration_const minutes.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Temporary silence expires after Audio_Enable_Duration_const (30) minutes.";
        attribute :>> subjectDescription = "Audio notification";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3.2 (REQ 75)";
    }
    requirement reqCs76 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-76"; attribute :>> name = "ReannunciateLongActiveNotifications";
        attribute :>> statement = "For every notification with audio alarm that is active for more than Audio_Enable_Duration_const minutes, the system shall produce audible sound as described in REQ 72.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Audio-flagged notification active > Audio_Enable_Duration_const minutes => REQ 72 sound re-produced.";
        attribute :>> subjectDescription = "Audio notification";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.3.2 (REQ 76)";
    }

    // ═════ §4.4 Log Requirements ════════════════════════════════
    requirement reqCs77 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-77"; attribute :>> name = "LogWhileOn";
        attribute :>> statement = "The system shall log all the operational and error data when the system is in ON mode.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::regulatory;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Operational log and error log are recorded whenever the system is in ON mode.";
        attribute :>> subjectDescription = "Logging";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.4 (REQ 77)";
    }
    requirement reqCs78 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-78"; attribute :>> name = "OperationalLogContent";
        attribute :>> statement = "While in ON mode, every Log_Interval_const minutes or when a mode transition occurs, the system shall record the following information in an 'Operational log': (1) date in dd/MM/yy format, (2) time in HH:MM:SS GMT, (3) Patient ID, (4) prescription information, (5) current mode of the system, (6) current flow rate of the system.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::regulatory;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Operational log entries appear every Log_Interval_const (5) minutes and on every mode transition, with all six fields.";
        attribute :>> subjectDescription = "Logging";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.4 (REQ 78)";
    }
    requirement reqCs79 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-79"; attribute :>> name = "InfusionCompleteLogContent";
        attribute :>> statement = "When infusion is completed as per REQ 28, the system shall record the following information in addition to the information listed in REQ 78 in the 'Operational log': (1) total volume infused for that prescription, (2) total duration of infusion for that prescription (total duration in ACTIVE mode).";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::regulatory;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Infusion-complete log entry includes total volume infused and total ACTIVE-mode duration.";
        attribute :>> subjectDescription = "Logging";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.4 (REQ 79)";
    }
    requirement reqCs80 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-80"; attribute :>> name = "ErrorLogContent";
        attribute :>> statement = "When any notification condition listed in REQ 59 occurs, the system shall record the following information in an error log: (1) date in dd/MM/yy format, (2) time in HH:MM:SS GMT, (3) notification description, (4) current mode of the system, (5) remaining drug volume.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::regulatory;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Every REQ 59 notification produces an error log entry with all five fields.";
        attribute :>> subjectDescription = "Logging";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.4 (REQ 80)";
    }
    requirement reqCs81 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-81"; attribute :>> name = "NotificationCancelLogContent";
        attribute :>> statement = "When a notification is cancelled as described in REQ 66, the system shall record the following information in the 'Operational log': (1) date in dd/MM/yy format, (2) time in HH:MM:SS GMT, (3) description of the notification cancelled.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::regulatory;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Every notification cancellation produces an operational log entry with all three fields.";
        attribute :>> subjectDescription = "Logging";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.4 (REQ 81)";
    }

    // ═════ §4.5 Security Requirements ═══════════════════════════
    requirement reqCs82 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-82"; attribute :>> name = "AuthorizedCliniciansOnly";
        attribute :>> statement = "The system shall allow only authorized clinicians to configure the system.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::cybersecurity;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Configuration is rejected for unauthorized users.";
        attribute :>> subjectDescription = "System configuration access";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.5 (REQ 82)";
    }

    // ═════ Ch.5 Non-Behavioral Requirements ═════════════════════
    requirement reqCs83 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-83"; attribute :>> name = "DropResistance";
        attribute :>> statement = "The system shall be unbreakable if it is dropped on a laminate floor from y m of height with no additional force than gravity.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::reliability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Drop from height y m (value left open by the source) onto laminate floor causes no breakage.";
        attribute :>> subjectDescription = "GPCA enclosure";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §5.1 (REQ 83)";
    }
    requirement reqCs84 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-84"; attribute :>> name = "WaterResistance";
        attribute :>> statement = "The system shall be waterproof to non-acidic liquid of less than x ml on any side of the pump for a maximum of 2 hours.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::reliability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Exposure to < x ml (value left open by the source) non-acidic liquid for up to 2 hours causes no ingress failure.";
        attribute :>> subjectDescription = "GPCA enclosure";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §5.1 (REQ 84)";
    }
    requirement reqCs85 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-85"; attribute :>> name = "LogRetention";
        attribute :>> statement = "The system shall persist the most recent 30 days of error log data and 15 days of operational log data.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::regulatory;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "error log retention >= Error_Log_Retention (30 days); operational log retention >= Operational_Log_Retention (15 days)";
        attribute :>> subjectDescription = "Logging";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §5.1 (REQ 85)";
    }
    requirement reqCs86 : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-CS-86"; attribute :>> name = "PrescriptionRetention";
        attribute :>> statement = "The system shall persist the last saved prescription data for 15 days.";
        attribute :>> sourceKind = RequirementSourceKind::sourceDocument;
        attribute :>> concernKind = ConcernKind::regulatory;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "saved prescription retention >= Prescription_Persist_Duration (15 days)";
        attribute :>> subjectDescription = "Prescription storage";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §5.1 (REQ 86)";
    }

    // ═════ MEMO extension requirements (REQ-X) ══════════════════
    // Not present in the CriSys source. These showcase how the MEMO
    // methodology extends a source specification with risk-driven
    // and hardware requirements. sourceKind = extension segregates
    // them from the REQ-CS family.
    requirement reqDrugLibraryLimits : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-X-01"; attribute :>> name = "PrescriptionWithinDrugLibraryLimits";
        attribute :>> statement = "When a prescription parameter is entered, the system shall reject values outside drug-library hard limits and shall require explicit confirmation for values outside soft limits.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Hard-limit violations cannot be saved; soft-limit violations require a distinct confirmation step; both are logged.";
        attribute :>> subjectDescription = "Config";
        attribute :>> actorDescription = "clinician";
        attribute :>> assumptionSummary = "drug library installed and current";
        attribute :>> guaranteeSummary = "no out-of-range prescription can be activated";
        attribute :>> sourceReference = "MEMO extension — hard/soft limit discipline beyond CriSys §4.2 validation (REQ-CS-51..55)";
        attribute :>> notation = RequirementNotationKind::ears;
        attribute :>> earsPattern = EarsPatternKind::eventDriven;
        attribute :>> obligation = ObligationKind::shall;
        attribute :>> conditionClause = "When a prescription parameter is entered";
        attribute :>> systemResponse = "reject hard-limit violations and require confirmation of soft-limit violations";
    }
    requirement reqPost : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-X-02"; attribute :>> name = "PowerOnSelfTest";
        attribute :>> statement = "On power-up, the system shall complete a self test of CPU, memory, watchdog, and safety sensors before permitting therapy, and shall remain locked out of therapy if any check fails.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Failed POST inhibits all infusion modes and raises a High-priority notification.";
        attribute :>> subjectDescription = "System_Monitor and Top_Level_Mode";
        attribute :>> actorDescription = "clinician";
        attribute :>> assumptionSummary = "hardware supports built-in test";
        attribute :>> guaranteeSummary = "no therapy on a device that failed self test";
        attribute :>> sourceReference = "MEMO extension — POST is not specified by the CriSys source";
        attribute :>> notation = RequirementNotationKind::ears;
        attribute :>> earsPattern = EarsPatternKind::eventDriven;
        attribute :>> obligation = ObligationKind::shall;
        attribute :>> conditionClause = "On power-up";
        attribute :>> systemResponse = "complete POST before permitting therapy";
    }
    requirement reqPowerLossRetention : Requirement {
        attribute :>> requirementKind = RequirementKind::system;
        attribute :>> id = "REQ-X-03"; attribute :>> name = "PrescriptionRetainedAcrossPowerLoss";
        attribute :>> statement = "If all power is lost, the system shall retain the confirmed prescription and event log, and on power restoration shall resume therapy only after clinician confirmation.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Stored prescription checksum verifies after power cycle; therapy does not auto-resume. Retention durations remain governed by REQ-CS-85/86.";
        attribute :>> subjectDescription = "Config and Top_Level_Mode";
        attribute :>> actorDescription = "clinician";
        attribute :>> assumptionSummary = "non-volatile storage available";
        attribute :>> guaranteeSummary = "no silent loss or silent resumption of therapy";
        attribute :>> sourceReference = "MEMO extension — power-loss behavior is not specified by the CriSys source";
        attribute :>> notation = RequirementNotationKind::ears;
        attribute :>> earsPattern = EarsPatternKind::unwantedBehavior;
        attribute :>> obligation = ObligationKind::shall;
        attribute :>> conditionClause = "If all power is lost";
        attribute :>> systemResponse = "retain prescription and log; resume only after confirmation";
    }
    requirement reqOcclusion : Requirement {
        attribute :>> requirementKind = RequirementKind::software;
        attribute :>> id = "REQ-X-04"; attribute :>> name = "OcclusionDetectionAndAlarm";
        attribute :>> statement = "When downstream line pressure exceeds the occlusion threshold, the system shall pause infusion and raise a High-priority notification.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Occlusion above threshold pauses infusion within one execution step and annunciates. Complements REQ-CS-17 under-infusion detection with a direct pressure measurement.";
        attribute :>> subjectDescription = "Alarm and Infusion_Manager";
        attribute :>> actorDescription = "patient";
        attribute :>> assumptionSummary = "pressure sensor calibrated";
        attribute :>> guaranteeSummary = "no sustained pumping against a blocked line";
        attribute :>> sourceReference = "MEMO extension — occlusion sensing is not specified by the CriSys source (under-infusion flow rate, REQ-CS-17, is the source-level effect)";
    }
    requirement reqDoorOpen : Requirement {
        attribute :>> requirementKind = RequirementKind::software;
        attribute :>> id = "REQ-X-05"; attribute :>> name = "DoorOpenPreventsDelivery";
        attribute :>> statement = "While the reservoir door is open or unlatched, the system shall not deliver drug and shall raise a Medium-priority notification if therapy was active.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Flow command forced to zero whenever door state is open; notification raised on transition during ACTIVE.";
        attribute :>> subjectDescription = "Infusion_Manager";
        attribute :>> actorDescription = "clinician";
        attribute :>> assumptionSummary = "door sensor operational";
        attribute :>> guaranteeSummary = "no delivery with an unsecured fluid path";
        attribute :>> sourceReference = "MEMO extension — door interlock is not specified by the CriSys source";
        attribute :>> notation = RequirementNotationKind::ears;
        attribute :>> earsPattern = EarsPatternKind::stateDriven;
        attribute :>> obligation = ObligationKind::shall;
        attribute :>> conditionClause = "While the reservoir door is open";
        attribute :>> systemResponse = "inhibit delivery and notify if therapy was active";
    }
    requirement reqMaxHourlyDose : Requirement {
        attribute :>> requirementKind = RequirementKind::software;
        attribute :>> id = "REQ-X-06"; attribute :>> name = "MaximumHourlyDoseEnforcement";
        attribute :>> statement = "The system shall not deliver more than the prescribed maximum drug volume in any sliding one-hour window, counting basal, patient bolus, and square bolus contributions.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Cumulative delivered volume in every one-hour window is at or below the prescribed maximum. Complements the CriSys total-VTBI ceiling (REQ-CS-20, REQ-CS-28).";
        attribute :>> subjectDescription = "Infusion_Manager";
        attribute :>> actorDescription = "patient";
        attribute :>> assumptionSummary = "delivered volume measurable per step";
        attribute :>> guaranteeSummary = "hourly dose ceiling never exceeded";
        attribute :>> sourceReference = "MEMO extension — sliding-window hourly limit is not specified by the CriSys source";
    }
    requirement reqEventLogging : Requirement {
        attribute :>> requirementKind = RequirementKind::software;
        attribute :>> id = "REQ-X-07"; attribute :>> name = "TamperEvidentTherapyLog";
        attribute :>> statement = "The system shall record therapy events in a timestamped, tamper-evident event log such that any modification of recorded entries is detectable.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::regulatory;
        attribute :>> safetyClass = SafetyClassKind::B;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Modification of a stored log entry is detectable. Log content and cadence are governed by REQ-CS-77..81; retention by REQ-CS-85.";
        attribute :>> subjectDescription = "Logging";
        attribute :>> actorDescription = "clinician and auditor";
        attribute :>> assumptionSummary = "real-time clock available";
        attribute :>> guaranteeSummary = "log tampering cannot go unnoticed";
        attribute :>> sourceReference = "MEMO extension — tamper evidence is not specified by the CriSys source (log content: REQ-CS-77..81)";
    }
    requirement reqWatchdogSafeState : Requirement {
        attribute :>> requirementKind = RequirementKind::software;
        attribute :>> id = "REQ-X-08"; attribute :>> name = "WatchdogForcesSafeState";
        attribute :>> statement = "If the software fails to service the hardware watchdog within its timeout, the system shall force pump output to zero flow and raise a continuous audible alarm.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Induced CPU hang results in zero flow and alarm within the watchdog timeout.";
        attribute :>> subjectDescription = "System_Monitor and watchdog hardware";
        attribute :>> actorDescription = "clinician";
        attribute :>> assumptionSummary = "watchdog electrically independent of CPU";
        attribute :>> guaranteeSummary = "runaway software cannot keep pumping";
        attribute :>> sourceReference = "MEMO extension — watchdog behavior is not specified by the CriSys source";
        attribute :>> notation = RequirementNotationKind::ears;
        attribute :>> earsPattern = EarsPatternKind::unwantedBehavior;
        attribute :>> obligation = ObligationKind::shall;
        attribute :>> conditionClause = "If the watchdog is not serviced within its timeout";
        attribute :>> systemResponse = "force zero flow and continuous alarm";
    }
    requirement reqStuckButton : Requirement {
        attribute :>> requirementKind = RequirementKind::software;
        attribute :>> id = "REQ-X-09"; attribute :>> name = "StuckBolusButtonDetection";
        attribute :>> statement = "If the patient bolus button remains asserted for more than 60 seconds, the system shall treat the input as failed, ignore it, and raise a Medium-priority notification.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Continuous assertion beyond 60 s produces no bolus and raises a notification. Complements REQ-CS-25/26 request-level filtering with an input-failure check.";
        attribute :>> subjectDescription = "Infusion_Manager";
        attribute :>> actorDescription = "patient";
        attribute :>> assumptionSummary = "button sampled every step";
        attribute :>> guaranteeSummary = "a shorted pendant cannot request repeated boluses";
        attribute :>> sourceReference = "MEMO extension — stuck-input detection is not specified by the CriSys source";
    }
    requirement reqFlowCrossCheck : Requirement {
        attribute :>> requirementKind = RequirementKind::software;
        attribute :>> id = "REQ-X-10"; attribute :>> name = "CommandedVsMeasuredFlowCrossCheck";
        attribute :>> statement = "The system shall compare measured delivered flow against commanded flow using an independent flow sensor, and shall raise a High-priority notification and pause infusion when the deviation exceeds Tolerance_Min_const for more than Max_Duration_OverInfusion_const.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Injected flow deviation beyond Tolerance_Min_const (5 %) sustained past Max_Duration_OverInfusion_const pauses therapy and annunciates; detection is independent of motor control.";
        attribute :>> subjectDescription = "Alarm and Infusion_Manager";
        attribute :>> actorDescription = "patient";
        attribute :>> assumptionSummary = "independent flow sensor available";
        attribute :>> guaranteeSummary = "over- and under-infusion detected independently of motor control";
        attribute :>> sourceReference = "MEMO extension — independent cross-check channel beyond CriSys REQ-CS-17/19 tolerance monitoring; thresholds reuse App. A.4 constants";
    }
    requirement reqPumpAccuracy : Requirement {
        attribute :>> requirementKind = RequirementKind::hardware;
        attribute :>> id = "REQ-X-11"; attribute :>> name = "DeliveryAccuracy";
        attribute :>> statement = "The pump mechanism shall deliver programmed volumes with an accuracy of plus or minus Tolerance_Min_const (5 percent) over the full rate range, so that the system-level flow tolerances of REQ-CS-16 are achievable.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::performance;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Gravimetric bench test across min/nominal/max rates within ±5% (Tolerance_Min_const).";
        attribute :>> subjectDescription = "PumpMotorAssembly";
        attribute :>> actorDescription = "patient";
        attribute :>> assumptionSummary = "approved administration set used";
        attribute :>> guaranteeSummary = "dose accuracy within labeling";
        attribute :>> sourceReference = "MEMO extension — mechanism-level accuracy budget derived from App. A.4 Tolerance_Min_const";
        attribute :>> electricalSafetyRelevant = false;
    }
    requirement reqAlarmLoudness : Requirement {
        attribute :>> requirementKind = RequirementKind::hardware;
        attribute :>> id = "REQ-X-12"; attribute :>> name = "AlarmSoundPressureLevel";
        attribute :>> statement = "The audible annunciator shall produce notification tones at the sound level defined by Audio_level_const (50 db for 2 seconds per interface spec I 8), distinguishable by priority.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Calibrated SPL measurement meets Audio_level_const for each priority tone.";
        attribute :>> subjectDescription = "AudibleAlarmAnnunciator";
        attribute :>> actorDescription = "clinician";
        attribute :>> assumptionSummary = "ward ambient noise per IEC 60601-1-8 baseline";
        attribute :>> guaranteeSummary = "alarms audible at the ward station";
        attribute :>> sourceReference = "MEMO extension — hardware annunciator budget realizing CriSys I 8 / Audio_level_const";
        attribute :>> electricalSafetyRelevant = false;
    }
    requirement reqBatteryBackup : Requirement {
        attribute :>> requirementKind = RequirementKind::hardware;
        attribute :>> id = "REQ-X-13"; attribute :>> name = "BatteryBackupDuration";
        attribute :>> statement = "The battery shall sustain nominal therapy and alarm annunciation for at least 4 hours after loss of mains power.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::reliability;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Discharge test at nominal rate exceeds 4 h with low-battery warning at 30 min remaining.";
        attribute :>> subjectDescription = "BatteryPack";
        attribute :>> actorDescription = "clinician";
        attribute :>> assumptionSummary = "battery within service life";
        attribute :>> guaranteeSummary = "transport and outage continuity";
        attribute :>> sourceReference = "MEMO extension — power backup is not specified by the CriSys source";
        attribute :>> electricalSafetyRelevant = true;
    }
    requirement reqFreeFlowPrevention : Requirement {
        attribute :>> requirementKind = RequirementKind::hardware;
        attribute :>> id = "REQ-X-14"; attribute :>> name = "MechanicalFreeFlowPrevention";
        attribute :>> statement = "The fluid path shall include a mechanical anti-free-flow valve that blocks gravity flow whenever the administration set is disengaged from the pumping mechanism.";
        attribute :>> sourceKind = RequirementSourceKind::extension;
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "No measurable flow under gravity head with set disengaged and door open.";
        attribute :>> subjectDescription = "AntiFreeFlowValve";
        attribute :>> actorDescription = "patient";
        attribute :>> assumptionSummary = "approved administration set used";
        attribute :>> guaranteeSummary = "free-flow overdose mechanically impossible";
        attribute :>> sourceReference = "MEMO extension — mechanical free-flow protection is not specified by the CriSys source";
        attribute :>> electricalSafetyRelevant = false;
    }
}
