package RequirementVerificationMember {
    requirement def Latency;
    requirement fastResponse : Latency;
    verification def LatencyTest {
        objective {
            verify fastResponse;
        }
    }
}
