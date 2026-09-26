package PortUsageConjugatedType {
    port def FuelPort;
    part def Engine {
        port inlet : ~FuelPort;
    }
}
