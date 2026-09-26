package InterfaceUsageInDefinitionBody {
    port def FuelPort;
    interface def FuelLine {
        end supply : FuelPort;
        end demand : FuelPort;
    }
    part def Tank { port outlet : FuelPort; }
    part def Engine { port inlet : FuelPort; }
    part def Car {
        part tank : Tank;
        part engine : Engine;
        interface fuel : FuelLine connect tank.outlet to engine.inlet;
    }
}
