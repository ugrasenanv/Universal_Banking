import { describe, it, expect } from 'vitest';
import {
  DataClassification,
  ResidencyValidator,
  DataResidencyViolationError,
  DEFAULT_JURISDICTION_POLICIES,
  type Jurisdiction,
  type ResidencyValidationRequest,
} from './data-classification.js';

describe('DataClassification enum', () => {
  it('should have four classification levels', () => {
    expect(DataClassification.Restricted).toBe('RESTRICTED');
    expect(DataClassification.Confidential).toBe('CONFIDENTIAL');
    expect(DataClassification.Internal).toBe('INTERNAL');
    expect(DataClassification.Public).toBe('PUBLIC');
  });
});

describe('DEFAULT_JURISDICTION_POLICIES', () => {
  it('should define policies for all five jurisdictions', () => {
    const jurisdictions: Jurisdiction[] = ['IN', 'SG', 'AE', 'GB', 'US'];
    for (const j of jurisdictions) {
      expect(DEFAULT_JURISDICTION_POLICIES.get(j)).toBeDefined();
    }
  });

  it('should have four classification rules per jurisdiction', () => {
    for (const [, policy] of DEFAULT_JURISDICTION_POLICIES) {
      expect(policy.classificationRules).toHaveLength(4);
    }
  });

  it('should mark Restricted data as jurisdiction-locked with BYOK field-level encryption', () => {
    const policy = DEFAULT_JURISDICTION_POLICIES.get('IN')!;
    const rule = policy.classificationRules.find(
      (r) => r.classification === DataClassification.Restricted
    )!;
    expect(rule.jurisdictionLocked).toBe(true);
    expect(rule.encryptionStrategy).toBe('BYOK_FIELD_LEVEL');
    expect(rule.crossBorderRequirements.anonymisationRequired).toBe(true);
    expect(rule.crossBorderRequirements.dpoApprovalRequired).toBe(true);
  });

  it('should mark Confidential data as jurisdiction-locked with BYOK volume-level encryption', () => {
    const policy = DEFAULT_JURISDICTION_POLICIES.get('SG')!;
    const rule = policy.classificationRules.find(
      (r) => r.classification === DataClassification.Confidential
    )!;
    expect(rule.jurisdictionLocked).toBe(true);
    expect(rule.encryptionStrategy).toBe('BYOK_VOLUME_LEVEL');
    expect(rule.crossBorderRequirements.anonymisationRequired).toBe(true);
    expect(rule.crossBorderRequirements.dpoApprovalRequired).toBe(true);
  });

  it('should mark Public data as not jurisdiction-locked with transit-only encryption', () => {
    const policy = DEFAULT_JURISDICTION_POLICIES.get('GB')!;
    const rule = policy.classificationRules.find(
      (r) => r.classification === DataClassification.Public
    )!;
    expect(rule.jurisdictionLocked).toBe(false);
    expect(rule.encryptionStrategy).toBe('TRANSIT_ONLY');
  });
});

describe('ResidencyValidator', () => {
  const validator = new ResidencyValidator();

  describe('same jurisdiction operations', () => {
    it('should allow Restricted data within the same jurisdiction', () => {
      const result = validator.validate({
        operationType: 'STORAGE',
        dataClassification: DataClassification.Restricted,
        targetJurisdiction: 'IN',
        customerJurisdiction: 'IN',
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Confidential data within the same jurisdiction', () => {
      const result = validator.validate({
        operationType: 'PROCESSING',
        dataClassification: DataClassification.Confidential,
        targetJurisdiction: 'SG',
        customerJurisdiction: 'SG',
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Internal data within the same jurisdiction', () => {
      const result = validator.validate({
        operationType: 'INFERENCE',
        dataClassification: DataClassification.Internal,
        targetJurisdiction: 'GB',
        customerJurisdiction: 'GB',
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Public data within the same jurisdiction', () => {
      const result = validator.validate({
        operationType: 'STORAGE',
        dataClassification: DataClassification.Public,
        targetJurisdiction: 'AE',
        customerJurisdiction: 'AE',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('cross-border Restricted data', () => {
    it('should deny Restricted data cross-border without anonymisation or DPO approval', () => {
      const result = validator.validate({
        operationType: 'STORAGE',
        dataClassification: DataClassification.Restricted,
        targetJurisdiction: 'SG',
        customerJurisdiction: 'IN',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('jurisdiction-locked');
      expect(result.crossBorderRequirements).toBeDefined();
      expect(result.crossBorderRequirements!.anonymisationRequired).toBe(true);
      expect(result.crossBorderRequirements!.dpoApprovalRequired).toBe(true);
    });

    it('should deny Restricted data cross-border with anonymisation only (no DPO approval)', () => {
      const result = validator.validate({
        operationType: 'INFERENCE',
        dataClassification: DataClassification.Restricted,
        targetJurisdiction: 'US',
        customerJurisdiction: 'IN',
        isAnonymised: true,
        hasDpoApproval: false,
      });
      expect(result.allowed).toBe(false);
    });

    it('should deny Restricted data cross-border with DPO approval only (not anonymised)', () => {
      const result = validator.validate({
        operationType: 'PROCESSING',
        dataClassification: DataClassification.Restricted,
        targetJurisdiction: 'GB',
        customerJurisdiction: 'AE',
        isAnonymised: false,
        hasDpoApproval: true,
      });
      expect(result.allowed).toBe(false);
    });

    it('should allow Restricted data cross-border with BOTH anonymisation AND DPO approval', () => {
      const result = validator.validate({
        operationType: 'INFERENCE',
        dataClassification: DataClassification.Restricted,
        targetJurisdiction: 'US',
        customerJurisdiction: 'IN',
        isAnonymised: true,
        hasDpoApproval: true,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('cross-border Confidential data', () => {
    it('should deny Confidential data cross-border without both requirements', () => {
      const result = validator.validate({
        operationType: 'PROCESSING',
        dataClassification: DataClassification.Confidential,
        targetJurisdiction: 'GB',
        customerJurisdiction: 'SG',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('jurisdiction-locked');
    });

    it('should allow Confidential data cross-border with anonymisation AND DPO approval', () => {
      const result = validator.validate({
        operationType: 'STORAGE',
        dataClassification: DataClassification.Confidential,
        targetJurisdiction: 'AE',
        customerJurisdiction: 'GB',
        isAnonymised: true,
        hasDpoApproval: true,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('cross-border Internal data', () => {
    it('should deny Internal data moving to a different jurisdiction', () => {
      const result = validator.validate({
        operationType: 'PROCESSING',
        dataClassification: DataClassification.Internal,
        targetJurisdiction: 'US',
        customerJurisdiction: 'IN',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('must remain within jurisdiction');
    });
  });

  describe('cross-border Public data', () => {
    it('should allow Public data to any jurisdiction', () => {
      const result = validator.validate({
        operationType: 'STORAGE',
        dataClassification: DataClassification.Public,
        targetJurisdiction: 'US',
        customerJurisdiction: 'IN',
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Public data inference in any jurisdiction', () => {
      const result = validator.validate({
        operationType: 'INFERENCE',
        dataClassification: DataClassification.Public,
        targetJurisdiction: 'AE',
        customerJurisdiction: 'GB',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('enforce method', () => {
    it('should not throw for allowed operations', () => {
      expect(() => {
        validator.enforce({
          operationType: 'STORAGE',
          dataClassification: DataClassification.Public,
          targetJurisdiction: 'US',
          customerJurisdiction: 'IN',
        });
      }).not.toThrow();
    });

    it('should throw DataResidencyViolationError for denied operations', () => {
      const request: ResidencyValidationRequest = {
        operationType: 'STORAGE',
        dataClassification: DataClassification.Restricted,
        targetJurisdiction: 'SG',
        customerJurisdiction: 'IN',
      };
      expect(() => validator.enforce(request)).toThrow(DataResidencyViolationError);
    });

    it('should include the request in the thrown error', () => {
      const request: ResidencyValidationRequest = {
        operationType: 'INFERENCE',
        dataClassification: DataClassification.Confidential,
        targetJurisdiction: 'GB',
        customerJurisdiction: 'AE',
      };
      try {
        validator.enforce(request);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(DataResidencyViolationError);
        expect((err as DataResidencyViolationError).request).toEqual(request);
      }
    });
  });

  describe('getPolicy method', () => {
    it('should return the policy for a valid jurisdiction', () => {
      const policy = validator.getPolicy('IN');
      expect(policy).toBeDefined();
      expect(policy!.jurisdiction).toBe('IN');
      expect(policy!.name).toBe('India');
      expect(policy!.regulatoryFramework).toBe('RBI / DPDP Act');
    });

    it('should return undefined for an invalid jurisdiction', () => {
      const policy = validator.getPolicy('XX' as Jurisdiction);
      expect(policy).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should deny operation for unknown customer jurisdiction', () => {
      const result = validator.validate({
        operationType: 'STORAGE',
        dataClassification: DataClassification.Restricted,
        targetJurisdiction: 'IN',
        customerJurisdiction: 'XX' as Jurisdiction,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No jurisdiction policy defined');
    });
  });
});
