package InterfaceDefinition {
    port def FuelPort;
    interface def FuelLine {
        end supply : FuelPort;
        end demand : ~FuelPort;
    }
}
