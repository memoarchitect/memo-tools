package Lib {
    private import ScalarValues::*;
    enum def Level { enum low; enum high; }
    metadata def Tag { attribute label : String; }
    part def Element { attribute label : String; attribute weight : Real; attribute critical : Boolean; attribute level : Level; attribute kinds : String[*] nonunique; }
    part def Component :> Element;
    connection def Link { end part source : Element; end part target : Element; }
}
package Model {
    private import Lib::*;
    part pump : Component {
        attribute :>> label = "Pump";
        attribute :>> weight = 2.5;
        attribute :>> critical = true;
        attribute :>> level = Level::high;
        attribute :>> kinds = ("a", "b", "a");
        @Tag { :>> label = "tagged"; }
        part motor : Element;
    }
    part controller : Element;
    connection : Link connect source ::> controller to target ::> pump.motor;
}
