package IfNode {
    action def Alarm;
    action def Check {
        if true {
            action alarm : Alarm;
        }
    }
}
