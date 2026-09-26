package ConnectionUsageInDefinitionBody {
    part def Node;
    connection def Link {
        end a : Node;
        end b : Node;
    }
    part def Network {
        part left : Node;
        part right : Node;
        connection wire : Link connect left to right;
    }
}
