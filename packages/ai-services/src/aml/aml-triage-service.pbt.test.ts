/**
 * Property-Based Tests: HITL Gate for High-Impact Actions
 *
 * **Validates: Requirements 3.5, 15.2**
 *
 * Property 7: HITL Gate for High-Impact Actions
 * For any high-impact action (SAR filing), the action SHALL NOT transition to
 * "executed" state without a recorded human approval event in the decision chain.
 * No SAR is ever filed when analystApproval is false (HITL enforcement is absolute).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { AMLTriageService } from './aml-triage-service.js';
import type {
  SARFilingRequest,
  SARFilingResponse,
  AMLAuditEmitter,
  AMLAuditArtefactInput,
  AMLClassificationModelAdapter,
  AMLRAGAdapter,
  AMLNarrativeGeneratorAdapter,
} from './types.js';
import type { Jurisdiction } from '@afg/shared-types';

// --- Test Adapters (minimal stubs for dependency injection) ---

/** Stub classification model — not used for SAR filing tests but required for construction. */
const stubClassificationModel: AMLClassificationModelAdapter = {
  async classify() {
    return {
      disposition: 'INVESTIGATE' as const,
      priorityScore: 50,
      confidence: 0.85,
      reasoningFactors: ['stub'],
    };
  },
};

/** Stub RAG adapter — not used for SAR filing tests but required for construction. */
const stubRAGAdapter: AMLRAGAdapter = {
  async retrieveCaseHistory() {
    return {
      success: true,
      chunks: [],
      unavailableSources: [],
      retrievalLatencyMs: 10,
    };
  },
};

/** Stub narrative generator — not used for SAR filing tests but required for construction. */
const stubNarrativeGenerator: AMLNarrativeGeneratorAdapter = {
  async generateNarrative() {
    return {
      narrative: 'stub narrative',
      groundednessScore: 0.9,
    };
  },
};

/**
 * Capturing audit emitter that records all emitted artefacts for verification.
 */
function createCapturingAuditEmitter(): {
  emitter: AMLAuditEmitter;
  artefacts: AMLAuditArtefactInput[];
} {
  const artefacts: AMLAuditArtefactInput[] = [];
  let counter = 0;
  const emitter: AMLAuditEmitter = {
    async emit(artefact: AMLAuditArtefactInput): Promise<string> {
      artefacts.push(artefact);
      counter++;
      return `audit-${counter}-${Date.now()}`;
    },
  };
  return { emitter, artefacts };
}

// --- Arbitraries / Generators ---

/** Valid jurisdictions for test generation. */
const JURISDICTIONS: Jurisdiction[] = ['IN', 'SG', 'AE', 'GB', 'US'];

/** Generates a valid jurisdiction. */
const jurisdictionArb = fc.constantFrom<Jurisdiction>(...JURISDICTIONS);

/** Generates a non-empty alphanumeric string for identifiers. */
const identifierArb = fc.stringOf(
  fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', '1', '2', '3', '4', '5', '-'),
  { minLength: 3, maxLength: 20 },
).map(s => `id-${s}`);

/**
 * Generates a SARFilingRequest with analystApproval=false.
 * These should ALWAYS result in filed=false (HITL enforcement).
 */
const sarRequestNotApprovedArb: fc.Arbitrary<SARFilingRequest> = fc.record({
  caseId: identifierArb,
  analystId: identifierArb,
  narrativeId: identifierArb,
  analystApproval: fc.constant(false),
  dataGapAcknowledgement: fc.option(fc.boolean(), { nil: undefined }),
  jurisdiction: jurisdictionArb,
});

/**
 * Generates a SARFilingRequest with analystApproval=true.
 * These should ALWAYS result in filed=true.
 */
const sarRequestApprovedArb: fc.Arbitrary<SARFilingRequest> = fc.record({
  caseId: identifierArb,
  analystId: identifierArb,
  narrativeId: identifierArb,
  analystApproval: fc.constant(true),
  dataGapAcknowledgement: fc.option(fc.boolean(), { nil: undefined }),
  jurisdiction: jurisdictionArb,
});

/**
 * Generates any valid SARFilingRequest (approved or not).
 * Used for testing audit artefact emission universality.
 */
const sarRequestAnyArb: fc.Arbitrary<SARFilingRequest> = fc.record({
  caseId: identifierArb,
  analystId: identifierArb,
  narrativeId: identifierArb,
  analystApproval: fc.boolean(),
  dataGapAcknowledgement: fc.option(fc.boolean(), { nil: undefined }),
  jurisdiction: jurisdictionArb,
});

// --- Property Tests ---

describe('Property 7: HITL Gate for High-Impact Actions', () => {
  describe('Property 7.1: No SAR filed when analystApproval is false (HITL enforcement is absolute)', () => {
    /**
     * **Validates: Requirements 3.5**
     *
     * For any generated SARFilingRequest with analystApproval=false,
     * the response SHALL always have filed=false.
     */
    it('SAR is never filed without explicit analyst approval', async () => {
      await fc.assert(
        fc.asyncProperty(sarRequestNotApprovedArb, async (request) => {
          const { emitter } = createCapturingAuditEmitter();
          const service = new AMLTriageService(
            stubClassificationModel,
            stubRAGAdapter,
            stubNarrativeGenerator,
            emitter,
          );

          const response: SARFilingResponse = await service.fileSAR(request);

          // HITL gate: filed MUST be false when analystApproval=false
          expect(response.filed).toBe(false);
          // Filing timestamp should NOT exist when not filed
          expect(response.filingTimestamp).toBeUndefined();
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 7.2: SAR filed when analystApproval is true', () => {
    /**
     * **Validates: Requirements 3.5**
     *
     * For any generated SARFilingRequest with analystApproval=true,
     * the response SHALL always have filed=true.
     */
    it('SAR is always filed when analyst approval is granted', async () => {
      await fc.assert(
        fc.asyncProperty(sarRequestApprovedArb, async (request) => {
          const { emitter } = createCapturingAuditEmitter();
          const service = new AMLTriageService(
            stubClassificationModel,
            stubRAGAdapter,
            stubNarrativeGenerator,
            emitter,
          );

          const response: SARFilingResponse = await service.fileSAR(request);

          // When approved, SAR MUST be filed
          expect(response.filed).toBe(true);
          // Filing timestamp MUST be present
          expect(response.filingTimestamp).toBeDefined();
          expect(typeof response.filingTimestamp).toBe('string');
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 7.3: Audit artefact is ALWAYS emitted regardless of approval outcome', () => {
    /**
     * **Validates: Requirements 3.5, 15.2**
     *
     * For any SARFilingRequest (approved or not), an audit artefact
     * SHALL always be emitted and the response SHALL contain a valid auditArtefactId.
     */
    it('audit artefact emitted for every SAR filing attempt', async () => {
      await fc.assert(
        fc.asyncProperty(sarRequestAnyArb, async (request) => {
          const { emitter, artefacts } = createCapturingAuditEmitter();
          const service = new AMLTriageService(
            stubClassificationModel,
            stubRAGAdapter,
            stubNarrativeGenerator,
            emitter,
          );

          const artefactCountBefore = artefacts.length;
          const response: SARFilingResponse = await service.fileSAR(request);

          // Audit artefact MUST always be emitted (exactly one per call)
          expect(artefacts.length).toBe(artefactCountBefore + 1);
          // Response MUST contain a non-empty audit artefact ID
          expect(response.auditArtefactId).toBeDefined();
          expect(typeof response.auditArtefactId).toBe('string');
          expect(response.auditArtefactId.length).toBeGreaterThan(0);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 7.4: Rejection reason references "explicit analyst approval" when not approved', () => {
    /**
     * **Validates: Requirements 3.5, 15.2**
     *
     * When analystApproval=false, the rejectionReason SHALL always reference
     * "explicit analyst approval" to clearly communicate HITL enforcement.
     */
    it('rejection reason always mentions explicit analyst approval', async () => {
      await fc.assert(
        fc.asyncProperty(sarRequestNotApprovedArb, async (request) => {
          const { emitter } = createCapturingAuditEmitter();
          const service = new AMLTriageService(
            stubClassificationModel,
            stubRAGAdapter,
            stubNarrativeGenerator,
            emitter,
          );

          const response: SARFilingResponse = await service.fileSAR(request);

          // Rejection reason MUST exist when not approved
          expect(response.rejectionReason).toBeDefined();
          expect(typeof response.rejectionReason).toBe('string');
          // Must reference "explicit analyst approval"
          expect(response.rejectionReason!.toLowerCase()).toContain('explicit analyst approval');
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 7.5: HITL gate audit artefact records correct decision state', () => {
    /**
     * **Validates: Requirements 3.5, 15.2**
     *
     * The audit artefact emitted during a SAR filing attempt SHALL correctly
     * record the analyst decision and the filing outcome for regulatory traceability.
     */
    it('audit artefact records rejection when not approved', async () => {
      await fc.assert(
        fc.asyncProperty(sarRequestNotApprovedArb, async (request) => {
          const { emitter, artefacts } = createCapturingAuditEmitter();
          const service = new AMLTriageService(
            stubClassificationModel,
            stubRAGAdapter,
            stubNarrativeGenerator,
            emitter,
          );

          await service.fileSAR(request);

          const lastArtefact = artefacts[artefacts.length - 1];
          // Audit artefact MUST record analyst decision as NOT_APPROVED
          expect(lastArtefact.analystDecision).toBe('NOT_APPROVED');
          // Decision field must reflect rejection
          expect(lastArtefact.decision).toBe('REJECTED_NO_APPROVAL');
        }),
        { numRuns: 100 },
      );
    });

    it('audit artefact records approval when approved', async () => {
      await fc.assert(
        fc.asyncProperty(sarRequestApprovedArb, async (request) => {
          const { emitter, artefacts } = createCapturingAuditEmitter();
          const service = new AMLTriageService(
            stubClassificationModel,
            stubRAGAdapter,
            stubNarrativeGenerator,
            emitter,
          );

          await service.fileSAR(request);

          const lastArtefact = artefacts[artefacts.length - 1];
          // Audit artefact MUST record analyst decision as APPROVED
          expect(lastArtefact.analystDecision).toBe('APPROVED');
          // Decision field must reflect filing
          expect(lastArtefact.decision).toBe('SAR_FILED');
        }),
        { numRuns: 100 },
      );
    });
  });
});
