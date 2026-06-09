/**
 * Data Classification and Residency Enforcement
 *
 * Defines data classification levels, jurisdiction policies, and residency validation
 * for the AFG Enterprise AI/ML Banking Platform.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */
/**
 * Supported jurisdictions where AFG operates data planes.
 */
export type Jurisdiction = 'IN' | 'SG' | 'AE' | 'GB' | 'US';
/**
 * Data classification levels as per AFG's data governance framework.
 *
 * - Restricted: PAN, Aadhaar, biometrics → jurisdiction-locked, BYOK, field-level encryption
 * - Confidential: Account balances, txn history → jurisdiction-locked, BYOK, volume-level encryption
 * - Internal: Model metrics, feature values → regional, platform-managed encryption
 * - Public: Product catalogues, rates → any region, transit-only encryption
 */
export declare enum DataClassification {
    /** PAN, Aadhaar, biometrics — jurisdiction-locked, BYOK, field-level encryption */
    Restricted = "RESTRICTED",
    /** Account balances, transaction history — jurisdiction-locked, BYOK, volume-level encryption */
    Confidential = "CONFIDENTIAL",
    /** Model metrics, feature values — regional, platform-managed encryption */
    Internal = "INTERNAL",
    /** Product catalogues, rates — any region, transit-only encryption */
    Public = "PUBLIC"
}
/**
 * Encryption strategy required for a given data classification.
 */
export type EncryptionStrategy = 'BYOK_FIELD_LEVEL' | 'BYOK_VOLUME_LEVEL' | 'PLATFORM_MANAGED' | 'TRANSIT_ONLY';
/**
 * Types of data operations that residency validation applies to.
 */
export type DataOperationType = 'STORAGE' | 'PROCESSING' | 'INFERENCE';
/**
 * Requirements for cross-border data movement.
 * Restricted and Confidential data require both anonymisation AND DPO approval.
 */
export interface CrossBorderRequirements {
    /** Whether data anonymisation is required before cross-border movement */
    readonly anonymisationRequired: boolean;
    /** Whether Data Protection Officer approval is required */
    readonly dpoApprovalRequired: boolean;
}
/**
 * Classification residency rule within a JurisdictionPolicy.
 * Defines how data of a given classification must be handled in a jurisdiction.
 */
export interface ClassificationResidencyRule {
    /** The data classification this rule applies to */
    readonly classification: DataClassification;
    /** Whether data must stay within the jurisdiction (jurisdiction-locked) */
    readonly jurisdictionLocked: boolean;
    /** The encryption strategy required */
    readonly encryptionStrategy: EncryptionStrategy;
    /** Requirements for cross-border movement (if allowed at all) */
    readonly crossBorderRequirements: CrossBorderRequirements;
}
/**
 * Defines the data residency policy for a specific jurisdiction.
 * Enforces what data classifications are allowed, what encryption is required,
 * and what cross-border movement rules apply.
 *
 * Requirements: 16.1-16.6
 */
export interface JurisdictionPolicy {
    /** The jurisdiction this policy applies to */
    readonly jurisdiction: Jurisdiction;
    /** Human-readable name (e.g., "India", "Singapore") */
    readonly name: string;
    /** The regulatory framework governing this jurisdiction */
    readonly regulatoryFramework: string;
    /** Residency rules per data classification */
    readonly classificationRules: readonly ClassificationResidencyRule[];
    /** Whether this jurisdiction has a separate data plane */
    readonly separateDataPlane: boolean;
}
/**
 * Input to the residency validator describing the operation being requested.
 */
export interface ResidencyValidationRequest {
    /** The type of operation (storage, processing, inference) */
    readonly operationType: DataOperationType;
    /** The data classification of the data involved */
    readonly dataClassification: DataClassification;
    /** The jurisdiction where the operation would execute */
    readonly targetJurisdiction: Jurisdiction;
    /** The customer's assigned home jurisdiction */
    readonly customerJurisdiction: Jurisdiction;
    /** Whether the data has been anonymised */
    readonly isAnonymised?: boolean;
    /** Whether DPO approval has been obtained */
    readonly hasDpoApproval?: boolean;
}
/**
 * Result of residency validation.
 */
export interface ResidencyValidationResult {
    /** Whether the operation is allowed */
    readonly allowed: boolean;
    /** Reason for denial (if not allowed) */
    readonly reason?: string;
    /** If cross-border movement could be allowed with additional steps */
    readonly crossBorderRequirements?: CrossBorderRequirements;
}
/**
 * Default jurisdiction policies for all five AFG regions.
 */
export declare const DEFAULT_JURISDICTION_POLICIES: ReadonlyMap<Jurisdiction, JurisdictionPolicy>;
/**
 * Validates whether a data operation is permitted given the data classification,
 * target jurisdiction, and customer's assigned jurisdiction.
 *
 * Enforcement rules:
 * 1. Restricted and Confidential data must stay jurisdiction-locked (same as customer jurisdiction)
 * 2. Internal data must stay within the same region (jurisdiction)
 * 3. Public data can go anywhere
 * 4. Cross-border movement of Restricted/Confidential requires anonymisation AND DPO approval
 * 5. No customer PII crosses jurisdictional boundaries without anonymisation
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */
export declare class ResidencyValidator {
    private readonly policies;
    constructor(policies?: ReadonlyMap<Jurisdiction, JurisdictionPolicy>);
    /**
     * Validates whether the requested data operation is allowed.
     */
    validate(request: ResidencyValidationRequest): ResidencyValidationResult;
    /**
     * Convenience method: checks if an operation is allowed and throws if not.
     */
    enforce(request: ResidencyValidationRequest): void;
    /**
     * Returns the jurisdiction policy for a given jurisdiction.
     */
    getPolicy(jurisdiction: Jurisdiction): JurisdictionPolicy | undefined;
}
/**
 * Error thrown when a data residency violation is detected.
 */
export declare class DataResidencyViolationError extends Error {
    readonly request: ResidencyValidationRequest;
    constructor(message: string, request: ResidencyValidationRequest);
}
//# sourceMappingURL=data-classification.d.ts.map