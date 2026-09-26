package PartDefinition {
    abstract part def Vehicle;
    part def Car :> Vehicle {
        attribute wheels = 4;
    }
}
