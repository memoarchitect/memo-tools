package IncludeUseCaseUsage {
    use case def Pay;
    use case def PlaceOrder {
        include use case pay : Pay;
    }
}
