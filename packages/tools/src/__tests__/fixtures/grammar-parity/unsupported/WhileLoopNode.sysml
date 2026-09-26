package WhileLoopNode {
    action def Tick;
    action def Run {
        while true {
            action tick : Tick;
        }
    }
}
