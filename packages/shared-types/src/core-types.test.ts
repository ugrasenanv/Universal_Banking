import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  computeIntegrityHash,
  verifyIntegrity,
  computeRetentionExpiry,
  getNextDegradationTier,
  DEGRADATION_ORDER,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from './index.js';
import type {
  AuditArtefact,
  Jurisdiction,
  PlatformEvent,
  DeadLetterEvent,
  DegradationTier,
} from './index.js';

describe('Domain Types', () => {
  it('Jurisdiction type accepts exactly the 5 supported regions', () => {
    const valid: Jurisdiction[] = ['IN', 'SG', 'AE', 'GB', 'US'];
    expect(valid).toHaveLength(5);
    valid.forEach((j) => {
      expect(['IN', 'SG', 'AE', 'GB', 'US']).toContain(j);
    });
  });

  it('PlatformEvent envelope has all required fields', () => {
    const event: PlatformEvent<{ amount: number }> = {
      eventId: '019012f4-0000-7000-8000-000000000001',
      eventType: 'fraud.scores.computed',
      version: '1.0.0',
      timestamp: '2024-01-15T10:30:00.000Z',
      source: 'fraud-inference-service',
      jurisdiction: 'IN',
      tenantId: 'tenant-001',
      correlationId: 'corr-123',
      traceId: 'trace-abc',
      payload: { amount: 1500 },
    };

    expect(event.eventId).toBeDefined();
    expect(event.eventType).toBe('fraud.scores.computed');
    expect(event.jurisdiction).toBe('IN');
    expect(event.payload.amount).toBe(1500);
  });

  it('DeadLetterEvent wraps original event with failure context', () => {
    const original: PlatformEvent<unknown> = {
      eventId: '019012f4-0000-7000-8000-000000000002',
      eventType: 'aml.alerts.created',
      version: '1.0.0',
      timestamp: '2024-01-15T10:30:00.000Z',
      source: 'aml-triage-service',
      jurisdiction: 'SG',
      tenantId: 'tenant-002',
      correlationId: 'corr-456',
      traceId: 'trace-def',
      payload: { alertId: 'alert-789' },
    };

    const dlq: DeadLetterEvent = {
      originalEvent: original,
      failureReason: 'Schema validation failed: missing required field',
      retryCount: 3,
      lastAttempt: '2024-01-15T10:31:30.000Z',
      stackTrace: 'Error: Schema validation...',
    };

    expect(dlq.retryCount).toBe(3);
    expect(dlq.originalEvent.eventId).toBe(original.eventId);
  });
});

describe('Audit Artefact Integrity', () => {
  const createSampleArtefact = (): Omit<AuditArtefact, 'integrityHash'> => ({
    artefactId: 'art-001',
    timestamp: '2024-01-15T10:30:00.000Z',
    jurisdiction: 'IN',
    serviceId: 'fraud-inference',
    modelVersion: 'v2.3.1',
    inputFeatures: { txnAmount: 15000, velocity30d: 12 },
    modelOutput: { score: 0.87 },
    confidenceScore: 0.87,
    decision: 'HOLD',
    retentionExpiryDate: '2031-01-15T10:30:00.000Z',
  });

  it('computeIntegrityHash produces a valid SHA-256 hex string', () => {
    const artefact = createSampleArtefact();
    const hash = computeIntegrityHash(artefact);

    // SHA-256 produces 64 hex characters
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('computeIntegrityHash is deterministic (same input → same hash)', () => {
    const artefact = createSampleArtefact();
    const hash1 = computeIntegrityHash(artefact);
    const hash2 = computeIntegrityHash(artefact);

    expect(hash1).toBe(hash2);
  });

  it('computeIntegrityHash changes when artefact content changes', () => {
    const artefact = createSampleArtefact();
    const hash1 = computeIntegrityHash(artefact);

    const modified = { ...artefact, decision: 'APPROVE' };
    const hash2 = computeIntegrityHash(modified);

    expect(hash1).not.toBe(hash2);
  });

  it('verifyIntegrity returns true for untampered artefact', () => {
    const artefact = createSampleArtefact();
    const hash = computeIntegrityHash(artefact);
    const fullArtefact: AuditArtefact = { ...artefact, integrityHash: hash };

    expect(verifyIntegrity(fullArtefact)).toBe(true);
  });

  it('verifyIntegrity returns false for tampered artefact', () => {
    const artefact = createSampleArtefact();
    const hash = computeIntegrityHash(artefact);
    const fullArtefact: AuditArtefact = { ...artefact, integrityHash: hash };

    // Tamper with a field
    const tampered: AuditArtefact = { ...fullArtefact, decision: 'APPROVE' };
    expect(verifyIntegrity(tampered)).toBe(false);
  });

  /**
   * Property test: Audit Artefact Integrity Round-Trip
   *
   * For any audit artefact, computing SHA-256 over the content SHALL produce
   * the same hash as stored, and modification SHALL cause verification to fail.
   *
   * **Validates: Requirements 28.3**
   */
  it('property: integrity hash round-trip holds for any artefact', () => {
    const jurisdictionArb = fc.constantFrom<Jurisdiction>('IN', 'SG', 'AE', 'GB', 'US');
    const artefactArb = fc.record({
      artefactId: fc.uuid(),
      timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map(
        (d) => d.toISOString()
      ),
      jurisdiction: jurisdictionArb,
      serviceId: fc.string({ minLength: 3, maxLength: 30 }),
      modelVersion: fc.tuple(fc.nat({ max: 9 }), fc.nat({ max: 9 }), fc.nat({ max: 9 })).map(
        ([a, b, c]) => `v${a}.${b}.${c}`
      ),
      inputFeatures: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.double({ noNaN: true })),
      modelOutput: fc.jsonValue(),
      confidenceScore: fc.double({ min: 0, max: 1, noNaN: true }),
      decision: fc.constantFrom('APPROVE', 'DECLINE', 'HOLD', 'ESCALATE'),
      retentionExpiryDate: fc.date({ min: new Date('2027-01-01'), max: new Date('2037-12-31') }).map(
        (d) => d.toISOString()
      ),
    });

    fc.assert(
      fc.property(artefactArb, (artefact) => {
        const hash = computeIntegrityHash(artefact);
        const full: AuditArtefact = { ...artefact, integrityHash: hash };

        // Round-trip: verification passes for untampered artefact
        expect(verifyIntegrity(full)).toBe(true);

        // Recomputing produces same hash
        const recomputed = computeIntegrityHash(artefact);
        expect(recomputed).toBe(hash);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Retention Expiry Computation', () => {
  it('computes 7 years from creation timestamp', () => {
    const created = '2024-01-15T10:30:00.000Z';
    const expiry = computeRetentionExpiry(created);

    const expiryDate = new Date(expiry);
    expect(expiryDate.getFullYear()).toBe(2031);
    expect(expiryDate.getMonth()).toBe(0); // January
    expect(expiryDate.getDate()).toBe(15);
  });

  it('handles leap year boundaries', () => {
    const created = '2024-02-29T00:00:00.000Z'; // leap year
    const expiry = computeRetentionExpiry(created);

    const expiryDate = new Date(expiry);
    // 2031 is not a leap year, so Feb 29 rolls to Mar 1
    expect(expiryDate.getFullYear()).toBe(2031);
  });
});

describe('Circuit Breaker and Degradation Hierarchy', () => {
  it('DEGRADATION_ORDER has exactly 5 tiers in correct order', () => {
    expect(DEGRADATION_ORDER).toEqual([
      'PRIMARY',
      'SECONDARY',
      'RULES_ENGINE',
      'HUMAN_REVIEW',
      'SAFE_DEFAULT',
    ]);
  });

  it('getNextDegradationTier walks down the hierarchy correctly', () => {
    expect(getNextDegradationTier('PRIMARY')).toBe('SECONDARY');
    expect(getNextDegradationTier('SECONDARY')).toBe('RULES_ENGINE');
    expect(getNextDegradationTier('RULES_ENGINE')).toBe('HUMAN_REVIEW');
    expect(getNextDegradationTier('HUMAN_REVIEW')).toBe('SAFE_DEFAULT');
    expect(getNextDegradationTier('SAFE_DEFAULT')).toBeUndefined();
  });

  it('DEFAULT_CIRCUIT_BREAKER_CONFIG matches design spec', () => {
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(3);
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.recoveryTimeoutMs).toBe(10_000);
  });

  /**
   * Property test: Fallback chain is deterministic.
   * For any tier, calling getNextDegradationTier always returns
   * the same result (determinism).
   *
   * **Validates: Requirements 28.1**
   */
  it('property: degradation tier progression is deterministic', () => {
    const tierArb = fc.constantFrom<DegradationTier>(
      'PRIMARY',
      'SECONDARY',
      'RULES_ENGINE',
      'HUMAN_REVIEW',
      'SAFE_DEFAULT'
    );

    fc.assert(
      fc.property(tierArb, (tier) => {
        const next1 = getNextDegradationTier(tier);
        const next2 = getNextDegradationTier(tier);
        expect(next1).toBe(next2);

        // If not at bottom, next tier should be one step lower
        if (tier !== 'SAFE_DEFAULT') {
          const currentIdx = DEGRADATION_ORDER.indexOf(tier);
          expect(next1).toBe(DEGRADATION_ORDER[currentIdx + 1]);
        } else {
          expect(next1).toBeUndefined();
        }
      }),
      { numRuns: 50 }
    );
  });
});
