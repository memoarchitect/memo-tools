package FramedConcernMember {
    concern def Safety;
    viewpoint def SafetyView {
        frame concern safety : Safety;
    }
}
