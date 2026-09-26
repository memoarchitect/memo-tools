package AssertConstraintUsage {
    constraint def Limit;
    part def Pump {
        assert constraint withinLimit : Limit;
    }
}
