package SatisfyRequirementUsage {
    requirement def Latency;
    requirement fastResponse : Latency;
    part def Pump;
    part pump : Pump;
    satisfy fastResponse by pump;
}
