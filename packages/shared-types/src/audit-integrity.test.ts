import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeIntegrityHash, verifyIntegrity } from './audit.js';
import type { AuditArtefact, Jurisdiction } from './index.js';

/**
 * Property 6: Audit Artefact Integrity Round-Trip
 *
 * For any stored audit artefact, computing SHA-256 over the artefact content
 * SHALL produce the same hash as the stored integrityHash field, and any
 * modification to the artefact content SHALL cause integrity verification to fail.
 *
 * **Validates: Requirements 28.3**
 */
describe('Property 6: Audit Artefact Integrity Round-Trip', () => {
  // --- Generators ---

  const jurisdictionArb = fc.constantFrom<Jurisdiction>('IN', 'SG', 'AE', 'GB', 'US');

  const inputFeaturesArb = fc.dictionary(
    fc.string({ minLength: 1, maxLength: 15 }),
    fc.oneof(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.string({ minLength: 0, maxLength: 50 }),
      fc.boolean(),
      fc.integer()
    ),
    { minKeys: 1, maxKeys: 10 }
  );

  const modelOutputArb = fc.oneof(
    fc.record({
      score: fc.double({ min: 0, max: 1, noNaN: true }),
      label: fc.string({ minLength: 1, maxLength: 20 }),
    }),
    fc.jsonValue(),
    fc.string({ minLength: 1, maxLength: 100 })
  );

  const artefactWithoutHashArb = fc.record({
    artefactId: fc.uuid(),
    timestamp: fc
      .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
      .map((d) => d.toISOString()),
    jurisdiction: jurisdictionArb,
    serviceId: fc.stringMatching(/^[a-z][a-z0-9-]{2,29}$/),
    modelVersion: fc
      .tuple(fc.nat({ max: 99 }), fc.nat({ max: 99 }), fc.nat({ max: 99 }))
      .map(([a, b, c]) => `v${a}.${b}.${c}`),
    inputFeatures: inputFeaturesArb,
    modelOutput: modelOutputArb,
    confidenceScore: fc.double({ min: 0, max: 1, noNaN: true }),
    decision: fc.constantFrom('APPROVE', 'DECLINE', 'HOLD', 'ESCALATE', 'REFER_TO_HUMAN'),
    retentionExpiryDate: fc
      .date({ min: new Date('2027-01-01'), max: new Date('2037-12-31') })
      .map((d) => d.toISOString()),
  });

  // --- Properties ---

  it('hash stability: computing integrity hash twice produces the same result', () => {
    fc.assert(
      fc.property(artefactWithoutHashArb, (artefact) => {
        const hash1 = computeIntegrityHash(artefact);
        const hash2 = computeIntegrityHash(artefact);
        expect(hash1).toBe(hash2);
      }),
      { numRuns: 200 }
    );
  });

  it('round-trip verification: verifyIntegrity returns true for correctly hashed artefacts', () => {
    fc.assert(
      fc.property(artefactWithoutHashArb, (artefact) => {
        const hash = computeIntegrityHash(artefact);
        const fullArtefact: AuditArtefact = { ...artefact, integrityHash: hash };
        expect(verifyIntegrity(fullArtefact)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('tamper detection: modifying artefactId causes verifyIntegrity to fail', () => {
    fc.assert(
      fc.property(
        artefactWithoutHashArb,
        fc.uuid(),
        (artefact, newId) => {
          fc.pre(newId !== artefact.artefactId);
          const hash = computeIntegrityHash(artefact);
          const tampered: AuditArtefact = { ...artefact, integrityHash: hash, artefactId: newId };
          expect(verifyIntegrity(tampered)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tamper detection: modifying timestamp causes verifyIntegrity to fail', () => {
    fc.assert(
      fc.property(
        artefactWithoutHashArb,
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString()),
        (artefact, newTimestamp) => {
          fc.pre(newTimestamp !== artefact.timestamp);
          const hash = computeIntegrityHash(artefact);
          const tampered: AuditArtefact = { ...artefact, integrityHash: hash, timestamp: newTimestamp };
          expect(verifyIntegrity(tampered)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tamper detection: modifying jurisdiction causes verifyIntegrity to fail', () => {
    fc.assert(
      fc.property(
        artefactWithoutHashArb,
        jurisdictionArb,
        (artefact, newJurisdiction) => {
          fc.pre(newJurisdiction !== artefact.jurisdiction);
          const hash = computeIntegrityHash(artefact);
          const tampered: AuditArtefact = { ...artefact, integrityHash: hash, jurisdiction: newJurisdiction };
          expect(verifyIntegrity(tampered)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tamper detection: modifying serviceId causes verifyIntegrity to fail', () => {
    fc.assert(
      fc.property(
        artefactWithoutHashArb,
        fc.stringMatching(/^[a-z][a-z0-9-]{2,29}$/),
        (artefact, newServiceId) => {
          fc.pre(newServiceId !== artefact.serviceId);
          const hash = computeIntegrityHash(artefact);
          const tampered: AuditArtefact = { ...artefact, integrityHash: hash, serviceId: newServiceId };
          expect(verifyIntegrity(tampered)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tamper detection: modifying modelVersion causes verifyIntegrity to fail', () => {
    fc.assert(
      fc.property(
        artefactWithoutHashArb,
        fc.tuple(fc.nat({ max: 99 }), fc.nat({ max: 99 }), fc.nat({ max: 99 })).map(
          ([a, b, c]) => `v${a}.${b}.${c}`
        ),
        (artefact, newVersion) => {
          fc.pre(newVersion !== artefact.modelVersion);
          const hash = computeIntegrityHash(artefact);
          const tampered: AuditArtefact = { ...artefact, integrityHash: hash, modelVersion: newVersion };
          expect(verifyIntegrity(tampered)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tamper detection: modifying inputFeatures causes verifyIntegrity to fail', () => {
    fc.assert(
      fc.property(
        artefactWithoutHashArb,
        inputFeaturesArb,
        (artefact, newFeatures) => {
          fc.pre(JSON.stringify(newFeatures) !== JSON.stringify(artefact.inputFeatures));
          const hash = computeIntegrityHash(artefact);
          const tampered: AuditArtefact = { ...artefact, integrityHash: hash, inputFeatures: newFeatures };
          expect(verifyIntegrity(tampered)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tamper detection: modifying modelOutput causes verifyIntegrity to fail', () => {
    fc.assert(
      fc.property(
        artefactWithoutHashArb,
        modelOutputArb,
        (artefact, newOutput) => {
          fc.pre(JSON.stringify(newOutput) !== JSON.stringify(artefact.modelOutput));
          const hash = computeIntegrityHash(artefact);
          const tampered: AuditArtefact = { ...artefact, integrityHash: hash, modelOutput: newOutput };
          expect(verifyIntegrity(tampered)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tamper detection: modifying confidenceScore causes verifyIntegrity to fail', () => {
    fc.assert(
      fc.property(
        artefactWithoutHashArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (artefact, newScore) => {
          fc.pre(newScore !== artefact.confidenceScore);
          const hash = computeIntegrityHash(artefact);
          const tampered: AuditArtefact = { ...artefact, integrityHash: hash, confidenceScore: newScore };
          expect(verifyIntegrity(tampered)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tamper detection: modifying decision causes verifyIntegrity to fail', () => {
    fc.assert(
      fc.property(
        artefactWithoutHashArb,
        fc.constantFrom('APPROVE', 'DECLINE', 'HOLD', 'ESCALATE', 'REFER_TO_HUMAN'),
        (artefact, newDecision) => {
          fc.pre(newDecision !== artefact.decision);
          const hash = computeIntegrityHash(artefact);
          const tampered: AuditArtefact = { ...artefact, integrityHash: hash, decision: newDecision };
          expect(verifyIntegrity(tampered)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tamper detection: modifying retentionExpiryDate causes verifyIntegrity to fail', () => {
    fc.assert(
      fc.property(
        artefactWithoutHashArb,
        fc.date({ min: new Date('2027-01-01'), max: new Date('2037-12-31') }).map((d) => d.toISOString()),
        (artefact, newExpiry) => {
          fc.pre(newExpiry !== artefact.retentionExpiryDate);
          const hash = computeIntegrityHash(artefact);
          const tampered: AuditArtefact = { ...artefact, integrityHash: hash, retentionExpiryDate: newExpiry };
          expect(verifyIntegrity(tampered)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('hash format: integrity hash is always a 64-character lowercase hexadecimal string', () => {
    fc.assert(
      fc.property(artefactWithoutHashArb, (artefact) => {
        const hash = computeIntegrityHash(artefact);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
        expect(hash).toHaveLength(64);
      }),
      { numRuns: 200 }
    );
  });
});
