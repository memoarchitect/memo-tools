package ImportDeclarationLibrary {
    part def Pump;
}
package ImportDeclaration {
    private import ImportDeclarationLibrary::*;
    part def BoosterPump :> Pump;
}
