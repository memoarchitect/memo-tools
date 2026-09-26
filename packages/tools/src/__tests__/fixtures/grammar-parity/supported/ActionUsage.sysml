package ActionUsage {
    action def Heat;
    action def Brew {
        action heat : Heat;
    }
}
