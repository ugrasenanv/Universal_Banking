/**
 * Property-Based Tests: Complaint Classification and Routing Consistency
 *
 * **Validates: Requirements 10.1, 10.3**
 *
 * Property 19: Complaint Classification and Routing Consistency
 * For any customer complaint, classification SHALL produce a category from the
 * predefined valid set, and the routing decision SHALL deterministically map to
 * the resolution team associated with that category in the category-team mapping
 * configuration.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ComplaintsIntelligenceService } from './complaints-intelligence-service.js';
import type {
  ComplaintClassificationRequest,
  ComplaintClassificationModelAdapter,
  ComplaintClassificationResult,
  ComplaintAuditEmitter,
  ComplaintAuditRecord,
  ComplaintCategory,
  ComplaintSubcategory,
  ResolutionTeam,
} from './types.js';
import { DEFAULT_CATEGORY_TEAM_MAP, DEFAULT_COMPLAINTS_INTELLIGENCE_CONFIG } from './types.js';
import type { Jurisdiction } from '@afg/shared-types';

// ──────────────────────────────────────────────────────────────────────────────
// Arbitraries / Generators
// ──────────────────────────────────────────────────────────────────────────────

const VALID_CATEGORIES: ComplaintCategory[] = [
  'ACCOUNT_OPERATIONS',
  'LOANS_AND_ADVANCES',
  'CREDIT_CARDS',
  'INTERNET_BANKING',
  'MOBILE_BANKING',
  'ATM_DEBIT_CARDS',
  'REMITTANCES',
  'PENSION',
  'DEPOSIT_ACCOUNTS',
  'PARA_BANKING',
  'STAFF_BEHAVIOUR',
  'OTHERS',
];

const VALID_SUBCATEGORIES: ComplaintSubcategory[] = [
  'ACCOUNT_OPENING',
  'ACCOUNT_CLOSURE',
  'ACCOUNT_MAINTENANCE',
  'LOAN_DISBURSEMENT',
  'LOAN_RECOVERY',
  'INTEREST_RATE',
  'EMI_ISSUES',
  'BILLING_DISPUTE',
  'CARD_BLOCK_UNBLOCK',
  'REWARD_POINTS',
  'UNAUTHORIZED_TRANSACTION',
  'LOGIN_ISSUES',
  'TRANSACTION_FAILURE',
  'UPI_ISSUES',
  'FUND_TRANSFER_DELAY',
  'ATM_CASH_NOT_DISPENSED',
  'ATM_WRONG_AMOUNT',
  'INWARD_REMITTANCE',
  'OUTWARD_REMITTANCE',
  'PENSION_CREDIT_DELAY',
  'FIXED_DEPOSIT',
  'RECURRING_DEPOSIT',
  'INSURANCE_MISSELLING',
  'MUTUAL_FUND_ISSUES',
  'RUDE_BEHAVIOUR',
  'NON_RESPONSE',
  'MISCELLANEOUS',
];

const VALID_CHANNELS: ComplaintClassificationRequest['channel'][] = [
  'BRANCH',
  'CALL_CENTRE',
  'EMAIL',
  'MOBILE_APP',
  'WEB',
  'LETTER',
];

const JURISDICTIONS: Jurisdiction[] = ['IN', 'SG', 'AE', 'GB', 'US'];

/** Generates a non-empty identifier string. */
const identifierArb = fc.stringOf(
  fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', '0', '1', '2', '3', '4', '5', '-'),
  { minLength: 3, maxLength: 20 },
).map(s => `CMP-${s}`);

/** Generates a non-empty complaint text (1 to 800 chars). */
const complaintTextArb = fc.stringOf(
  fc.constantFrom(
    'I', ' ', 'was', 'charged', 'incorrectly', 'my', 'account', 'loan', 'card',
    'ATM', 'transfer', 'delayed', 'issue', 'problem', 'error', 'help', 'please',
    'urgent', 'EMI', 'amount', 'deducted', 'wrong', 'transaction', 'failed',
  ),
  { minLength: 5, maxLength: 50 },
).map(s => s.trim() || 'complaint text');

/** Generates a valid ISO8601 timestamp. */
const isoTimestampArb = fc.date({
  min: new Date('2020-01-01'),
  max: new Date('2025-12-31'),
}).map(d => d.toISOString());

/** Generates a valid complaint category. */
const categoryArb = fc.constantFrom<ComplaintCategory>(...VALID_CATEGORIES);

/** Generates a valid subcategory. */
const subcategoryArb = fc.constantFrom<ComplaintSubcategory>(...VALID_SUBCATEGORIES);

/** Generates a confidence score in the valid range [0, 1]. */
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

/** Generates a high-confidence score (>= threshold). */
const highConfidenceArb = fc.double({ min: 0.75, max: 1.0, noNaN: true });

/** Generates a low-confidence score (< threshold). */
const lowConfidenceArb = fc.double({ min: 0, max: 0.7499, noNaN: true });

/** Generates a valid ComplaintClassificationRequest. */
const requestArb: fc.Arbitrary<ComplaintClassificationRequest> = fc.record({
  complaintId: identifierArb,
  customerId: identifierArb,
  complaintText: complaintTextArb,
  channel: fc.constantFrom<ComplaintClassificationRequest['channel']>(...VALID_CHANNELS),
  receivedAt: isoTimestampArb,
  jurisdiction: fc.constantFrom<Jurisdiction>(...JURISDICTIONS),
});

/** Generates a classification result with any confidence. */
const classificationResultArb: fc.Arbitrary<ComplaintClassificationResult> = fc.record({
  category: categoryArb,
  subcategory: subcategoryArb,
  confidence: confidenceArb,
  reasoningFactors: fc.array(fc.constant('factor'), { minLength: 1, maxLength: 5 }),
  customerIssueSummary: fc.constant('Customer issue summary'),
});

/** Generates a classification result with high confidence (above default threshold). */
const highConfidenceResultArb: fc.Arbitrary<ComplaintClassificationResult> = fc.record({
  category: categoryArb,
  subcategory: subcategoryArb,
  confidence: highConfidenceArb,
  reasoningFactors: fc.array(fc.constant('factor'), { minLength: 1, maxLength: 5 }),
  customerIssueSummary: fc.constant('Customer issue summary'),
});

/** Generates a classification result with low confidence (below default threshold). */
const lowConfidenceResultArb: fc.Arbitrary<ComplaintClassificationResult> = fc.record({
  category: categoryArb,
  subcategory: subcategoryArb,
  confidence: lowConfidenceArb,
  reasoningFactors: fc.array(fc.constant('factor'), { minLength: 1, maxLength: 5 }),
  customerIssueSummary: fc.constant('Customer issue summary'),
});

// ──────────────────────────────────────────────────────────────────────────────
// Test Adapters
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Creates a model adapter that returns a specific classification result.
 */
function createModelAdapter(result: ComplaintClassificationResult): ComplaintClassificationModelAdapter {
  return {
    async classify(): Promise<ComplaintClassificationResult> {
      return result;
    },
  };
}

/**
 * Creates a model adapter that always throws (simulating failure/timeout).
 */
function createFailingModelAdapter(errorMsg = 'Service unavailable'): ComplaintClassificationModelAdapter {
  return {
    async classify(): Promise<ComplaintClassificationResult> {
      throw new Error(errorMsg);
    },
  };
}

/**
 * Capturing audit emitter that records all emitted artefacts.
 */
function createCapturingAuditEmitter(): {
  emitter: ComplaintAuditEmitter;
  records: Array<Omit<ComplaintAuditRecord, 'artefactId'>>;
} {
  const records: Array<Omit<ComplaintAuditRecord, 'artefactId'>> = [];
  let counter = 0;
  const emitter: ComplaintAuditEmitter = {
    async emit(record: Omit<ComplaintAuditRecord, 'artefactId'>): Promise<string> {
      records.push(record);
      counter++;
      return `AUDIT-${counter}-${Date.now()}`;
    },
  };
  return { emitter, records };
}

// ──────────────────────────────────────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('Property 19: Complaint Classification and Routing Consistency', () => {
  describe('Property 19.1: Deterministic category-team routing for high-confidence classifications', () => {
    /**
     * **Validates: Requirements 10.1, 10.3**
     *
     * For any complaint category assigned by the ML model with confidence >= threshold,
     * the routing to the resolution team is deterministic and matches the configured
     * category-team mapping.
     */
    it('routes to the configured team for the classified category', async () => {
      await fc.assert(
        fc.asyncProperty(
          requestArb,
          highConfidenceResultArb,
          async (request, classificationResult) => {
            const { emitter } = createCapturingAuditEmitter();
            const modelAdapter = createModelAdapter(classificationResult);
            const service = new ComplaintsIntelligenceService(modelAdapter, emitter);

            const response = await service.classifyAndRoute(request);

            // Category MUST match what the model returned
            expect(response.category).toBe(classificationResult.category);

            // Routing MUST deterministically map to the configured team
            const expectedTeam = DEFAULT_CATEGORY_TEAM_MAP[classificationResult.category];
            expect(response.routedToTeam).toBe(expectedTeam);

            // Should NOT be escalated when confidence is above threshold
            expect(response.escalatedToSeniorOfficer).toBe(false);
            expect(response.fallbackTriggered).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 19.2: Low-confidence classifications always route to SENIOR_OFFICER', () => {
    /**
     * **Validates: Requirements 10.1, 10.3**
     *
     * For any classification result with confidence below the configured threshold,
     * the complaint SHALL always be routed to SENIOR_OFFICER regardless of the
     * assigned category.
     */
    it('escalates to SENIOR_OFFICER when confidence is below threshold', async () => {
      await fc.assert(
        fc.asyncProperty(
          requestArb,
          lowConfidenceResultArb,
          async (request, classificationResult) => {
            const { emitter } = createCapturingAuditEmitter();
            const modelAdapter = createModelAdapter(classificationResult);
            const service = new ComplaintsIntelligenceService(modelAdapter, emitter);

            const response = await service.classifyAndRoute(request);

            // MUST route to SENIOR_OFFICER regardless of category
            expect(response.routedToTeam).toBe('SENIOR_OFFICER');
            // MUST be marked as escalated
            expect(response.escalatedToSeniorOfficer).toBe(true);
            // Category still reflects what model classified
            expect(response.category).toBe(classificationResult.category);
            // Confidence reflects the low value
            expect(response.confidence).toBe(classificationResult.confidence);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 19.3: Fallback always routes to SENIOR_OFFICER with category=OTHERS', () => {
    /**
     * **Validates: Requirements 10.1, 10.3**
     *
     * When the classification service fails or times out, the fallback SHALL always
     * route to SENIOR_OFFICER with category=OTHERS and subcategory=MISCELLANEOUS.
     */
    it('falls back to SENIOR_OFFICER with OTHERS category on service failure', async () => {
      const errorMessages = [
        'Service unavailable',
        'Model timeout',
        'Network error',
        'Internal server error',
        'Connection refused',
      ];
      const errorMessageArb = fc.constantFrom(...errorMessages);

      await fc.assert(
        fc.asyncProperty(
          requestArb,
          errorMessageArb,
          async (request, errorMsg) => {
            const { emitter } = createCapturingAuditEmitter();
            const modelAdapter = createFailingModelAdapter(errorMsg);
            const service = new ComplaintsIntelligenceService(modelAdapter, emitter);

            const response = await service.classifyAndRoute(request);

            // MUST fallback to SENIOR_OFFICER
            expect(response.routedToTeam).toBe('SENIOR_OFFICER');
            // MUST set category to OTHERS
            expect(response.category).toBe('OTHERS');
            // MUST set subcategory to MISCELLANEOUS
            expect(response.subcategory).toBe('MISCELLANEOUS');
            // Confidence MUST be 0 (no classification occurred)
            expect(response.confidence).toBe(0);
            // MUST mark fallback as triggered
            expect(response.fallbackTriggered).toBe(true);
            // MUST mark as escalated
            expect(response.escalatedToSeniorOfficer).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 19.4: Structured summary always contains required RBI CMS fields', () => {
    /**
     * **Validates: Requirements 10.3**
     *
     * For any classification outcome (success, low-confidence, or fallback), the
     * structured summary SHALL always contain the required RBI CMS fields:
     * complaintReferenceNumber, category, subcategory, resolutionTeam, classifiedAt.
     */
    it('structured summary contains all required RBI CMS fields on successful classification', async () => {
      await fc.assert(
        fc.asyncProperty(
          requestArb,
          classificationResultArb,
          async (request, classificationResult) => {
            const { emitter } = createCapturingAuditEmitter();
            const modelAdapter = createModelAdapter(classificationResult);
            const service = new ComplaintsIntelligenceService(modelAdapter, emitter);

            const response = await service.classifyAndRoute(request);
            const summary = response.structuredSummary;

            // Required RBI CMS fields MUST be present
            expect(summary.complaintReferenceNumber).toBe(request.complaintId);
            expect(VALID_CATEGORIES).toContain(summary.category);
            expect(VALID_SUBCATEGORIES).toContain(summary.subcategory);
            expect(summary.resolutionTeam).toBeDefined();
            expect(typeof summary.resolutionTeam).toBe('string');
            expect(summary.resolutionTeam.length).toBeGreaterThan(0);
            expect(summary.classifiedAt).toBeDefined();
            // classifiedAt MUST be a valid ISO 8601 timestamp
            expect(new Date(summary.classifiedAt).toISOString()).toBe(summary.classifiedAt);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('structured summary contains all required RBI CMS fields on fallback', async () => {
      await fc.assert(
        fc.asyncProperty(requestArb, async (request) => {
          const { emitter } = createCapturingAuditEmitter();
          const modelAdapter = createFailingModelAdapter();
          const service = new ComplaintsIntelligenceService(modelAdapter, emitter);

          const response = await service.classifyAndRoute(request);
          const summary = response.structuredSummary;

          // Required RBI CMS fields MUST still be present even on fallback
          expect(summary.complaintReferenceNumber).toBe(request.complaintId);
          expect(VALID_CATEGORIES).toContain(summary.category);
          expect(VALID_SUBCATEGORIES).toContain(summary.subcategory);
          expect(summary.resolutionTeam).toBeDefined();
          expect(typeof summary.resolutionTeam).toBe('string');
          expect(summary.resolutionTeam.length).toBeGreaterThan(0);
          expect(summary.classifiedAt).toBeDefined();
          expect(new Date(summary.classifiedAt).toISOString()).toBe(summary.classifiedAt);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 19.5: Audit artefact is always emitted regardless of classification outcome', () => {
    /**
     * **Validates: Requirements 10.1, 10.3**
     *
     * For any classification outcome (success, low-confidence, or fallback),
     * an audit artefact SHALL always be emitted and the response SHALL contain
     * a valid auditArtefactId.
     */
    it('audit artefact emitted on successful high-confidence classification', async () => {
      await fc.assert(
        fc.asyncProperty(
          requestArb,
          highConfidenceResultArb,
          async (request, classificationResult) => {
            const { emitter, records } = createCapturingAuditEmitter();
            const modelAdapter = createModelAdapter(classificationResult);
            const service = new ComplaintsIntelligenceService(modelAdapter, emitter);

            const recordsBefore = records.length;
            const response = await service.classifyAndRoute(request);

            // Audit artefact MUST be emitted (exactly one per call)
            expect(records.length).toBe(recordsBefore + 1);
            // Response MUST contain a non-empty audit artefact ID
            expect(response.auditArtefactId).toBeDefined();
            expect(typeof response.auditArtefactId).toBe('string');
            expect(response.auditArtefactId.length).toBeGreaterThan(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('audit artefact emitted on low-confidence classification', async () => {
      await fc.assert(
        fc.asyncProperty(
          requestArb,
          lowConfidenceResultArb,
          async (request, classificationResult) => {
            const { emitter, records } = createCapturingAuditEmitter();
            const modelAdapter = createModelAdapter(classificationResult);
            const service = new ComplaintsIntelligenceService(modelAdapter, emitter);

            const recordsBefore = records.length;
            const response = await service.classifyAndRoute(request);

            // Audit artefact MUST be emitted even for low-confidence
            expect(records.length).toBe(recordsBefore + 1);
            expect(response.auditArtefactId).toBeDefined();
            expect(response.auditArtefactId.length).toBeGreaterThan(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('audit artefact emitted on fallback (service failure)', async () => {
      await fc.assert(
        fc.asyncProperty(requestArb, async (request) => {
          const { emitter, records } = createCapturingAuditEmitter();
          const modelAdapter = createFailingModelAdapter();
          const service = new ComplaintsIntelligenceService(modelAdapter, emitter);

          const recordsBefore = records.length;
          const response = await service.classifyAndRoute(request);

          // Audit artefact MUST be emitted even on fallback
          expect(records.length).toBe(recordsBefore + 1);
          expect(response.auditArtefactId).toBeDefined();
          expect(response.auditArtefactId.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });
  });
});
