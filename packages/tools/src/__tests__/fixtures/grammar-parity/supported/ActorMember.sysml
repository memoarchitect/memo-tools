package ActorMember {
    part def Customer;
    part def Shop;
    use case def PlaceOrder {
        subject shop : Shop;
        actor buyer : Customer;
    }
}
