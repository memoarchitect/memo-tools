package FlowEnd {
    item def Water;
    action def Fill { out water : Water; }
    action def Drain { in water : Water; }
    action def Cycle {
        action fill : Fill;
        action drain : Drain;
        flow of Water from fill.water to drain.water;
    }
}
