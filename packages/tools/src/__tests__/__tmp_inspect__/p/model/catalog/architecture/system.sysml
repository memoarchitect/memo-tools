package project_architecture {
    private import memo::*;

    part system : MemoPart {
        @MemoIdentity { :>> label = "p"; }
    }

    action def ProjectAction;
}
