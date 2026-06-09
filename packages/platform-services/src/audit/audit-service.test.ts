/**
 * Unit tests for the Audit Service.
 *
 * Validates:
 * - Requirement 28.1: Immutable, append-only audit artefact storage
 * - Requirement 28.2: 7-year retention policy with expiry date computation
 * - Requirement 28.3: SHA-256 cryptographic integrity hashing
 * - Requirement 28.4: Jurisdiction-scoped partitioning for data residency
 * - Requirement 18.5: Audit query API with filters
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { AuditService } from './audit-service.js';
import { IcebergAuditStore } from './iceberg-store.js';
import type { AuditArtefactInput } from './audit-service.js';
import type { AuditQueryRequest } from './types.js';
import type { Jurisdiction } from '@afg/shared-types';
import { computeIntegrityHash, verifyIntegrity } from '@afg/shared-types';

/** Helper to create a valid audit artefact input. */
function createTestInput(overrides?: Partial<AuditArtefactInput>): AuditArtefactInput {
  return {
    artefactId: 'art-001',
    timestamp: '2024-01-15T10:30:00.000Z',
    jurisdiction: 'IN' as Jurisdiction,
    serviceId: 'fraud-inference',
    modelVersion: 'fraud-v2.3.1',
    inputFeatures: {
      customerId: 'cust-123',
      transactionAmount: 50000,
      channel: 'UPI',
    },
    modelOutput: { score: 0.87 },
    confidenceScore: 0.87,
    decision: 'HOLD',
    ...overrides,
  };
}

describe('AuditService', () => {
  let service: AuditService;
  let store: IcebergAuditStore;

  beforeEach(() => {
    store = new IcebergAuditStore();
    service = new AuditService(store);
  });

  describe('persist — Requirement 28.1: Immutable append-only storage', () => {
    it('should persist an artefact and return it with computed fields', async () => {
      const input = createTestInput();
      const result = await service.persist(input);

      expect(result.artefactId).toBe('art-001');
      expect(result.jurisdiction).toBe('IN');
      expect(result.serviceId).toBe('fraud-inference');
      expect(result.integrityHash).toBeDefined();
      expect(result.retentionExpiryDate).toBeDefined();
    });

    it('should store artefacts immutably (no modification after write)', async () => {
      const input = createTestInput();
      const persisted = await service.persist(input);

      // Retrieve and verify it's the same
      const retrieved = await service.getById('art-001', 'IN');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.integrityHash).toBe(persisted.integrityHash);
      expect(retrieved!.decision).toBe('HOLD');
    });

    it('should persist multiple artefacts as append-only', async () => {
      await service.persist(createTestInput({ artefactId: 'art-001' }));
      await service.persist(createTestInput({ artefactId: 'art-002' }));
      await service.persist(createTestInput({ artefactId: 'art-003' }));

      const result = await service.query({
        filters: { jurisdiction: 'IN' },
        maxResults: 100,
      });

      expect(result.artefacts).toHaveLength(3);
    });

    it('should include all required fields in persisted artefact', async () => {
      const input = createTestInput({
        prompt: 'Assess fraud risk for this transaction',
        explanation: [
          { featureName: 'txn_velocity', attributionWeight: 0.45, featureValue: 12, rank: 1 },
        ],
      });
      const result = await service.persist(input);

      expect(result.artefactId).toBe('art-001');
      expect(result.timestamp).toBe('2024-01-15T10:30:00.000Z');
      expect(result.jurisdiction).toBe('IN');
      expect(result.serviceId).toBe('fraud-inference');
      expect(result.modelVersion).toBe('fraud-v2.3.1');
      expect(result.inputFeatures).toBeDefined();
      expect(result.prompt).toBe('Assess fraud risk for this transaction');
      expect(result.modelOutput).toEqual({ score: 0.87 });
      expect(result.confidenceScore).toBe(0.87);
      expect(result.decision).toBe('HOLD');
      expect(result.explanation).toHaveLength(1);
      expect(result.integrityHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.retentionExpiryDate).toBeDefined();
    });
  });

  describe('persist — Requirement 28.2: 7-year retention policy', () => {
    it('should compute retention expiry as 7 years from creation timestamp', async () => {
      const input = createTestInput({ timestamp: '2024-01-15T10:30:00.000Z' });
      const result = await service.persist(input);

      const expiryDate = new Date(result.retentionExpiryDate);
      const creationDate = new Date(input.timestamp);

      // Expiry should be exactly 7 years later
      expect(expiryDate.getFullYear()).toBe(creationDate.getFullYear() + 7);
      expect(expiryDate.getMonth()).toBe(creationDate.getMonth());
      expect(expiryDate.getDate()).toBe(creationDate.getDate());
    });

    it('should correctly handle leap year in retention computation', async () => {
      // Feb 29 of a leap year
      const input = createTestInput({ timestamp: '2024-02-29T12:00:00.000Z' });
      const result = await service.persist(input);

      const expiryDate = new Date(result.retentionExpiryDate);
      expect(expiryDate.getFullYear()).toBe(2031);
      // Feb 29 in a non-leap year becomes March 1
      expect(expiryDate.getMonth()).toBe(2); // March (0-indexed)
      expect(expiryDate.getDate()).toBe(1);
    });

    it('should correctly identify expired vs non-expired artefacts', async () => {
      const input = createTestInput({ timestamp: '2017-01-01T00:00:00.000Z' });
      const artefact = await service.persist(input);

      // Check against a date after 7 years
      expect(service.isRetentionExpired(artefact, '2025-01-01T00:00:00.000Z')).toBe(true);

      // Check against a date before 7 years
      expect(service.isRetentionExpired(artefact, '2023-06-15T00:00:00.000Z')).toBe(false);
    });
  });

  describe('persist — Requirement 28.3: SHA-256 cryptographic integrity', () => {
    it('should compute a valid SHA-256 hash (64 hex characters)', async () => {
      const input = createTestInput();
      const result = await service.persist(input);

      expect(result.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce the same hash for the same content', async () => {
      const input1 = createTestInput({ artefactId: 'art-same-1' });
      const input2 = createTestInput({ artefactId: 'art-same-1' });

      const result1 = await service.persist(input1);
      const result2 = await service.persist(input2);

      expect(result1.integrityHash).toBe(result2.integrityHash);
    });

    it('should produce different hashes for different content', async () => {
      const result1 = await service.persist(
        createTestInput({ artefactId: 'art-A', decision: 'APPROVE' })
      );
      const result2 = await service.persist(
        createTestInput({ artefactId: 'art-B', decision: 'DECLINE' })
      );

      expect(result1.integrityHash).not.toBe(result2.integrityHash);
    });

    it('should pass integrity verification for untampered artefacts', async () => {
      const input = createTestInput({ artefactId: 'art-verify' });
      await service.persist(input);

      const result = await service.verifyIntegrity('art-verify', 'IN');
      expect(result.valid).toBe(true);
      expect(result.storedHash).toBe(result.computedHash);
    });

    it('should detect tampered artefacts via integrity verification', async () => {
      const input = createTestInput({ artefactId: 'art-tamper' });
      const artefact = await service.persist(input);

      // Simulate tampering by verifying with the shared-types utility
      const tampered = { ...artefact, decision: 'APPROVE' };
      expect(verifyIntegrity(tampered)).toBe(false);
    });
  });

  describe('persist — Requirement 28.4: Jurisdiction-scoped partitioning', () => {
    it('should partition artefacts by jurisdiction', async () => {
      await service.persist(createTestInput({ artefactId: 'in-1', jurisdiction: 'IN' }));
      await service.persist(createTestInput({ artefactId: 'sg-1', jurisdiction: 'SG' }));
      await service.persist(createTestInput({ artefactId: 'gb-1', jurisdiction: 'GB' }));

      // Query India jurisdiction should only return India artefacts
      const inResult = await service.query({
        filters: { jurisdiction: 'IN' },
        maxResults: 100,
      });
      expect(inResult.artefacts).toHaveLength(1);
      expect(inResult.artefacts[0].artefactId).toBe('in-1');

      // Query Singapore
      const sgResult = await service.query({
        filters: { jurisdiction: 'SG' },
        maxResults: 100,
      });
      expect(sgResult.artefacts).toHaveLength(1);
      expect(sgResult.artefacts[0].artefactId).toBe('sg-1');
    });

    it('should never return artefacts from other jurisdictions', async () => {
      await service.persist(createTestInput({ artefactId: 'in-1', jurisdiction: 'IN' }));
      await service.persist(createTestInput({ artefactId: 'in-2', jurisdiction: 'IN' }));
      await service.persist(createTestInput({ artefactId: 'sg-1', jurisdiction: 'SG' }));

      const result = await service.query({
        filters: { jurisdiction: 'SG' },
        maxResults: 100,
      });

      // Should only have SG artefacts
      expect(result.artefacts.every((a) => a.jurisdiction === 'SG')).toBe(true);
      expect(result.artefacts).toHaveLength(1);
    });

    it('should partition by year/month within a jurisdiction', async () => {
      await service.persist(
        createTestInput({ artefactId: 'jan', timestamp: '2024-01-15T10:00:00.000Z', jurisdiction: 'IN' })
      );
      await service.persist(
        createTestInput({ artefactId: 'mar', timestamp: '2024-03-20T10:00:00.000Z', jurisdiction: 'IN' })
      );

      const partitions = await store.getPartitions('IN');
      expect(partitions).toHaveLength(2);
      expect(partitions).toContainEqual({ jurisdiction: 'IN', year: 2024, month: 1 });
      expect(partitions).toContainEqual({ jurisdiction: 'IN', year: 2024, month: 3 });
    });
  });

  describe('query — Requirement 18.5: Audit query API with filters', () => {
    beforeEach(async () => {
      // Seed multiple artefacts across jurisdictions
      await service.persist(
        createTestInput({
          artefactId: 'art-100',
          jurisdiction: 'IN',
          serviceId: 'fraud-inference',
          timestamp: '2024-01-10T08:00:00.000Z',
          inputFeatures: { customerId: 'cust-A' },
        })
      );
      await service.persist(
        createTestInput({
          artefactId: 'art-101',
          jurisdiction: 'IN',
          serviceId: 'aml-triage',
          timestamp: '2024-02-15T12:00:00.000Z',
          inputFeatures: { customerId: 'cust-B' },
        })
      );
      await service.persist(
        createTestInput({
          artefactId: 'art-102',
          jurisdiction: 'IN',
          serviceId: 'fraud-inference',
          timestamp: '2024-03-20T16:00:00.000Z',
          inputFeatures: { customerId: 'cust-A' },
        })
      );
      await service.persist(
        createTestInput({
          artefactId: 'art-200',
          jurisdiction: 'SG',
          serviceId: 'fraud-inference',
          timestamp: '2024-01-20T09:00:00.000Z',
          inputFeatures: { customerId: 'cust-C' },
        })
      );
    });

    it('should filter by artefactId', async () => {
      const result = await service.query({
        filters: { artefactId: 'art-101', jurisdiction: 'IN' },
        maxResults: 10,
      });

      expect(result.artefacts).toHaveLength(1);
      expect(result.artefacts[0].artefactId).toBe('art-101');
    });

    it('should filter by customerId (from inputFeatures)', async () => {
      const result = await service.query({
        filters: { customerId: 'cust-A', jurisdiction: 'IN' },
        maxResults: 10,
      });

      expect(result.artefacts).toHaveLength(2);
      expect(result.artefacts.every((a) => a.inputFeatures['customerId'] === 'cust-A')).toBe(true);
    });

    it('should filter by serviceId', async () => {
      const result = await service.query({
        filters: { serviceId: 'fraud-inference', jurisdiction: 'IN' },
        maxResults: 10,
      });

      expect(result.artefacts).toHaveLength(2);
      expect(result.artefacts.every((a) => a.serviceId === 'fraud-inference')).toBe(true);
    });

    it('should filter by dateRange', async () => {
      const result = await service.query({
        filters: {
          jurisdiction: 'IN',
          dateRange: { from: '2024-02-01T00:00:00.000Z', to: '2024-03-01T00:00:00.000Z' },
        },
        maxResults: 10,
      });

      expect(result.artefacts).toHaveLength(1);
      expect(result.artefacts[0].artefactId).toBe('art-101');
    });

    it('should combine multiple filters', async () => {
      const result = await service.query({
        filters: {
          jurisdiction: 'IN',
          serviceId: 'fraud-inference',
          customerId: 'cust-A',
        },
        maxResults: 10,
      });

      expect(result.artefacts).toHaveLength(2);
    });

    it('should enforce jurisdiction scope (never cross-jurisdiction)', async () => {
      const result = await service.query({
        filters: { jurisdiction: 'SG' },
        maxResults: 100,
      });

      expect(result.artefacts).toHaveLength(1);
      expect(result.artefacts[0].jurisdiction).toBe('SG');
    });

    it('should respect maxResults and report truncation', async () => {
      const result = await service.query({
        filters: { jurisdiction: 'IN' },
        maxResults: 2,
      });

      expect(result.artefacts).toHaveLength(2);
      expect(result.truncated).toBe(true);
      expect(result.totalCount).toBe(3);
    });

    it('should return results sorted by timestamp descending', async () => {
      const result = await service.query({
        filters: { jurisdiction: 'IN' },
        maxResults: 100,
      });

      for (let i = 1; i < result.artefacts.length; i++) {
        const prev = new Date(result.artefacts[i - 1].timestamp).getTime();
        const curr = new Date(result.artefacts[i].timestamp).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it('should throw if jurisdiction filter is missing', async () => {
      await expect(
        service.query({
          filters: { serviceId: 'fraud-inference' } as any,
          maxResults: 10,
        })
      ).rejects.toThrow('Jurisdiction filter is mandatory');
    });

    it('should throw if maxResults is zero or negative', async () => {
      await expect(
        service.query({
          filters: { jurisdiction: 'IN' },
          maxResults: 0,
        })
      ).rejects.toThrow('maxResults must be a positive integer');
    });
  });

  describe('validation', () => {
    it('should reject artefact with missing artefactId', async () => {
      await expect(
        service.persist(createTestInput({ artefactId: '' }))
      ).rejects.toThrow('artefactId is required');
    });

    it('should reject artefact with missing serviceId', async () => {
      await expect(
        service.persist(createTestInput({ serviceId: '' }))
      ).rejects.toThrow('serviceId is required');
    });

    it('should reject artefact with invalid confidenceScore', async () => {
      await expect(
        service.persist(createTestInput({ confidenceScore: 1.5 }))
      ).rejects.toThrow('confidenceScore must be between 0.00 and 1.00');
    });

    it('should reject artefact with negative confidenceScore', async () => {
      await expect(
        service.persist(createTestInput({ confidenceScore: -0.1 }))
      ).rejects.toThrow('confidenceScore must be between 0.00 and 1.00');
    });

    it('should reject artefact with missing decision', async () => {
      await expect(
        service.persist(createTestInput({ decision: '' }))
      ).rejects.toThrow('decision is required');
    });
  });

  describe('verifyIntegrity', () => {
    it('should throw if artefact not found', async () => {
      await expect(
        service.verifyIntegrity('non-existent', 'IN')
      ).rejects.toThrow('Artefact not found');
    });

    it('should return valid=true for intact artefacts', async () => {
      await service.persist(createTestInput({ artefactId: 'art-intact' }));
      const result = await service.verifyIntegrity('art-intact', 'IN');

      expect(result.valid).toBe(true);
      expect(result.artefactId).toBe('art-intact');
    });
  });

  describe('getById', () => {
    it('should return null for non-existent artefact', async () => {
      const result = await service.getById('missing', 'IN');
      expect(result).toBeNull();
    });

    it('should retrieve artefact by id and jurisdiction', async () => {
      await service.persist(createTestInput({ artefactId: 'art-get', jurisdiction: 'SG' }));
      const result = await service.getById('art-get', 'SG');

      expect(result).not.toBeNull();
      expect(result!.artefactId).toBe('art-get');
      expect(result!.jurisdiction).toBe('SG');
    });

    it('should not find artefact in wrong jurisdiction', async () => {
      await service.persist(createTestInput({ artefactId: 'art-wrong', jurisdiction: 'IN' }));
      const result = await service.getById('art-wrong', 'SG');

      expect(result).toBeNull();
    });
  });
});


/**
 * Property-Based Tests for Audit Artefact Completeness.
 *
 * **Validates: Requirements 1.8, 2.7, 3.6, 7.8, 8.4, 9.10, 10.4, 13.4, 15.3, 18.5, 28.1**
 *
 * Property 5: Audit Artefact Completeness
 * For any customer-impacting AI decision across all platform services,
 * the persisted audit artefact SHALL contain all required fields and
 * the integrity hash SHALL be a valid SHA-256 of the artefact content.
 */
describe('Property 5: Audit Artefact Completeness', () => {
  /** Arbitrary for supported jurisdictions. */
  const arbJurisdiction: fc.Arbitrary<Jurisdiction> = fc.constantFrom(
    'IN',
    'SG',
    'AE',
    'GB',
    'US'
  );

  /** Arbitrary for ISO 8601 timestamps (valid dates in a reasonable range). */
  const arbTimestamp = fc
    .date({ min: new Date('2000-01-01T00:00:00.000Z'), max: new Date('2099-12-31T23:59:59.999Z') })
    .map((d) => d.toISOString());

  /** Arbitrary for non-empty trimmed strings (IDs, versions, decisions). */
  const arbNonEmptyString = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

  /** Arbitrary for confidence score between 0 and 1 inclusive. */
  const arbConfidenceScore = fc.double({ min: 0, max: 1, noNaN: true });

  /** Arbitrary for inputFeatures (record of string keys to json-serialisable values). */
  const arbInputFeatures = fc.dictionary(
    fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
    fc.oneof(fc.string(), fc.integer(), fc.double({ noNaN: true }), fc.boolean(), fc.constant(null))
  );

  /** Arbitrary for modelOutput (any json-serialisable value). */
  const arbModelOutput = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.constant(null),
    fc.dictionary(fc.string({ minLength: 1 }), fc.oneof(fc.string(), fc.integer(), fc.double({ noNaN: true })))
  );

  /** Arbitrary that generates a valid AuditArtefactInput. */
  const arbAuditInput: fc.Arbitrary<AuditArtefactInput> = fc.record({
    artefactId: arbNonEmptyString,
    timestamp: arbTimestamp,
    jurisdiction: arbJurisdiction,
    serviceId: arbNonEmptyString,
    modelVersion: arbNonEmptyString,
    inputFeatures: arbInputFeatures,
    modelOutput: arbModelOutput,
    confidenceScore: arbConfidenceScore,
    decision: arbNonEmptyString,
  });

  it('persisted artefact contains all required fields (non-null/defined)', async () => {
    await fc.assert(
      fc.asyncProperty(arbAuditInput, async (input) => {
        const store = new IcebergAuditStore();
        const service = new AuditService(store);

        const artefact = await service.persist(input);

        // All required fields must be present and defined
        expect(artefact.artefactId).toBeDefined();
        expect(artefact.artefactId).not.toBeNull();
        expect(artefact.timestamp).toBeDefined();
        expect(artefact.timestamp).not.toBeNull();
        expect(artefact.jurisdiction).toBeDefined();
        expect(artefact.jurisdiction).not.toBeNull();
        expect(artefact.serviceId).toBeDefined();
        expect(artefact.serviceId).not.toBeNull();
        expect(artefact.modelVersion).toBeDefined();
        expect(artefact.modelVersion).not.toBeNull();
        expect(artefact.inputFeatures).toBeDefined();
        expect(artefact.inputFeatures).not.toBeNull();
        expect(artefact.modelOutput).toBeDefined();
        expect(artefact.confidenceScore).toBeDefined();
        expect(artefact.confidenceScore).not.toBeNull();
        expect(artefact.decision).toBeDefined();
        expect(artefact.decision).not.toBeNull();
        expect(artefact.integrityHash).toBeDefined();
        expect(artefact.integrityHash).not.toBeNull();
        expect(artefact.retentionExpiryDate).toBeDefined();
        expect(artefact.retentionExpiryDate).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('integrityHash is a valid 64-character hex SHA-256 string', async () => {
    await fc.assert(
      fc.asyncProperty(arbAuditInput, async (input) => {
        const store = new IcebergAuditStore();
        const service = new AuditService(store);

        const artefact = await service.persist(input);

        // SHA-256 produces exactly 64 hex characters
        expect(artefact.integrityHash).toMatch(/^[a-f0-9]{64}$/);
      }),
      { numRuns: 100 }
    );
  });

  it('integrityHash verifies correctly via verifyIntegrity()', async () => {
    await fc.assert(
      fc.asyncProperty(arbAuditInput, async (input) => {
        const store = new IcebergAuditStore();
        const service = new AuditService(store);

        const artefact = await service.persist(input);

        // Recomputing the hash should match the stored hash
        expect(verifyIntegrity(artefact)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('retentionExpiryDate is exactly 7 years after the timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(arbAuditInput, async (input) => {
        const store = new IcebergAuditStore();
        const service = new AuditService(store);

        const artefact = await service.persist(input);

        const creationDate = new Date(artefact.timestamp);
        const expiryDate = new Date(artefact.retentionExpiryDate);

        // The expiry year should be exactly 7 years after creation
        const expectedExpiry = new Date(creationDate);
        expectedExpiry.setFullYear(expectedExpiry.getFullYear() + 7);

        expect(expiryDate.getTime()).toBe(expectedExpiry.getTime());
      }),
      { numRuns: 100 }
    );
  });

  it('all input fields are preserved unchanged in the output artefact', async () => {
    await fc.assert(
      fc.asyncProperty(arbAuditInput, async (input) => {
        const store = new IcebergAuditStore();
        const service = new AuditService(store);

        const artefact = await service.persist(input);

        // Every input field must be preserved exactly
        expect(artefact.artefactId).toBe(input.artefactId);
        expect(artefact.timestamp).toBe(input.timestamp);
        expect(artefact.jurisdiction).toBe(input.jurisdiction);
        expect(artefact.serviceId).toBe(input.serviceId);
        expect(artefact.modelVersion).toBe(input.modelVersion);
        expect(artefact.inputFeatures).toEqual(input.inputFeatures);
        expect(artefact.modelOutput).toEqual(input.modelOutput);
        expect(artefact.confidenceScore).toBe(input.confidenceScore);
        expect(artefact.decision).toBe(input.decision);
      }),
      { numRuns: 100 }
    );
  });
});
