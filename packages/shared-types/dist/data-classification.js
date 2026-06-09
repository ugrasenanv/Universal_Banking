"use strict";
/**
 * Data Classification and Residency Enforcement
 *
 * Defines data classification levels, jurisdiction policies, and residency validation
 * for the AFG Enterprise AI/ML Banking Platform.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataResidencyViolationError = exports.ResidencyValidator = exports.DEFAULT_JURISDICTION_POLICIES = exports.DataClassification = void 0;
// ─── Data Classification ────────────────────────────────────────────────────────
/**
 * Data classification levels as per AFG's data governance framework.
 *
 * - Restricted: PAN, Aadhaar, biometrics → jurisdiction-locked, BYOK, field-level encryption
 * - Confidential: Account balances, txn history → jurisdiction-locked, BYOK, volume-level encryption
 * - Internal: Model metrics, feature values → regional, platform-managed encryption
 * - Public: Product catalogues, rates → any region, transit-only encryption
 */
var DataClassification;
(function (DataClassification) {
    /** PAN, Aadhaar, biometrics — jurisdiction-locked, BYOK, field-level encryption */
    DataClassification["Restricted"] = "RESTRICTED";
    /** Account balances, transaction history — jurisdiction-locked, BYOK, volume-level encryption */
    DataClassification["Confidential"] = "CONFIDENTIAL";
    /** Model metrics, feature values — regional, platform-managed encryption */
    DataClassification["Internal"] = "INTERNAL";
    /** Product catalogues, rates — any region, transit-only encryption */
    DataClassification["Public"] = "PUBLIC";
})(DataClassification || (exports.DataClassification = DataClassification = {}));
// ─── Default Jurisdiction Policies ──────────────────────────────────────────────
/**
 * Creates the default classification residency rules applicable to all AFG jurisdictions.
 * - Restricted & Confidential: jurisdiction-locked
 * - Internal: regional (same jurisdiction)
 * - Public: any region
 */
function createDefaultClassificationRules() {
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
    ];
}
/**
 * Default jurisdiction policies for all five AFG regions.
 */
exports.DEFAULT_JURISDICTION_POLICIES = new Map([
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
class ResidencyValidator {
    policies;
    constructor(policies) {
        this.policies = policies ?? exports.DEFAULT_JURISDICTION_POLICIES;
    }
    /**
     * Validates whether the requested data operation is allowed.
     */
    validate(request) {
        const { dataClassification, targetJurisdiction, customerJurisdiction, isAnonymised = false, hasDpoApproval = false, } = request;
        const policy = this.policies.get(customerJurisdiction);
        if (!policy) {
            return {
                allowed: false,
                reason: `No jurisdiction policy defined for customer jurisdiction: ${customerJurisdiction}`,
            };
        }
        const rule = policy.classificationRules.find((r) => r.classification === dataClassification);
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
    enforce(request) {
        const result = this.validate(request);
        if (!result.allowed) {
            throw new DataResidencyViolationError(result.reason ?? 'Data residency violation', request);
        }
    }
    /**
     * Returns the jurisdiction policy for a given jurisdiction.
     */
    getPolicy(jurisdiction) {
        return this.policies.get(jurisdiction);
    }
}
exports.ResidencyValidator = ResidencyValidator;
// ─── Error Types ────────────────────────────────────────────────────────────────
/**
 * Error thrown when a data residency violation is detected.
 */
class DataResidencyViolationError extends Error {
    request;
    constructor(message, request) {
        super(message);
        this.name = 'DataResidencyViolationError';
        this.request = request;
    }
}
exports.DataResidencyViolationError = DataResidencyViolationError;
//# sourceMappingURL=data-classification.js.map