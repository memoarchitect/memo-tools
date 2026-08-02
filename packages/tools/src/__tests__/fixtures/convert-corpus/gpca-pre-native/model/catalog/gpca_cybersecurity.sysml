package memo_examples_gpca_pump_model_catalog_gpca_cybersecurity {
    private import ScalarValues::*;

    private import memo_assurance_cybersecurity::*;
    private import memo_assurance_requirements::*;
    private import memo_assurance_safety_risk::*;
    private import memo_assurance_verification_validation::*;
    private import memo_core_enumerations::*;
    private import memo_core_relationships::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_architecture::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_risk::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_requirements::*;
    private import memo_examples_gpca_pump_model_catalog_gpca_verification::*;

    part therapyConfigurationAsset : CybersecurityAsset {
        attribute :>> id = "AST-CYB-001";
        attribute :>> name = "TherapyConfigurationAsset";
        attribute :>> assetKind = AssetKind::configuration;
        attribute :>> confidentialityNeed = "medium";
        attribute :>> integrityNeed = "very high";
        attribute :>> availabilityNeed = "high";
        attribute :>> privacyRelevant = false;
        attribute :>> safetyRelevant = true;
        attribute :>> owningLayer = "software_structure";
    }

    part patientEventLogAsset : CybersecurityAsset {
        attribute :>> id = "AST-CYB-002";
        attribute :>> name = "PatientEventLogAsset";
        attribute :>> assetKind = AssetKind::auditRecord;
        attribute :>> confidentialityNeed = "high";
        attribute :>> integrityNeed = "high";
        attribute :>> availabilityNeed = "medium";
        attribute :>> privacyRelevant = true;
        attribute :>> safetyRelevant = false;
        attribute :>> owningLayer = "software_structure";
    }

    part maintenancePortBoundary : TrustBoundary {
        attribute :>> id = "TB-001";
        attribute :>> name = "MaintenancePortBoundary";
        attribute :>> boundaryType = "service-access";
        attribute :>> crossingConstraint = "Boundary between service tooling and therapy controller runtime.";
        attribute :>> trustAssumption = "Service tooling on the untrusted side requires authentication before any crossing is permitted.";
    }

    part unauthorizedConfigChangeThreat : Threat {
        attribute :>> id = "TH-001";
        attribute :>> name = "UnauthorizedTherapyConfigurationChange";
        attribute :>> driverKind = "cybersecurity";
        attribute :>> threatCategory = ThreatCategoryKind::tampering;
        attribute :>> attackVector = "maintenance port";
        attribute :>> threatSource = "unauthorized actor with local access";
        attribute :>> precondition = "maintenance interface exposed without strong authentication";
        attribute :>> affectedConcern = ConcernKind::cybersecurity;
        attribute :>> defaultTechnique = "STRIDE tampering";
    }

    part eventLogTamperingThreat : Threat {
        attribute :>> id = "TH-002";
        attribute :>> name = "PatientEventLogTampering";
        attribute :>> driverKind = "cybersecurity";
        attribute :>> threatCategory = ThreatCategoryKind::repudiation;
        attribute :>> attackVector = "maintenance port";
        attribute :>> threatSource = "unauthorized actor with local access";
        attribute :>> precondition = "audit log writable without integrity protection";
        attribute :>> affectedConcern = ConcernKind::cybersecurity;
        attribute :>> defaultTechnique = "STRIDE repudiation";
    }

    part weakServiceAuthentication : Vulnerability {
        attribute :>> id = "VULN-001";
        attribute :>> name = "WeakServiceAuthentication";
        attribute :>> weakness = "service mode relies on shared default credential";
        attribute :>> exploitability = "moderate";
        attribute :>> discoveryMethod = "architecture review";
        attribute :>> affectedLayer = "software_structure";
        attribute :>> cweReference = "CWE-798";
    }

    action tamperedConfigurationScenario : ThreatScenario {
        attribute :>> id = "SCN-001";
        attribute :>> name = "TamperedTherapyConfigurationScenario";
        attribute :>> description = "An attacker with local access to the maintenance port alters lockout or dose parameters, aiming to bypass safety limits; may enable unsafe therapy delivery or bypass safeguards.";
        attribute :>> actorDescription = "unauthorized actor with local access to the maintenance port";
        attribute :>> defaultCategory = ThreatCategoryKind::tampering;
    }

    part unsafeDoseCyberHazard : CyberHazard {
        attribute :>> id = "CHZ-001";
        attribute :>> name = "UnsafeTherapyConfigurationHazard";
        attribute :>> hazardType = HazardTypeKind::drugDeliveryError;
        attribute :>> foreseeable = true;
        attribute :>> securityImpact = "loss of configuration integrity";
        attribute :>> safetyImpact = "unsafe dose delivery";
        attribute :>> privacyImpact = "none";
        attribute :>> operationalImpact = "therapy interruption or unsafe continuation";
    }

    part configurationTamperingRisk : CyberRisk {
        attribute :>> id = "CRISK-001";
        attribute :>> name = "ConfigurationTamperingRisk";
        attribute :>> driverKind = "cyber risk";
        attribute :>> probabilityEstimate = ProbabilityKind::occasional;
        attribute :>> severityEstimate = SeverityKind::catastrophic;
        attribute :>> riskLevel = CriticalityKind::high;
        attribute :>> acceptability = RiskAcceptabilityKind::unacceptable;
        attribute :>> exploitabilityEstimate = "moderate";
        attribute :>> detectability = DetectionKind::low;
        attribute :>> attackComplexity = "moderate with local access";
        attribute :>> patientSafetyContribution = "Potential overdose if therapy limits are changed.";
    }

    part strongServiceAuthentication : CyberMitigation {
        attribute :>> id = "CMIT-001";
        attribute :>> name = "StrongServiceAuthenticationAndAudit";
        attribute :>> controlKind = RiskControlKind::protectiveMeasure;
        attribute :>> implementationKind = RiskControlImplementationKind::softwareDesign;
        attribute :>> verificationStatus = "planned";
        attribute :>> cyberControlKind = CyberControlKind::authentication;
        attribute :>> securityMechanism = "authenticate, authorize, audit";
        attribute :>> verificationExpectation = "verify only authenticated and integrity-protected configuration changes are accepted";
    }

    requirement reqAuthenticatedServiceAccess : SecurityRequirement {
        attribute :>> id = "SREQ-001";
        attribute :>> name = "AuthenticatedServiceAccess";
        attribute :>> statement = "The system shall require authenticated and authorized service access before any therapy configuration parameter can be modified.";
        attribute :>> sourceKind = RequirementSourceKind::risk;
        attribute :>> concernKind = ConcernKind::cybersecurity;
        attribute :>> requirementStatus = RequirementStatusKind::approved;
        attribute :>> acceptanceCriteria = "Unauthenticated or unauthorized attempts to modify therapy configuration are rejected and logged.";
        attribute :>> subjectDescription = "maintenance and configuration path";
        attribute :>> actorDescription = "service personnel";
        attribute :>> assumptionSummary = "cryptographic identity available";
        attribute :>> guaranteeSummary = "only authorized service access can change therapy configuration";
        attribute :>> securityObjective = "integrity";
        attribute :>> derivedFromThreat = "TH-001";
        attribute :>> defaultConcern = ConcernKind::cybersecurity;
        attribute :>> safetyClass = SafetyClassKind::C;
    }

    verification vcAuthenticatedServiceAccess : VerificationCase {
        attribute :>> id = "CVER-001";
        attribute :>> name = "VerifyAuthenticatedServiceAccess";
        attribute :>> methodKind = VerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "Only authenticated and authorized service sessions may modify therapy configuration; all attempts are logged.";
        attribute :>> status = "planned";
    }

    connection : ThreatenedBy connect protectedAsset ::> therapyConfigurationAsset to realizedThreat ::> unauthorizedConfigChangeThreat;

    connection : ThreatenedBy connect protectedAsset ::> patientEventLogAsset to realizedThreat ::> eventLogTamperingThreat;

    connection : Exploits connect realizedThreat ::> unauthorizedConfigChangeThreat to enablingVulnerability ::> weakServiceAuthentication;

    connection : RealizedByScenario connect realizedThreat ::> unauthorizedConfigChangeThreat to scenario ::> tamperedConfigurationScenario;

    connection : Mitigates { attribute :>> mitigationKind = MitigationKind::vulnerability; connect control ::> strongServiceAuthentication to mitigatedElement ::> weakServiceAuthentication; }

    connection : DerivesCyberRequirement connect sourceThreatOrRisk ::> unauthorizedConfigChangeThreat to targetRequirement ::> reqAuthenticatedServiceAccess;

    connection : DerivesCyberRequirement connect sourceThreatOrRisk ::> eventLogTamperingThreat to targetRequirement ::> reqAuthenticatedServiceAccess;

    connection : ImpactsSafety connect cyberElement ::> configurationTamperingRisk to safetyElement ::> riskBefore;

    connection : CrossesTrustBoundary connect boundary ::> maintenancePortBoundary to crossingItem ::> therapyConfigurationAsset;

    connection : VerifiedBy connect verificationTarget ::> reqAuthenticatedServiceAccess to verificationCase ::> vcAuthenticatedServiceAccess;

    connection : ProducesEvidence connect producer ::> vcAuthenticatedServiceAccess to producedEvidence ::> evidenceLockout;
}
