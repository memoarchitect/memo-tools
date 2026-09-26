package ViewUsage {
    view def Overview;
    part def Pump;
    part pump : Pump;
    view overview : Overview {
        expose pump;
    }
}
