package memo_examples_gpca_pump_model_catalog_gpca_formal_behavior {
    private import ScalarValues::*;

    private import memo_architecture_functional_behavior::*;
    private import memo_core_enumerations::*;

    // ═════════════════════════════════════════════════════════════
    // Formal assume/guarantee properties translated 1:1 from the
    // CriSys AADL AGREE annexes (GPCA_SW.aadl composite contract;
    // CITE-002) and the compositional verification package
    // (CITE-003). Alarm responses bound flow to FlowRate_KVO —
    // keep-vein-open — except empty reservoir, where the source
    // guarantees zero flow.
    // ═════════════════════════════════════════════════════════════
    part gpcaSwContract : Contract {
        attribute :>> id = "CTR-000";
        attribute :>> name = "GpcaSwCompositeContract";
        attribute :>> contractScope = "GPCA_SW (composite, verified compositionally over the 8 subcomponents)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex";
    }
    part topLevelContract : Contract {
        attribute :>> id = "CTR-001";
        attribute :>> name = "TopLevelModeContract";
        attribute :>> contractScope = "Top_Level_Mode";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, Top_Level_Mode.aadl AGREE annex";
    }
    part infusionManagerContract : Contract {
        attribute :>> id = "CTR-002";
        attribute :>> name = "InfusionManagerContract";
        attribute :>> contractScope = "Infusion_Manager";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, Infusion_Manager.aadl AGREE annex";
    }
    part alarmContract : Contract {
        attribute :>> id = "CTR-003";
        attribute :>> name = "AlarmContract";
        attribute :>> contractScope = "Alarm";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, Alarm.aadl AGREE annex";
    }

    // ── Assumptions (GPCA_SW.aadl) ──────────────────────────────
    part assumeVtbiHighPositive : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::assumption;
        attribute :>> id = "AP-002";
        attribute :>> name = "VtbiHighPositive";
        attribute :>> propertyKind = BehaviorPropertyKind::assumption;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "assume DB_IN.VTBI_High > 0";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex";
    }
    part assumeEmptyReservoirPositive : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::assumption;
        attribute :>> id = "AP-003";
        attribute :>> name = "EmptyReservoirConstPositive";
        attribute :>> propertyKind = BehaviorPropertyKind::assumption;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "assume CONST_IN.Empty_Reservoir > 0";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex";
    }
    part assumeValidPrescriptionSaved : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::assumption;
        attribute :>> id = "AP-001";
        attribute :>> name = "ValidPrescriptionSavedBeforeTherapy";
        attribute :>> propertyKind = BehaviorPropertyKind::assumption;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "assume a saved prescription is available before infusion initiation";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3.1 (REQ 7)";
    }

    // ── Guarantees (GPCA_SW.aadl AGREE annex, 1:1) ──────────────
    part guaranteeExclusiveMode : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-001";
        attribute :>> name = "ModeRange";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee mode_range: GPCA_SW_OUT.Current_System_Mode in {0, 1, 2, 3, 4, 6, 7, 8} (source enumeration omits 5)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex (REQ 1)";
    }
    part guaranteeOffMode : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-004";
        attribute :>> name = "NotStartImpliesModeZero";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee not(OP_CMD_IN.System_Start) => GPCA_SW_OUT.Current_System_Mode = 0";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex";
    }
    part guaranteeInitialStart : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-005";
        attribute :>> name = "InitialSystemStartImpliesModeOne";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee sys_initial and OP_CMD_IN.System_Start => GPCA_SW_OUT.Current_System_Mode = 1";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex (REQ 4 allocation: TLM System_Start -> System_On; IM System_On -> mode 1)";
    }
    part guaranteeOffToOn : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-006";
        attribute :>> name = "OffToOnImpliesModeOne";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee not(sys_initial) and pre(GPCA_SW_OUT.Current_System_Mode) = 0 and OP_CMD_IN.System_Start => GPCA_SW_OUT.Current_System_Mode = 1";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex (REQ 4)";
    }
    part guaranteeEmptyReservoirNoFlow : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-007";
        attribute :>> name = "EmptyReservoirImpliesNoFlow";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee (OP_CMD_IN.System_Start and pre(Current_System_Mode) > 1 and GPCA_SW_OUT.Reservoir_Volume < CONST_IN.Empty_Reservoir) => GPCA_SW_OUT.Commanded_Flow_Rate = 0";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex (REQ 59 'Empty Reservoir')";
    }
    part guaranteeVtbiKvo : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-008";
        attribute :>> name = "OverVtbiImpliesFlowAtMostKvo";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee (OP_CMD_IN.System_Start and pre(Current_System_Mode) > 1 and GPCA_SW_OUT.Volume_Infused > DB_IN.VTBI_High) => GPCA_SW_OUT.Commanded_Flow_Rate <= GPCA_SW_OUT.Flow_Rate_KVO";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex (over-infusion => keep-vein-open, not zero)";
    }
    part guaranteeAirInLineKvo : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-009";
        attribute :>> name = "AirInLineImpliesFlowAtMostKvo";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee (OP_CMD_IN.System_Start and SENSOR_IN.Air_In_Line) => GPCA_SW_OUT.Commanded_Flow_Rate <= GPCA_SW_OUT.Flow_Rate_KVO";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex (REQ 21 'Air embolism')";
    }
    part guaranteeOcclusionKvo : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-010";
        attribute :>> name = "OcclusionImpliesFlowAtMostKvo";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee (OP_CMD_IN.System_Start and SENSOR_IN.Occlusion) => GPCA_SW_OUT.Commanded_Flow_Rate <= GPCA_SW_OUT.Flow_Rate_KVO";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex";
    }
    part guaranteeDoorOpenKvo : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-011";
        attribute :>> name = "DoorOpenImpliesFlowAtMostKvo";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee (OP_CMD_IN.System_Start and SENSOR_IN.Door_Open) => GPCA_SW_OUT.Commanded_Flow_Rate <= GPCA_SW_OUT.Flow_Rate_KVO";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl AGREE annex";
    }
    part guaranteeAlarmStopsSameStep : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-003";
        attribute :>> name = "SameStepAlarmKvoGuarantee";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee an infusion-inhibiting notification in a step implies Commanded_Flow_Rate <= Flow_Rate_KVO in the same step (ALARM_OUT -> IM.ALARM_IN is an immediate connection)";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl (ALARM_to_IM immediate) with the flow <= KVO guarantees above";
    }
    part guaranteeLockoutPreventsBolus : BehaviorProperty {
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> id = "GP-002";
        attribute :>> name = "LockoutGuarantee";
        attribute :>> propertyKind = BehaviorPropertyKind::guarantee;
        attribute :>> languageKind = PropertyLanguageKind::agreeLike;
        attribute :>> formalExpression = "guarantee a BolusRequest_prog inside the LockOutPeriod_pbolus_prog window is ignored and no PATIENT BOLUS is initiated";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.1 (REQ 25.3, REQ 26)";
    }

    // ── Temporal properties over the mode machine ───────────────
    part temporalNoInvalidTransition : BehaviorProperty {
        attribute :>> id = "BP-010";
        attribute :>> name = "NoInvalidTransition";
        attribute :>> propertyKind = BehaviorPropertyKind::temporalProperty;
        attribute :>> languageKind = PropertyLanguageKind::ltlLike;
        attribute :>> formalExpression = "G(mode transitions follow only the edges of the Fig 4.1 hierarchy as constrained by REQ 4-5, 12-13, 19-23, 28-39, 46-47)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1 Fig 4.1";
    }
    part temporalPauseOnCriticalAlarm : BehaviorProperty {
        attribute :>> id = "BP-011";
        attribute :>> name = "PauseAtKvoOnInhibitingNotification";
        attribute :>> propertyKind = BehaviorPropertyKind::safetyProperty;
        attribute :>> languageKind = PropertyLanguageKind::ltlLike;
        attribute :>> formalExpression = "G(infusion_inhibiting_notification -> X (mode = PAUSED and Commanded_Flow_Rate <= Flow_Rate_KVO))";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5.2 (REQ 19-23) and §4.1.10.1 (REQ 43)";
    }
}
