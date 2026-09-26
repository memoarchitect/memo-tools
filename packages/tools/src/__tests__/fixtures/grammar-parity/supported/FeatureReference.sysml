package FeatureReference {
    item def Alarm;
    part def Monitor;
    action def Notify {
        in alarm : Alarm;
        in monitor : Monitor;
        action tell send alarm to monitor;
    }
}
