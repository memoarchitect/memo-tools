package TransitionUsage {
    state def Mode;
    state machine : Mode {
        state idle : Mode;
        state running : Mode;
        transition begin first idle then running;
    }
}
