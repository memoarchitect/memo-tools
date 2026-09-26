package StakeholderMember {
    part def Clinician;
    part def Pump;
    concern def Safety {
        subject pump : Pump;
        stakeholder clinician : Clinician;
    }
}
