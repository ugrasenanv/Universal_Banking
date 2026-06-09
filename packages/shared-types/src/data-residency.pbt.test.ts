/**
 * Property-Based Test: Data Residency Enforcement (Property 9)
 *
 * For any data operation (storage, processing, inference) involving customer data,
 * the operation SHALL execute exclusively within the customer's assigned jurisdictional
 * boundary, and no customer PII SHALL cross jurisdictional boundaries without
 * anonymisation and documented DPO approval.
 *
 * **Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.7, 8.6, 28.4**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  DataClassification,
  ResidencyValidator,
  DataResidencyViolationError,
  type Jurisdiction,
  type DataOperationType,
  type ResidencyValidationRequest,
} from './data-classification.js';

// ─── Generators ─────────────────────────────────────────────────────────────────

const jurisdictionArb: fc.Arbitrary<Jurisdiction> = fc.constantFrom('IN', 'SG', 'AE', 'GB', 'US');

const dataClassificationArb: fc.Arbitrary<DataClassification> = fc.constantFrom(
  DataClassification.Restricted,
  DataClassification.Confidential,
  DataClassification.Internal,
  DataClassification.Public
);

const operationTypeArb: fc.Arbitrary<DataOperationType> = fc.constantFrom(
  'STORAGE',
  'PROCESSING',
  'INFERENCE'
);

/** Generates a pair of jurisdictions that are guaranteed to be different. */
const crossBorderJurisdictionsArb: fc.Arbitrary<{ customer: Jurisdiction; target: Jurisdiction }> =
  fc.tuple(jurisdictionArb, jurisdictionArb).filter(([a, b]) => a !== b).map(([customer, target]) => ({ customer, target }));

/** Generates an approval state: anonymised and/or DPO approval flags. */
const approvalStateArb: fc.Arbitrary<{ isAnonymised: boolean; hasDpoApproval: boolean }> =
  fc.record({
    isAnonymised: fc.boolean(),
    hasDpoApproval: fc.boolean(),
  });

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('Property 9: Data Residency Enforcement', () => {
  const validator = new ResidencyValidator();

  describe('Property 9.1: Jurisdiction-locked data stays in jurisdiction', () => {
    it('Restricted and Confidential data operations in the same jurisdiction are always allowed', () => {
      fc.assert(
        fc.property(
          jurisdictionArb,
          operationTypeArb,
          fc.constantFrom(DataClassification.Restricted, DataClassification.Confidential),
          (jurisdiction, operationType, classification) => {
            const result = validator.validate({
              operationType,
              dataClassification: classification,
              targetJurisdiction: jurisdiction,
              customerJurisdiction: jurisdiction,
            });

            expect(result.allowed).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Property 9.2: Cross-border blocked without approval', () => {
    it('Restricted/Confidential data cross-border is rejected without both anonymisation AND DPO approval', () => {
      fc.assert(
        fc.property(
          crossBorderJurisdictionsArb,
          operationTypeArb,
          fc.constantFrom(DataClassification.Restricted, DataClassification.Confidential),
          approvalStateArb.filter(({ isAnonymised, hasDpoApproval }) => !(isAnonymised && hasDpoApproval)),
          (jurisdictions, operationType, classification, approval) => {
            const result = validator.validate({
              operationType,
              dataClassification: classification,
              targetJurisdiction: jurisdictions.target,
              customerJurisdiction: jurisdictions.customer,
              isAnonymised: approval.isAnonymised,
              hasDpoApproval: approval.hasDpoApproval,
            });

            expect(result.allowed).toBe(false);
            expect(result.reason).toBeDefined();
            expect(result.reason).toContain('jurisdiction-locked');
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Property 9.3: Cross-border allowed with anonymisation + DPO approval', () => {
    it('Restricted/Confidential data cross-border is permitted when anonymised AND DPO-approved', () => {
      fc.assert(
        fc.property(
          crossBorderJurisdictionsArb,
          operationTypeArb,
          fc.constantFrom(DataClassification.Restricted, DataClassification.Confidential),
          (jurisdictions, operationType, classification) => {
            const result = validator.validate({
              operationType,
              dataClassification: classification,
              targetJurisdiction: jurisdictions.target,
              customerJurisdiction: jurisdictions.customer,
              isAnonymised: true,
              hasDpoApproval: true,
            });

            expect(result.allowed).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Property 9.4: Public data freely movable', () => {
    it('Public data can be processed in any jurisdiction regardless of customer jurisdiction', () => {
      fc.assert(
        fc.property(
          jurisdictionArb,
          jurisdictionArb,
          operationTypeArb,
          approvalStateArb,
          (customerJurisdiction, targetJurisdiction, operationType, approval) => {
            const result = validator.validate({
              operationType,
              dataClassification: DataClassification.Public,
              targetJurisdiction,
              customerJurisdiction,
              isAnonymised: approval.isAnonymised,
              hasDpoApproval: approval.hasDpoApproval,
            });

            expect(result.allowed).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Property 9.5: Internal data stays regional', () => {
    it('Internal data is allowed within the same jurisdiction', () => {
      fc.assert(
        fc.property(
          jurisdictionArb,
          operationTypeArb,
          (jurisdiction, operationType) => {
            const result = validator.validate({
              operationType,
              dataClassification: DataClassification.Internal,
              targetJurisdiction: jurisdiction,
              customerJurisdiction: jurisdiction,
            });

            expect(result.allowed).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('Internal data is rejected when crossing jurisdictional boundaries', () => {
      fc.assert(
        fc.property(
          crossBorderJurisdictionsArb,
          operationTypeArb,
          (jurisdictions, operationType) => {
            const result = validator.validate({
              operationType,
              dataClassification: DataClassification.Internal,
              targetJurisdiction: jurisdictions.target,
              customerJurisdiction: jurisdictions.customer,
            });

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('must remain within jurisdiction');
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Property 9 — enforce() throws on violations', () => {
    it('enforce() throws DataResidencyViolationError for any denied cross-border operation', () => {
      fc.assert(
        fc.property(
          crossBorderJurisdictionsArb,
          operationTypeArb,
          fc.constantFrom(DataClassification.Restricted, DataClassification.Confidential),
          (jurisdictions, operationType, classification) => {
            const request: ResidencyValidationRequest = {
              operationType,
              dataClassification: classification,
              targetJurisdiction: jurisdictions.target,
              customerJurisdiction: jurisdictions.customer,
              isAnonymised: false,
              hasDpoApproval: false,
            };

            expect(() => validator.enforce(request)).toThrow(DataResidencyViolationError);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
