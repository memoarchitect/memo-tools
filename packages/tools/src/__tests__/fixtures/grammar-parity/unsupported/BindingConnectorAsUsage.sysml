package BindingConnectorAsUsage {
    port def CmdPort;
    part def Motor { port pIn : CmdPort; }
    part def Device {
        port pCmd : CmdPort;
        part motor : Motor;
        binding cmdToMotor bind pCmd = motor.pIn;
    }
}
