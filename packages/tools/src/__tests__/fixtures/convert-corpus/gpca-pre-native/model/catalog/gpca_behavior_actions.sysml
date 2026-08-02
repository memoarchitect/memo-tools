package memo_examples_gpca_pump_model_catalog_gpca_behavior_actions {
    private import ScalarValues::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_architecture::*;

    private import memo_architecture_functional_behavior::*;
    private import memo_architecture_logical_interfaces::*;
    private import memo_core_enumerations::*;

    // ═════════════════════════════════════════════════════════════
    // GPCA infusion delivery action flow (KK-4 exemplar).
    // The 20 ms execution-step pipeline from sensor acquisition
    // through alarm evaluation and dose limiting to pump actuation
    // and event logging — the behavioral realization of FC-001/
    // FC-002 over FUNC-001..008. Item types reference the exchange
    // item definitions in gpca_behavior_subsystems (DD-002/DD-003,
    // CD-001/CD-002, DD-004).
    // ═════════════════════════════════════════════════════════════

    // ── Action definitions (typed steps with parameters) ────────
    item def SensorStatusVector specializes InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
    }
    item def AlarmSignal specializes InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::signal;
    }
    item def BolusRequestSignal specializes InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::signal;
    }
    item def FlowCommand specializes InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::command;
    }
    item def TherapyEventRecord specializes InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::'event';
    }

    action def AcquireSensorData {
        out sensorStatus : SensorStatusVector;
    }
    action def EvaluateAlarmConditions {
        in sensorStatus : SensorStatusVector;
        out alarmSignal : AlarmSignal;
    }
    action def EnforceDoseLimits {
        in bolusRequest : BolusRequestSignal;
        out authorizedBolus : BolusRequestSignal;
    }
    action def ComputeFlowCommand {
        in alarmSignal : AlarmSignal;
        in authorizedBolus : BolusRequestSignal;
        out flowCommand : FlowCommand;
    }
    action def ActuatePumpMotor {
        in flowCommand : FlowCommand;
        out actuation : FlowCommand;
    }
    action def LogTherapyEvent {
        in actuation : FlowCommand;
        out eventRecord : TherapyEventRecord;
    }

    // ── Infusion delivery flow (composite action) ───────────────
    action infusionDeliveryFlow {
        action acquireSensors : AcquireSensorData;
        action evaluateAlarms : EvaluateAlarmConditions;
        action enforceLimits : EnforceDoseLimits;
        action computeFlow : ComputeFlowCommand;
        action actuateMotor : ActuatePumpMotor;
        action logEvent : LogTherapyEvent;

        flow of SensorStatusVector from acquireSensors.sensorStatus to evaluateAlarms.sensorStatus;
        flow of AlarmSignal from evaluateAlarms.alarmSignal to computeFlow.alarmSignal;
        flow of BolusRequestSignal from enforceLimits.authorizedBolus to computeFlow.authorizedBolus;
        flow of FlowCommand from computeFlow.flowCommand to actuateMotor.flowCommand;
        flow of FlowCommand from actuateMotor.actuation to logEvent.actuation;

        first start then acquireSensors;
        first acquireSensors then evaluateAlarms;
        first evaluateAlarms then computeFlow;
        first enforceLimits then computeFlow;
        first computeFlow then actuateMotor;
        first actuateMotor then logEvent;
        first logEvent then done;
    }

    // ── Swimlane allocation to the logical architecture ─────────
    allocate infusionDeliveryFlow.acquireSensors to gpcaDeviceSensors;
    allocate infusionDeliveryFlow.evaluateAlarms to alarm;
    allocate infusionDeliveryFlow.enforceLimits to infusionMgr;
    allocate infusionDeliveryFlow.computeFlow to infusionMgr;
    allocate infusionDeliveryFlow.actuateMotor to pumpMotorAssembly;
    allocate infusionDeliveryFlow.logEvent to logging;
}
