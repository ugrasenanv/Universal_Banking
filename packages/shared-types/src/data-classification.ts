/**
 * Data Classification and Residency Enforcement
 *
 * Defines data classification levels, jurisdiction policies, and residency validation
 * for the AFG Enterprise AI/ML Banking Platform.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */

// ─── Jurisdiction ───────────────────────────────────────────────────────────────

/**
 * Supported jurisdictions where AFG operates data planes.
 */
export type Jurisdiction = 'IN' | 'SG' | 'AE' | 'GB' | 'US';

// ─── Data Classification ────────────────────────────────────────────────────────

/**
 * Data classification levels as per AFG's data governance framework.
 *
 * - Restricted: PAN, Aadhaar, biometrics → jurisdiction-locked, BYOK, field-level encryption
 * - Confidential: Account balances, txn history → jurisdiction-locked, BYOK, volume-level encryption
 * - Internal: Model metrics, feature values → regional, platform-managed encryption
 * - Public: Product catalogues, rates → any region, transit-only encryption
 */
export enum DataClassification {
  /** PAN, Aadhaar, biometrics — jurisdiction-locked, BYOK, field-level encryption */
  Restricted = 'RESTRICTED',
  /** Account balances, transaction history — jurisdiction-locked, BYOK, volume-level encryption */
  Confidential = 'CONFIDENTIAL',
  /** Model metrics, feature values — regional, platform-managed encryption */
  Internal = 'INTERNAL',
  /** Product catalogues, rates — any region, transit-only encryption */
  Public = 'PUBLIC',
}

// ─── Encryption Requirements ────────────────────────────────────────────────────

/**
 * Encryption strategy required for a given data classification.
 */
export type EncryptionStrategy = 'BYOK_FIELD_LEVEL' | 'BYOK_VOLUME_LEVEL' | 'PLATFORM_MANAGED' | 'TRANSIT_ONLY';

// ─── Data Operation Types ───────────────────────────────────────────────────────

/**
 * Types of data operations that residency validation applies to.
 */
export type DataOperationType = 'STORAGE' | 'PROCESSING' | 'INFERENCE';

// ─── Cross-Border Movement ──────────────────────────────────────────────────────

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

// ─── Jurisdiction Policy ────────────────────────────────────────────────────────

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

// ─── Residency Validation ───────────────────────────────────────────────────────

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

// ─── Default Jurisdiction Policies ──────────────────────────────────────────────

/**
 * Creates the default classification residency rules applicable to all AFG jurisdictions.
 * - Restricted & Confidential: jurisdiction-locked
 * - Internal: regional (same jurisdiction)
 * - Public: any region
 */
function createDefaultClassificationRules(): readonly ClassificationResidencyRule[] {
  return [
    {
      classification: DataClassification.Restricted,
      jurisdictionLocked: true,
      encryptionStrategy: 'BYOK_FIELD_LEVEL',
      crossBorderRequirements: {
        anonymisationRequired: true,
        dpoApprovalRequired: true,
      },
    },
    {
      classification: DataClassification.Confidential,
      jurisdictionLocked: true,
      encryptionStrategy: 'BYOK_VOLUME_LEVEL',
      crossBorderRequirements: {
        anonymisationRequired: true,
        dpoApprovalRequired: true,
      },
    },
    {
      classification: DataClassification.Internal,
      jurisdictionLocked: true,
      encryptionStrategy: 'PLATFORM_MANAGED',
      crossBorderRequirements: {
        anonymisationRequired: false,
        dpoApprovalRequired: false,
      },
    },
    {
      classification: DataClassification.Public,
      jurisdictionLocked: false,
      encryptionStrategy: 'TRANSIT_ONLY',
      crossBorderRequirements: {
        anonymisationRequired: false,
        dpoApprovalRequired: false,
      },
    },
  ] as const;
}

/**
 * Default jurisdiction policies for all five AFG regions.
 */
export const DEFAULT_JURISDICTION_POLICIES: ReadonlyMap<Jurisdiction, JurisdictionPolicy> = new Map<Jurisdiction, JurisdictionPolicy>([
  ['IN', {
    jurisdiction: 'IN',
    name: 'India',
    regulatoryFramework: 'RBI / DPDP Act',
    classificationRules: createDefaultClassificationRules(),
    separateDataPlane: true,
  }],
  ['SG', {
    jurisdiction: 'SG',
    name: 'Singapore',
    regulatoryFramework: 'MAS',
    classificationRules: createDefaultClassificationRules(),
    separateDataPlane: true,
  }],
  ['AE', {
    jurisdiction: 'AE',
    name: 'UAE (DIFC)',
    regulatoryFramework: 'DFSA / UAE PDPL',
    classificationRules: createDefaultClassificationRules(),
    separateDataPlane: true,
  }],
  ['GB', {
    jurisdiction: 'GB',
    name: 'United Kingdom',
    regulatoryFramework: 'FCA / PRA / GDPR',
    classificationRules: createDefaultClassificationRules(),
    separateDataPlane: true,
  }],
  ['US', {
    jurisdiction: 'US',
    name: 'United States',
    regulatoryFramework: 'OCC / FRB',
    classificationRules: createDefaultClassificationRules(),
    separateDataPlane: true,
  }],
]);

// ─── Residency Validator ────────────────────────────────────────────────────────

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
export class ResidencyValidator {
  private readonly policies: ReadonlyMap<Jurisdiction, JurisdictionPolicy>;

  constructor(policies?: ReadonlyMap<Jurisdiction, JurisdictionPolicy>) {
    this.policies = policies ?? DEFAULT_JURISDICTION_POLICIES;
  }

  /**
   * Validates whether the requested data operation is allowed.
   */
  validate(request: ResidencyValidationRequest): ResidencyValidationResult {
    const {
      dataClassification,
      targetJurisdiction,
      customerJurisdiction,
      isAnonymised = false,
      hasDpoApproval = false,
    } = request;

    const policy = this.policies.get(customerJurisdiction);
    if (!policy) {
      return {
        allowed: false,
        reason: `No jurisdiction policy defined for customer jurisdiction: ${customerJurisdiction}`,
      };
    }

    const rule = policy.classificationRules.find(
      (r) => r.classification === dataClassification
    );
    if (!rule) {
      return {
        allowed: false,
        reason: `No classification rule defined for ${dataClassification} in jurisdiction ${customerJurisdiction}`,
      };
    }

    // Same jurisdiction — always allowed
    if (targetJurisdiction === customerJurisdiction) {
      return { allowed: true };
    }

    // Cross-border scenario
    if (rule.jurisdictionLocked) {
      // Restricted and Confidential data is jurisdiction-locked
      // Cross-border is only possible with anonymisation AND DPO approval
      if (dataClassification === DataClassification.Restricted || dataClassification === DataClassification.Confidential) {
        if (isAnonymised && hasDpoApproval) {
          return { allowed: true };
        }

        return {
          allowed: false,
          reason: `${dataClassification} data is jurisdiction-locked to ${customerJurisdiction}. ` +
            `Cross-border movement to ${targetJurisdiction} requires both anonymisation and DPO approval.`,
          crossBorderRequirements: rule.crossBorderRequirements,
        };
      }

      // Internal data: jurisdiction-locked but no special cross-border allowance
      if (dataClassification === DataClassification.Internal) {
        return {
          allowed: false,
          reason: `${dataClassification} data must remain within jurisdiction ${customerJurisdiction}. ` +
            `Cannot process in ${targetJurisdiction}.`,
        };
      }
    }

    // Public data — allowed anywhere
    return { allowed: true };
  }

  /**
   * Convenience method: checks if an operation is allowed and throws if not.
   */
  enforce(request: ResidencyValidationRequest): void {
    const result = this.validate(request);
    if (!result.allowed) {
      throw new DataResidencyViolationError(result.reason ?? 'Data residency violation', request);
    }
  }

  /**
   * Returns the jurisdiction policy for a given jurisdiction.
   */
  getPolicy(jurisdiction: Jurisdiction): JurisdictionPolicy | undefined {
    return this.policies.get(jurisdiction);
  }
}

// ─── Error Types ────────────────────────────────────────────────────────────────

/**
 * Error thrown when a data residency violation is detected.
 */
export class DataResidencyViolationError extends Error {
  readonly request: ResidencyValidationRequest;

  constructor(message: string, request: ResidencyValidationRequest) {
    super(message);
    this.name = 'DataResidencyViolationError';
    this.request = request;
  }
}
