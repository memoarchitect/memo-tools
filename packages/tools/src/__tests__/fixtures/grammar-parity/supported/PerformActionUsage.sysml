package PerformActionUsage {
    action def Brew;
    action brewing : Brew;
    part def Machine {
        perform brewing;
    }
}
