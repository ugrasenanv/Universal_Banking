/**
 * Branch Copilot Service - Unit Tests
 *
 * Tests for the Branch Copilot including:
 * - Answering queries with mandatory source citations (Req 12.1)
 * - Hybrid retrieval integration (Req 12.2)
 * - Refusal when confidence below threshold (Req 12.3)
 * - Incremental corpus updates within 1 hour (Req 12.4)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BranchCopilot } from './branch-copilot-service.js';
import type {
  BranchRetrievalAdapter,
  BranchAnswerGeneratorAdapter,
  BranchCorpusUpdateAdapter,
  BranchCopilotQuery,
  BranchRetrievalResult,
} from './types.js';
import { isBranchCopilotRefusal, DEFAULT_BRANCH_COPILOT_CONFIG } from './types.js';

// ============================================================================
// Test Helpers: Mock Adapters
// ============================================================================

function createMockRetrieval(
  overrides: Partial<BranchRetrievalResult> = {}
): BranchRetrievalAdapter {
  const defaultResult: BranchRetrievalResult = {
    chunks: [
      {
        chunkId: 'chunk-1',
        content: 'Fixed deposit early closure penalty is 1% of principal.',
        source: {
          documentName: 'FD Policy v2.3',
          section: 'Section 4.2 - Early Closure',
          publicationDate: '2024-01-15T00:00:00Z',
        },
        relevanceScore: 0.92,
        language: 'en',
      },
      {
        chunkId: 'chunk-2',
        content: 'For senior citizens, the penalty is waived for amounts below 5 lakhs.',
        source: {
          documentName: 'FD Policy v2.3',
          section: 'Section 4.3 - Exemptions',
          publicationDate: '2024-01-15T00:00:00Z',
        },
        relevanceScore: 0.85,
        language: 'en',
      },
      {
        chunkId: 'chunk-3',
        content: 'Circular RBI/2024/12: Updated guidelines on term deposit closures.',
        source: {
          documentName: 'RBI Circular 2024/12',
          section: 'Para 3 - Premature Closure',
          publicationDate: '2024-03-01T00:00:00Z',
        },
        relevanceScore: 0.78,
        language: 'en',
      },
    ],
    groundednessScore: 0.88,
    retrievalLatencyMs: 45,
    ...overrides,
  };

  return {
    retrieve: vi.fn().mockResolvedValue(defaultResult),
  };
}

function createMockAnswerGenerator(): BranchAnswerGeneratorAdapter {
  return {
    generateAnswer: vi.fn().mockResolvedValue({
      answer:
        'The early closure penalty for fixed deposits is 1% of the principal amount. ' +
        'However, for senior citizens, this penalty is waived for deposits below 5 lakhs.',
      latencyMs: 120,
    }),
  };
}

function createMockCorpusUpdater(): BranchCorpusUpdateAdapter {
  return {
    ingestDocument: vi.fn().mockResolvedValue({ chunksCreated: 5, processingTimeMs: 200 }),
    removeDocument: vi.fn().mockResolvedValue(undefined),
  };
}

function createDefaultQuery(overrides: Partial<BranchCopilotQuery> = {}): BranchCopilotQuery {
  return {
    queryId: 'query-001',
    question: 'What is the early closure penalty for fixed deposits?',
    tenantId: 'branch-mumbai-01',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('BranchCopilot', () => {
  let retrieval: BranchRetrievalAdapter;
  let answerGenerator: BranchAnswerGeneratorAdapter;
  let corpusUpdater: BranchCorpusUpdateAdapter;
  let service: BranchCopilot;

  beforeEach(() => {
    retrieval = createMockRetrieval();
    answerGenerator = createMockAnswerGenerator();
    corpusUpdater = createMockCorpusUpdater();
    service = new BranchCopilot(retrieval, answerGenerator, corpusUpdater);
  });

  // ==========================================================================
  // Requirement 12.1: Answers with mandatory source citations
  // ==========================================================================

  describe('query - answers with mandatory source citations (Req 12.1)', () => {
    it('should return an answer with source citations when confidence is above threshold', async () => {
      const query = createDefaultQuery();
      const response = await service.query(query);

      expect(response.refused).toBe(false);
      expect(isBranchCopilotRefusal(response)).toBe(false);

      if (!isBranchCopilotRefusal(response)) {
        expect(response.answer).toBeTruthy();
        expect(response.citations.length).toBeGreaterThan(0);
        expect(response.queryId).toBe('query-001');
      }
    });

    it('should include document name, section, and effective date in citations', async () => {
      const query = createDefaultQuery();
      const response = await service.query(query);

      if (!isBranchCopilotRefusal(response)) {
        for (const citation of response.citations) {
          expect(citation.documentName).toBeTruthy();
          expect(citation.section).toBeTruthy();
          expect(citation.effectiveDate).toBeTruthy();
          expect(citation.relevanceScore).toBeGreaterThan(0);
        }
      }
    });

    it('should respect maxCitations parameter', async () => {
      const query = createDefaultQuery({ maxCitations: 2 });
      const response = await service.query(query);

      if (!isBranchCopilotRefusal(response)) {
        expect(response.citations.length).toBeLessThanOrEqual(2);
      }
    });

    it('should default to configured defaultMaxCitations', async () => {
      const query = createDefaultQuery();
      const response = await service.query(query);

      if (!isBranchCopilotRefusal(response)) {
        expect(response.citations.length).toBeLessThanOrEqual(
          DEFAULT_BRANCH_COPILOT_CONFIG.defaultMaxCitations
        );
      }
    });

    it('should include confidence score in the response', async () => {
      const query = createDefaultQuery();
      const response = await service.query(query);

      if (!isBranchCopilotRefusal(response)) {
        expect(response.confidenceScore).toBeGreaterThanOrEqual(0);
        expect(response.confidenceScore).toBeLessThanOrEqual(1);
      }
    });

    it('should include latency in milliseconds', async () => {
      const query = createDefaultQuery();
      const response = await service.query(query);

      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Requirement 12.2: Hybrid retrieval (BM25 + dense vector)
  // ==========================================================================

  describe('query - hybrid retrieval (Req 12.2)', () => {
    it('should pass query to retrieval adapter with correct parameters', async () => {
      const query = createDefaultQuery({
        language: 'hi',
        corpusCategories: ['POLICY', 'CIRCULAR'],
      });

      await service.query(query);

      expect(retrieval.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          query: query.question,
          queryLanguage: 'hi',
          tenantId: 'branch-mumbai-01',
          corpusIds: ['branch-policies', 'branch-circulars'],
        })
      );
    });

    it('should search all corpus categories when none specified', async () => {
      const query = createDefaultQuery();

      await service.query(query);

      expect(retrieval.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          corpusIds: ['branch-policies', 'branch-circulars', 'branch-products'],
        })
      );
    });

    it('should default to English when no language is specified', async () => {
      const query = createDefaultQuery();

      await service.query(query);

      expect(retrieval.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          queryLanguage: 'en',
        })
      );
    });

    it('should pass topK expanded for better groundedness scoring', async () => {
      const query = createDefaultQuery({ maxCitations: 3 });

      await service.query(query);

      // Should retrieve more than maxCitations for better selection
      expect(retrieval.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          topK: 6, // maxCitations * 2
        })
      );
    });
  });

  // ==========================================================================
  // Requirement 12.3: Refusal when confidence below threshold
  // ==========================================================================

  describe('query - refusal when confidence below threshold (Req 12.3)', () => {
    it('should refuse when groundedness score is below configured threshold', async () => {
      retrieval = createMockRetrieval({ groundednessScore: 0.45 });
      service = new BranchCopilot(retrieval, answerGenerator, corpusUpdater);

      const query = createDefaultQuery();
      const response = await service.query(query);

      expect(response.refused).toBe(true);
      expect(isBranchCopilotRefusal(response)).toBe(true);

      if (isBranchCopilotRefusal(response)) {
        expect(response.confidenceScore).toBe(0.45);
        expect(response.threshold).toBe(0.70);
        expect(response.escalationChannel).toBeTruthy();
        expect(response.reason).toContain('confidence');
      }
    });

    it('should refuse when groundedness is exactly at threshold boundary (below)', async () => {
      retrieval = createMockRetrieval({ groundednessScore: 0.69 });
      service = new BranchCopilot(retrieval, answerGenerator, corpusUpdater);

      const query = createDefaultQuery();
      const response = await service.query(query);

      expect(response.refused).toBe(true);
    });

    it('should NOT refuse when groundedness is exactly at threshold', async () => {
      retrieval = createMockRetrieval({ groundednessScore: 0.70 });
      service = new BranchCopilot(retrieval, answerGenerator, corpusUpdater);

      const query = createDefaultQuery();
      const response = await service.query(query);

      expect(response.refused).toBe(false);
    });

    it('should refuse when no chunks are retrieved', async () => {
      retrieval = createMockRetrieval({ chunks: [], groundednessScore: 0.0 });
      service = new BranchCopilot(retrieval, answerGenerator, corpusUpdater);

      const query = createDefaultQuery();
      const response = await service.query(query);

      expect(response.refused).toBe(true);
    });

    it('should include escalation channel in refusal response', async () => {
      retrieval = createMockRetrieval({ groundednessScore: 0.30 });
      service = new BranchCopilot(retrieval, answerGenerator, corpusUpdater, {
        defaultEscalationChannel: 'regional-ops-desk',
      });

      const query = createDefaultQuery();
      const response = await service.query(query);

      if (isBranchCopilotRefusal(response)) {
        expect(response.escalationChannel).toBe('regional-ops-desk');
      }
    });

    it('should NOT call answer generator when refusing', async () => {
      retrieval = createMockRetrieval({ groundednessScore: 0.40 });
      service = new BranchCopilot(retrieval, answerGenerator, corpusUpdater);

      await service.query(createDefaultQuery());

      expect(answerGenerator.generateAnswer).not.toHaveBeenCalled();
    });

    it('should respect custom confidence threshold configuration', async () => {
      retrieval = createMockRetrieval({ groundednessScore: 0.80 });
      service = new BranchCopilot(retrieval, answerGenerator, corpusUpdater, {
        confidenceThreshold: 0.85,
      });

      const query = createDefaultQuery();
      const response = await service.query(query);

      expect(response.refused).toBe(true);
    });
  });

  // ==========================================================================
  // Requirement 12.4: Incremental corpus updates within 1 hour
  // ==========================================================================

  describe('updateCorpus - incremental updates (Req 12.4)', () => {
    it('should process document additions without full re-index', async () => {
      const result = await service.updateCorpus({
        tenantId: 'branch-mumbai-01',
        documents: [
          {
            documentId: 'doc-new-001',
            documentName: 'Updated FD Policy v2.4',
            content: 'New policy content for fixed deposits...',
            category: 'POLICY',
            effectiveDate: '2024-06-01T00:00:00Z',
            language: 'en',
          },
        ],
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.documentsProcessed).toBe(1);
      expect(result.updateId).toBeTruthy();
    });

    it('should process document removals', async () => {
      const result = await service.updateCorpus({
        tenantId: 'branch-mumbai-01',
        documents: [],
        removals: ['doc-old-001', 'doc-old-002'],
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.documentsRemoved).toBe(2);
      expect(corpusUpdater.removeDocument).toHaveBeenCalledTimes(2);
    });

    it('should map document category to correct corpus ID', async () => {
      await service.updateCorpus({
        tenantId: 'branch-mumbai-01',
        documents: [
          {
            documentId: 'circ-001',
            documentName: 'New Circular',
            content: 'Circular content...',
            category: 'CIRCULAR',
            effectiveDate: '2024-06-01T00:00:00Z',
            language: 'en',
          },
        ],
      });

      expect(corpusUpdater.ingestDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          corpusId: 'branch-circulars',
        })
      );
    });

    it('should set a deadline of 1 hour from scheduling', async () => {
      const beforeTime = Date.now();
      const result = await service.updateCorpus({
        tenantId: 'branch-mumbai-01',
        documents: [
          {
            documentId: 'doc-001',
            documentName: 'Policy Doc',
            content: 'Content...',
            category: 'POLICY',
            effectiveDate: '2024-06-01T00:00:00Z',
            language: 'en',
          },
        ],
      });

      const deadlineTime = new Date(result.deadline).getTime();
      const expectedDeadline = beforeTime + 60 * 60 * 1000;

      // Deadline should be approximately 1 hour from now (within 5 seconds tolerance)
      expect(deadlineTime).toBeGreaterThanOrEqual(expectedDeadline - 5000);
      expect(deadlineTime).toBeLessThanOrEqual(expectedDeadline + 5000);
    });

    it('should handle multiple documents in a single update', async () => {
      const result = await service.updateCorpus({
        tenantId: 'branch-mumbai-01',
        documents: [
          {
            documentId: 'doc-1',
            documentName: 'Policy 1',
            content: 'Content 1',
            category: 'POLICY',
            effectiveDate: '2024-01-01T00:00:00Z',
            language: 'en',
          },
          {
            documentId: 'doc-2',
            documentName: 'Circular 2',
            content: 'Content 2',
            category: 'CIRCULAR',
            effectiveDate: '2024-02-01T00:00:00Z',
            language: 'en',
          },
          {
            documentId: 'doc-3',
            documentName: 'Product 3',
            content: 'Content 3',
            category: 'PRODUCT',
            effectiveDate: '2024-03-01T00:00:00Z',
            language: 'hi',
          },
        ],
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.documentsProcessed).toBe(3);
      expect(corpusUpdater.ingestDocument).toHaveBeenCalledTimes(3);
    });

    it('should report FAILED status when ingestion adapter throws', async () => {
      const failingUpdater: BranchCorpusUpdateAdapter = {
        ingestDocument: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
        removeDocument: vi.fn().mockResolvedValue(undefined),
      };
      service = new BranchCopilot(retrieval, answerGenerator, failingUpdater);

      const result = await service.updateCorpus({
        tenantId: 'branch-mumbai-01',
        documents: [
          {
            documentId: 'doc-fail',
            documentName: 'Failing Doc',
            content: 'Will fail',
            category: 'POLICY',
            effectiveDate: '2024-06-01T00:00:00Z',
            language: 'en',
          },
        ],
      });

      expect(result.status).toBe('FAILED');
    });

    it('should include processing time in the result', async () => {
      const result = await service.updateCorpus({
        tenantId: 'branch-mumbai-01',
        documents: [
          {
            documentId: 'doc-001',
            documentName: 'Policy Doc',
            content: 'Content...',
            category: 'POLICY',
            effectiveDate: '2024-06-01T00:00:00Z',
            language: 'en',
          },
        ],
      });

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Configuration and accessor tests
  // ==========================================================================

  describe('configuration', () => {
    it('should expose configured confidence threshold', () => {
      expect(service.confidenceThreshold).toBe(0.70);
    });

    it('should allow custom confidence threshold', () => {
      const customService = new BranchCopilot(retrieval, answerGenerator, corpusUpdater, {
        confidenceThreshold: 0.85,
      });
      expect(customService.confidenceThreshold).toBe(0.85);
    });

    it('should expose configured escalation channel', () => {
      expect(service.escalationChannel).toBe('branch-ops-helpdesk');
    });

    it('should allow custom escalation channel', () => {
      const customService = new BranchCopilot(retrieval, answerGenerator, corpusUpdater, {
        defaultEscalationChannel: 'custom-desk',
      });
      expect(customService.escalationChannel).toBe('custom-desk');
    });
  });

  // ==========================================================================
  // Type guard tests
  // ==========================================================================

  describe('isBranchCopilotRefusal type guard', () => {
    it('should return true for refusal responses', async () => {
      retrieval = createMockRetrieval({ groundednessScore: 0.30 });
      service = new BranchCopilot(retrieval, answerGenerator, corpusUpdater);

      const response = await service.query(createDefaultQuery());
      expect(isBranchCopilotRefusal(response)).toBe(true);
    });

    it('should return false for successful answers', async () => {
      const response = await service.query(createDefaultQuery());
      expect(isBranchCopilotRefusal(response)).toBe(false);
    });
  });
});
