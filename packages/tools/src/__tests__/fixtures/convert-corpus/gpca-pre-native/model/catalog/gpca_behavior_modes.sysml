package memo_examples_gpca_pump_model_catalog_gpca_behavior_modes {
    private import ScalarValues::*;

    private import memo_architecture_functional_behavior::*;
    private import memo_core_enumerations::*;

    // ═════════════════════════════════════════════════════════════
    // GPCA mode machine per CriSys Ch.4 Fig 4.1 mode hierarchy:
    //   OFF, ON { IDLE, THERAPY { PAUSED, ACTIVE { BASAL,
    //   SQUARE BOLUS, PATIENT BOLUS } } }
    // Transitions mirror REQ 4/5/12/13/19-23/28-39/46/47.
    // PAUSED delivers KVO flow (REQ 43), not zero. Square boluses
    // auto-initiate on the prescribed schedule (REQ 24), with no
    // external trigger. Mode-tree containment edges (Composes)
    // live in gpca_trace.sysml.
    // Audit scope: this is a requirements-level therapy-mode abstraction, not
    // a full transcription of CITE-009's monolithic Stateflow chart. The
    // source chart also contains detailed Configuration, Alarms,
    // System_Monitor, Log, and Infusion_Manager state behavior that remains
    // outside this compact mode view.
    // ═════════════════════════════════════════════════════════════
    state topLevelModeMachine : StateMachine {
        attribute :>> id = "BM-001";
        attribute :>> name = "TopLevelModeMachine";
        attribute :>> machineKind = "hierarchical state machine";
        attribute :>> executionSemantics = "single-step synchronous; sub-modes inherit all parent-mode requirements";
        attribute fidelityScope = "Requirements-derived therapy mode hierarchy; partial abstraction of CITE-009, not a state-for-state Stateflow transcription";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1 Fig 4.1; CITE-009: CriSys PCA Pump Software Model";
    }

    // ── Mode states (Fig 4.1) ───────────────────────────────────
    state modeOFF : ModeState {
        attribute :>> id = "MODE-000";
        attribute :>> name = "OFF";
        attribute :>> modeKind = "top (default)";
        attribute :>> description = "No functionality; the GPCA is turned off. FlowRate_output = 0 (REQ 6).";
        attribute :>> entryCondition = "System_stop_prog commanded while ON (REQ 5); default mode";
        attribute :>> exitCondition = "System_start_prog commanded (REQ 4)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.2";
    }
    state modeON : ModeState {
        attribute :>> id = "MODE-001";
        attribute :>> name = "ON";
        attribute :>> modeKind = "operational parent";
        attribute :>> description = "Topmost operational mode: prescription configuration (REQ 8), infusion initiation gating (REQ 7, 9), notification (REQ 10) and logging (REQ 11) are available.";
        attribute :>> entryCondition = "System_start_prog from OFF; A.4 variables set to defaults (REQ 4)";
        attribute :>> exitCondition = "System_stop_prog: stop infusion, cancel all notifications (REQ 5)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3";
    }
    state modeIDLE : ModeState {
        attribute :>> id = "MODE-002";
        attribute :>> name = "ON.IDLE";
        attribute :>> modeKind = "idle";
        attribute :>> description = "Default sub-mode on entry to ON; no infusion, FlowRate_output = 0 (REQ 14); prescription set-up happens here. 'IDLE Time' actions after Max_IDLE_Duration_const (REQ 15).";
        attribute :>> entryCondition = "OFF -> ON transition (REQ 4); infusion complete (REQ 28); PAUSED inhibit (REQ 47)";
        attribute :>> exitCondition = "confirmed second Infusion_initiate_prog (REQ 12/13)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.4";
    }
    state modeTHERAPY : ModeState {
        attribute :>> id = "MODE-003";
        attribute :>> name = "ON.THERAPY";
        attribute :>> modeKind = "therapy parent";
        attribute :>> description = "Parent of all drug-delivering sub-modes. Delivers FlowRate_Mode_macro within Tolerance_Max_const (REQ 16); monitors under-infusion (REQ 17), low reservoir (REQ 18), over-infusion, VTBI, air, reverse delivery, empty reservoir (REQ 19-23).";
        attribute :>> entryCondition = "infusion initiated (REQ 12/13)";
        attribute :>> exitCondition = "infusion complete to IDLE (REQ 28); manual stop from PAUSED (REQ 47); system stop (REQ 5)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5";
    }
    state modePAUSED : ModeState {
        attribute :>> id = "MODE-004";
        attribute :>> name = "ON.THERAPY.PAUSED";
        attribute :>> modeKind = "paused (KVO delivery)";
        attribute :>> description = "Infusion paused by notification actions or manual inhibit. FlowRate_Mode_macro = FlowRate_kvo_hd — keep-vein-open flow within Tolerance_Max_const, NOT zero (REQ 43). 'PAUSED Time' actions after Max_PAUSED_Duration_const (REQ 44). Infusion_initiate_prog while Inhibited_Infusion_macro = TRUE causes no transition (REQ 45).";
        attribute :>> entryCondition = "REQ 19-23 alarm transitions, REQ 29 manual inhibit, REQ 30 all-inhibited, REQ 37-39 sub-mode inhibits, REQ 13 initiate-while-inhibited";
        attribute :>> exitCondition = "Infusion_initiate_prog with Inhibited_Infusion_macro = FALSE (REQ 46); Infusion_inhibit_prog to IDLE (REQ 47)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.10 (REQ 43-47)";
    }
    state modeACTIVE : ModeState {
        attribute :>> id = "MODE-005";
        attribute :>> name = "ON.THERAPY.ACTIVE";
        attribute :>> modeKind = "active parent";
        attribute :>> description = "Actual infusion through BASAL, SQUARE BOLUS or PATIENT BOLUS. Only mode where a patient bolus may be requested (REQ 25). Square boluses are scheduled automatically every Interval_sbolus_prog for Duration_sbolus_prog (REQ 24). Actual_Infusion_Duration_macro accumulates here.";
        attribute :>> entryCondition = "infusion initiated (REQ 12) or resumed (REQ 46)";
        attribute :>> exitCondition = "infusion complete (REQ 28); PAUSED via REQ 29/30/37-39";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6";
    }
    state modeBASAL : ModeState {
        attribute :>> id = "MODE-006";
        attribute :>> name = "ON.THERAPY.ACTIVE.BASAL";
        attribute :>> modeKind = "active-basal";
        attribute :>> description = "Constant-rate delivery at FlowRate_basal_prog within Tolerance_Max_const (REQ 40). FlowRate_Mode_macro = FlowRate_basal_prog.";
        attribute :>> entryCondition = "infusion initiated/resumed (REQ 12/46); square bolus ended (REQ 34); patient bolus ended (REQ 35)";
        attribute :>> exitCondition = "scheduled square bolus (REQ 31); patient bolus granted (REQ 32); Inhibited_Infusion_macro (REQ 37)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.7";
    }
    state modeSQUARE : ModeState {
        attribute :>> id = "MODE-007";
        attribute :>> name = "ON.THERAPY.ACTIVE.SQUARE_BOLUS";
        attribute :>> modeKind = "active-square-bolus (auto-scheduled)";
        attribute :>> description = "Prescribed extra delivery at FlowRate_sbolus_prog within Tolerance_Max_const (REQ 41). Auto-initiates at the prescribed frequency and ends after the prescribed duration — no external trigger (§4.1.8, REQ 24). FlowRate_Mode_macro = FlowRate_sbolus_prog.";
        attribute :>> entryCondition = "scheduled start per REQ 24 with REQ 31 guards; patient bolus end with square scheduled (REQ 36)";
        attribute :>> exitCondition = "scheduled end or Inhibited_Bolus_macro (REQ 34); patient bolus granted (REQ 33); inhibits (REQ 39)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.8";
    }
    state modePBOLUS : ModeState {
        attribute :>> id = "MODE-008";
        attribute :>> name = "ON.THERAPY.ACTIVE.PATIENT_BOLUS";
        attribute :>> modeKind = "active-patient-bolus";
        attribute :>> description = "Patient-requested delivery at FlowRate_pbolus_prog within Tolerance_Max_const (REQ 42). Granted only when no REQ 25 ignore condition holds. FlowRate_Mode_macro = FlowRate_pbolus_prog.";
        attribute :>> entryCondition = "BolusRequest_prog with no REQ 25 ignore condition (REQ 32/33)";
        attribute :>> exitCondition = "Inhibited_PatientBolus_macro or duration >= Duration_pbolus_prog (REQ 35/36); inhibits (REQ 38)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.9";
    }

    // ── Mode transitions (CriSys §4.1, 1:1 with source REQs) ────
    part trSystemStart : Transition {
        attribute :>> id = "TR-001"; attribute :>> name = "SystemStartToIdle";
        attribute :>> sourceState = "OFF"; attribute :>> targetState = "ON.IDLE";
        attribute :>> trigger = "System_start_prog commanded";
        attribute :>> guardSummary = "none in source (MEMO extension REQ-X-02 additionally gates therapy on POST)";
        attribute :>> effectSummary = "A.4 variables set to default values (REQ 4)";
        attribute :>> priority = 1;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.1.2 (REQ 4)";
    }
    part trSystemStop : Transition {
        attribute :>> id = "TR-002"; attribute :>> name = "SystemStopToOff";
        attribute :>> sourceState = "ON"; attribute :>> targetState = "OFF";
        attribute :>> trigger = "System_stop_prog commanded";
        attribute :>> guardSummary = "none — allowed from any ON sub-mode";
        attribute :>> effectSummary = "stop infusion, cancel all notifications (REQ 5)";
        attribute :>> priority = 1;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.1.2 (REQ 5)";
    }
    part trStartTherapy : Transition {
        attribute :>> id = "TR-003"; attribute :>> name = "ConfirmedInitiateToBasal";
        attribute :>> sourceState = "ON.IDLE"; attribute :>> targetState = "ON.THERAPY.ACTIVE.BASAL";
        attribute :>> trigger = "second Infusion_initiate_prog (confirmation per REQ 9)";
        attribute :>> guardSummary = "Inhibited_Infusion_macro = FALSE; saved prescription available (REQ 7)";
        attribute :>> effectSummary = "Actual_Infusion_Duration_macro = 0; Actual_Volume_Infused_macro = 0 (REQ 12)";
        attribute :>> priority = 2;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3.2 (REQ 12)";
    }
    part trInitiateWhileInhibited : Transition {
        attribute :>> id = "TR-004"; attribute :>> name = "ConfirmedInitiateWhileInhibitedToPaused";
        attribute :>> sourceState = "ON.IDLE"; attribute :>> targetState = "ON.THERAPY.PAUSED";
        attribute :>> trigger = "second Infusion_initiate_prog (confirmation per REQ 9)";
        attribute :>> guardSummary = "Inhibited_Infusion_macro = TRUE";
        attribute :>> effectSummary = "macros reset; 'Infusion Inhibited' actions per REQ 59 (REQ 13)";
        attribute :>> priority = 2;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.3.2 (REQ 13)";
    }
    part trAlarmPause : Transition {
        attribute :>> id = "TR-005"; attribute :>> name = "TherapyAlarmToPausedKvo";
        attribute :>> sourceState = "ON.THERAPY"; attribute :>> targetState = "ON.THERAPY.PAUSED";
        attribute :>> trigger = "over-infusion flow rate (REQ 19), over-infusion VTBI (REQ 20), air embolism (REQ 21), reverse delivery (REQ 22), or empty reservoir (REQ 23) condition";
        attribute :>> guardSummary = "none — unconditional from any THERAPY sub-mode";
        attribute :>> effectSummary = "REQ 59 actions for the notification; PAUSED delivers FlowRate_kvo_hd keep-vein-open flow (REQ 43), not zero";
        attribute :>> priority = 1;
        attribute :>> sameStepCritical = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.5.2 (REQ 19-23)";
    }
    part trInfusionComplete : Transition {
        attribute :>> id = "TR-006"; attribute :>> name = "InfusionCompleteToIdle";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE"; attribute :>> targetState = "ON.IDLE";
        attribute :>> trigger = "Actual_Infusion_Duration_macro >= Duration_total_prog OR Actual_Volume_Infused_macro >= VTBI_total_prog";
        attribute :>> guardSummary = "none";
        attribute :>> effectSummary = "'Infusion Complete' actions per REQ 59; completion record in operational log (REQ 79)";
        attribute :>> priority = 2;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 28)";
    }
    part trManualInhibit : Transition {
        attribute :>> id = "TR-007"; attribute :>> name = "ManualInhibitToPaused";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE"; attribute :>> targetState = "ON.THERAPY.PAUSED";
        attribute :>> trigger = "Infusion_inhibit_prog commanded";
        attribute :>> guardSummary = "none";
        attribute :>> effectSummary = "'Infusion Manually Inhibited' actions per REQ 59";
        attribute :>> priority = 2;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 29)";
    }
    part trAllInhibited : Transition {
        attribute :>> id = "TR-008"; attribute :>> name = "AllInhibitedToPaused";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE"; attribute :>> targetState = "ON.THERAPY.PAUSED";
        attribute :>> trigger = "Inhibited_Infusion_macro AND Inhibited_Bolus_macro AND Inhibited_PatientBolus_macro all TRUE";
        attribute :>> guardSummary = "none";
        attribute :>> effectSummary = "therapy paused at KVO flow";
        attribute :>> priority = 1;
        attribute :>> sameStepCritical = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 30)";
    }
    part trSquareBolus : Transition {
        attribute :>> id = "TR-009"; attribute :>> name = "ScheduledSquareBolusStart";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE.BASAL"; attribute :>> targetState = "ON.THERAPY.ACTIVE.SQUARE_BOLUS";
        attribute :>> trigger = "scheduled SQUARE BOLUS start — auto-initiates every Interval_sbolus_prog for Duration_sbolus_prog during Duration_total_prog (REQ 24); no external trigger";
        attribute :>> guardSummary = "Inhibited_Bolus_macro = FALSE AND Inhibited_Infusion_macro = FALSE AND (no BolusRequest_prog OR a REQ 25 ignore condition holds)";
        attribute :>> effectSummary = "FlowRate_Mode_macro = FlowRate_sbolus_prog";
        attribute :>> priority = 3;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 31) and §4.1.6.1 (REQ 24)";
    }
    part trPatientBolus : Transition {
        attribute :>> id = "TR-010"; attribute :>> name = "BasalToPatientBolus";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE.BASAL"; attribute :>> targetState = "ON.THERAPY.ACTIVE.PATIENT_BOLUS";
        attribute :>> trigger = "BolusRequest_prog";
        attribute :>> guardSummary = "none of the REQ 25 ignore conditions hold (inhibits, lockout, bolus count, already in PATIENT BOLUS)";
        attribute :>> effectSummary = "FlowRate_Mode_macro = FlowRate_pbolus_prog";
        attribute :>> priority = 3;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 32)";
    }
    part trSquareToPatientBolus : Transition {
        attribute :>> id = "TR-011"; attribute :>> name = "SquareBolusToPatientBolus";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE.SQUARE_BOLUS"; attribute :>> targetState = "ON.THERAPY.ACTIVE.PATIENT_BOLUS";
        attribute :>> trigger = "BolusRequest_prog";
        attribute :>> guardSummary = "none of the REQ 25 ignore conditions hold";
        attribute :>> effectSummary = "patient bolus interrupts the square bolus; FlowRate_Mode_macro = FlowRate_pbolus_prog";
        attribute :>> priority = 3;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 33)";
    }
    part trSquareToBasal : Transition {
        attribute :>> id = "TR-012"; attribute :>> name = "SquareBolusEndToBasal";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE.SQUARE_BOLUS"; attribute :>> targetState = "ON.THERAPY.ACTIVE.BASAL";
        attribute :>> trigger = "Inhibited_Bolus_macro = TRUE or scheduled square bolus end (REQ 24)";
        attribute :>> guardSummary = "Inhibited_Infusion_macro = FALSE AND (no BolusRequest_prog OR a REQ 25 ignore condition holds)";
        attribute :>> effectSummary = "FlowRate_Mode_macro = FlowRate_basal_prog";
        attribute :>> priority = 3;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 34)";
    }
    part trPatientBolusToBasal : Transition {
        attribute :>> id = "TR-013"; attribute :>> name = "PatientBolusEndToBasal";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE.PATIENT_BOLUS"; attribute :>> targetState = "ON.THERAPY.ACTIVE.BASAL";
        attribute :>> trigger = "Inhibited_PatientBolus_macro = TRUE or patient-bolus duration >= Duration_pbolus_prog";
        attribute :>> guardSummary = "Inhibited_Infusion_macro = FALSE AND (no square bolus scheduled in progress OR (square bolus scheduled AND Inhibited_Bolus_macro = TRUE))";
        attribute :>> effectSummary = "patient bolus delivery stopped; FlowRate_Mode_macro = FlowRate_basal_prog";
        attribute :>> priority = 3;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 35)";
    }
    part trPatientBolusToSquare : Transition {
        attribute :>> id = "TR-014"; attribute :>> name = "PatientBolusEndToSquareBolus";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE.PATIENT_BOLUS"; attribute :>> targetState = "ON.THERAPY.ACTIVE.SQUARE_BOLUS";
        attribute :>> trigger = "Inhibited_PatientBolus_macro = TRUE or patient-bolus duration >= Duration_pbolus_prog";
        attribute :>> guardSummary = "Inhibited_Infusion_macro = FALSE AND a square bolus is scheduled to be in progress AND Inhibited_Bolus_macro = FALSE";
        attribute :>> effectSummary = "patient bolus delivery stopped; scheduled square bolus resumes";
        attribute :>> priority = 3;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 36)";
    }
    part trBasalInhibit : Transition {
        attribute :>> id = "TR-015"; attribute :>> name = "BasalInhibitToPaused";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE.BASAL"; attribute :>> targetState = "ON.THERAPY.PAUSED";
        attribute :>> trigger = "Inhibited_Infusion_macro = TRUE";
        attribute :>> guardSummary = "none";
        attribute :>> effectSummary = "therapy paused at KVO flow";
        attribute :>> priority = 1;
        attribute :>> sameStepCritical = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 37)";
    }
    part trPatientBolusInhibit : Transition {
        attribute :>> id = "TR-016"; attribute :>> name = "PatientBolusInhibitToPaused";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE.PATIENT_BOLUS"; attribute :>> targetState = "ON.THERAPY.PAUSED";
        attribute :>> trigger = "Inhibited_PatientBolus_macro = TRUE AND Inhibited_Infusion_macro = TRUE";
        attribute :>> guardSummary = "none";
        attribute :>> effectSummary = "therapy paused at KVO flow";
        attribute :>> priority = 1;
        attribute :>> sameStepCritical = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 38)";
    }
    part trSquareInhibit : Transition {
        attribute :>> id = "TR-017"; attribute :>> name = "SquareBolusInhibitToPaused";
        attribute :>> sourceState = "ON.THERAPY.ACTIVE.SQUARE_BOLUS"; attribute :>> targetState = "ON.THERAPY.PAUSED";
        attribute :>> trigger = "Inhibited_Bolus_macro = TRUE AND Inhibited_Infusion_macro = TRUE";
        attribute :>> guardSummary = "none";
        attribute :>> effectSummary = "therapy paused at KVO flow";
        attribute :>> priority = 1;
        attribute :>> sameStepCritical = true;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.6.2 (REQ 39)";
    }
    part trResume : Transition {
        attribute :>> id = "TR-018"; attribute :>> name = "PausedResumeToBasal";
        attribute :>> sourceState = "ON.THERAPY.PAUSED"; attribute :>> targetState = "ON.THERAPY.ACTIVE.BASAL";
        attribute :>> trigger = "Infusion_initiate_prog";
        attribute :>> guardSummary = "Inhibited_Infusion_macro = FALSE (while TRUE, no transition occurs — REQ 45)";
        attribute :>> effectSummary = "basal flow re-established";
        attribute :>> priority = 2;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.10.2 (REQ 46)";
    }
    part trPausedStop : Transition {
        attribute :>> id = "TR-019"; attribute :>> name = "PausedInhibitToIdle";
        attribute :>> sourceState = "ON.THERAPY.PAUSED"; attribute :>> targetState = "ON.IDLE";
        attribute :>> trigger = "Infusion_inhibit_prog commanded";
        attribute :>> guardSummary = "none";
        attribute :>> effectSummary = "'Infusion Stopped Manually' actions per REQ 59";
        attribute :>> priority = 2;
        attribute :>> sameStepCritical = false;
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.10.2 (REQ 47)";
    }

    // ── Behavior properties and timing constraints ──────────────
    part propAlarmStopsSameStep : BehaviorProperty {
        attribute :>> id = "BP-002";
        attribute :>> name = "AlarmResponseSameStepKvo";
        attribute :>> propertyKind = BehaviorPropertyKind::safetyProperty;
        attribute :>> languageKind = PropertyLanguageKind::pseudoFormal;
        attribute :>> formalExpression = "ALARM.ALARM_OUT -> IM.ALARM_IN is an AADL immediate connection: when an infusion-inhibiting notification asserts, Infusion_Manager limits Commanded_Flow_Rate <= FlowRate_kvo_hd in the same execution step";
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, GPCA_SW.aadl (ALARM_to_IM immediate) and AGREE flow <= KVO guarantees";
    }
    part propPausedNoResumeWhileInhibited : BehaviorProperty {
        attribute :>> id = "BP-004";
        attribute :>> name = "PausedNoTransitionWhileInhibited";
        attribute :>> propertyKind = BehaviorPropertyKind::stateInvariant;
        attribute :>> languageKind = PropertyLanguageKind::pseudoFormal;
        attribute :>> formalExpression = "in PAUSED: Infusion_initiate_prog AND Inhibited_Infusion_macro = TRUE => mode unchanged";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.10.1 (REQ 45)";
    }
    part propModeTimeoutActions : BehaviorProperty {
        attribute :>> id = "BP-005";
        attribute :>> name = "IdleAndPausedTimeoutActions";
        attribute :>> propertyKind = BehaviorPropertyKind::transitionRule;
        attribute :>> languageKind = PropertyLanguageKind::pseudoFormal;
        attribute :>> formalExpression = "time in IDLE > Max_IDLE_Duration_const => REQ 59 'IDLE Time' actions; time in PAUSED > Max_PAUSED_Duration_const => REQ 59 'PAUSED Time' actions (notification actions, not mode transitions)";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §4.1.4.1 (REQ 15) and §4.1.10.1 (REQ 44)";
    }
    part propLockoutTimerMonotonic : BehaviorProperty {
        attribute :>> id = "BP-003";
        attribute :>> name = "LockoutTimerNeverShortened";
        attribute :>> propertyKind = BehaviorPropertyKind::stateInvariant;
        attribute :>> languageKind = PropertyLanguageKind::pseudoFormal;
        attribute :>> formalExpression = "lockout_remaining decreases only with elapsed time; no input path resets it early";
        attribute :>> sourceReference = "MEMO extension — supports the REQ 25.3 lockout ignore condition; invariant not stated by the source";
    }
    part tcAlarmLatency : TimingConstraint {
        attribute :>> id = "TC-001";
        attribute :>> name = "AlarmToSafeStateLatency";
        attribute :>> constraintKind = TimingConstraintKind::latency;
        attribute :>> minMs = "0";
        attribute :>> maxMs = "20";
        attribute :>> referenceElement = "FC-002: AlarmDetectionToSafeStateChain";
        attribute :>> verificationMethod = VerificationMethodKind::modelChecking;
        attribute :>> sourceReference = "MEMO extension — illustrative wall-clock budget; the source specifies synchronous same-step (immediate) semantics with no timing figures";
    }
    part tcBolusResponse : TimingConstraint {
        attribute :>> id = "TC-002";
        attribute :>> name = "BolusRequestResponseLatency";
        attribute :>> constraintKind = TimingConstraintKind::latency;
        attribute :>> minMs = "0";
        attribute :>> maxMs = "100";
        attribute :>> referenceElement = "FC-001: PatientBolusChain";
        attribute :>> verificationMethod = VerificationMethodKind::test;
        attribute :>> sourceReference = "MEMO extension — illustrative wall-clock budget; not specified by the source";
    }
    part tcWatchdogTimeout : TimingConstraint {
        attribute :>> id = "TC-003";
        attribute :>> name = "WatchdogTimeout";
        attribute :>> constraintKind = TimingConstraintKind::deadline;
        attribute :>> minMs = "40";
        attribute :>> maxMs = "60";
        attribute :>> referenceElement = "REQ-X-08: WatchdogForcesSafeState";
        attribute :>> verificationMethod = VerificationMethodKind::test;
        attribute :>> sourceReference = "MEMO extension — supports extension requirement REQ-X-08; watchdog not specified by the source";
    }
}
