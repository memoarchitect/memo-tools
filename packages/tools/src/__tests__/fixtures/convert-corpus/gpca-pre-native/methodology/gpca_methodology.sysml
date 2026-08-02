package memo_examples_gpca_pump_methodology_gpca_methodology {
    private import ScalarValues::*;

    private import memo_methodology_profiles::*;
    private import memo_examples_gpca_pump_methodology_gpca_profiles::*;
    private import memo_core_relationships::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_requirements::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_architecture::*;

    connection : ResolvesToMethodology connect boundModelElement ::> tlm to resolvedMethodology ::> gpcaMethodResolved;
}
