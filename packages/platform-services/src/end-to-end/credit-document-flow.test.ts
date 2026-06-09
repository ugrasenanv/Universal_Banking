/**
 * End-to-End Credit and Document Flow Integration Tests
 *
 * Validates the wiring of three service chains:
 * 1. Credit applications → Credit Underwriting → Feature Store → Human Review → Audit
 * 2. Document submission → Document Intelligence → Human Review → Audit
 * 3. NBA Engine → Feature Store → LLM Gateway → Audit
 *
 * Covers:
 * - Correct service composition and data propagation
 * - Human review routing for low-confidence / high-impact decisions
 * - Audit artefact persistence for every decision
 * - LLM enrichment in the NBA flow
 * - Error handling and graceful degradation
 *
 * Validates: Requirements 5.1, 9.1, 11.1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CreditDocumentFlowOrchestrator,
  DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG,
  type CreditUnderwritingAdapter,
  type FeatureStoreAdapter,
  type HumanReviewAdapter,
  type AuditAdapter,
  type DocumentIntelligenceAdapter,
  type NBAEngineAdapter,
  type LLMGatewayAdapter,
  type CreditApplicationInput,
  type CreditDecisionOutput,
  type DocumentSubmissionInput,
  type DocumentExtractionOutput,
  type NBARecommendationInput,
  type NBARecommendationOutput,
  type FeatureRetrievalRequest,
  type FeatureRetrievalResponse,
  type HumanReviewSubmission,
  type HumanReviewResult,
  type AuditArtefactInput,
  type LLMInferenceInput,
  type LLMInferenceOutput,
} from './credit-document-flow.js';

// ─── Mock Adapters ─────────────────────────────────────────────────────────────

class MockCreditUnderwritingAdapter implements CreditUnderwritingAdapter {
  public calls: CreditApplicationInput[] = [];
  public decision: CreditDecisionOutput['decision'] = 'APPROVE';
  public confidence = 0.92;
  public creditScore = 720;

  async processApplication(request: CreditApplicationInput): Promise<CreditDecisionOutput> {
    this.calls.push(request);
    return {
      applicationId: request.applicationId,
      decision: this.decision,
      creditScore: this.creditScore,
      confidence: this.confidence,
      riskFactors: [
        { factorName: 'payment_history', weight: 0.35, explanation: 'Strong payment history', rank: 1 },
        { factorName: 'credit_utilisation', weight: 0.25, explanation: 'Low utilisation ratio', rank: 2 },
        { factorName: 'credit_age', weight: 0.20, explanation: 'Long credit history', rank: 3 },
        { factorName: 'income_stability', weight: 0.15, explanation: 'Stable income', rank: 4 },
      ],
      modelVersion: 'credit-model-v3.2.0',
      alternateDataUsed: !request.alternateDataConsent ? false : true,
    };
  }
}

class MockFeatureStoreAdapter implements FeatureStoreAdapter {
  public calls: FeatureRetrievalRequest[] = [];
  public latencyMs = 5;

  async getFeatures(request: FeatureRetrievalRequest): Promise<FeatureRetrievalResponse> {
    this.calls.push(request);
    return {
      entityId: request.entityId,
      features: {
        'bureau_score.value': 720,
        'behaviour_90d.payment_ratio': 0.95,
        'txn_velocity_30d.count': 45,
        'channel_engagement.app_opens_7d': 12,
        'product_holdings.count': 3,
      },
      freshnessTimestamp: new Date().toISOString(),
      latencyMs: this.latencyMs,
    };
  }
}

class MockHumanReviewAdapter implements HumanReviewAdapter {
  public submissions: HumanReviewSubmission[] = [];
  public approvedReviews = new Set<string>();
  private reviewCounter = 0;

  async submitForReview(request: HumanReviewSubmission): Promise<HumanReviewResult> {
    this.submissions.push(request);
    const reviewId = `review-${++this.reviewCounter}`;
    return {
      reviewId,
      status: 'PENDING',
      queuedAt: new Date().toISOString(),
    };
  }

  async isApproved(reviewId: string): Promise<boolean> {
    return this.approvedReviews.has(reviewId);
  }
}

class MockAuditAdapter implements AuditAdapter {
  public artefacts: AuditArtefactInput[] = [];
  private counter = 0;

  async persist(artefact: AuditArtefactInput): Promise<string> {
    this.artefacts.push(artefact);
    return `audit-${++this.counter}`;
  }
}

class MockDocumentIntelligenceAdapter implements DocumentIntelligenceAdapter {
  public calls: DocumentSubmissionInput[] = [];
  public overallConfidence = 0.92;
  public requiresHumanReview = false;

  async extractDocument(request: DocumentSubmissionInput): Promise<DocumentExtractionOutput> {
    this.calls.push(request);
    return {
      documentId: request.documentId,
      extractedFields: [
        { fieldName: 'full_name', value: 'John Smith', confidence: 0.95, needsReview: false },
        { fieldName: 'document_number', value: 'AB123456', confidence: 0.88, needsReview: false },
        { fieldName: 'date_of_birth', value: '1985-06-15', confidence: 0.91, needsReview: false },
      ],
      overallConfidence: this.overallConfidence,
      processingTimeMs: 1200,
      requiresHumanReview: this.requiresHumanReview,
      flaggedFields: this.overallConfidence < 0.85 ? ['document_number'] : [],
      auditArtefactId: `doc-audit-${request.documentId}`,
    };
  }
}

class MockNBAEngineAdapter implements NBAEngineAdapter {
  public calls: NBARecommendationInput[] = [];
  public recommendations = [
    {
      recommendationId: 'rec-001',
      productCategory: 'SAVINGS',
      productName: 'High-Yield Savings Account',
      relevanceScore: 0.92,
      reasoning: 'High balance in current account suggests savings opportunity',
      rank: 1,
    },
    {
      recommendationId: 'rec-002',
      productCategory: 'INSURANCE',
      productName: 'Term Life Insurance',
      relevanceScore: 0.85,
      reasoning: 'Life event detected: new dependant',
      rank: 2,
    },
  ];

  async getMobileRecommendations(request: NBARecommendationInput): Promise<NBARecommendationOutput> {
    this.calls.push(request);
    return {
      customerId: request.customerId,
      recommendations: this.recommendations,
      processingTimeMs: 150,
      signalsFresh: true,
      auditArtefactId: `nba-audit-${request.customerId}`,
    };
  }
}

class MockLLMGatewayAdapter implements LLMGatewayAdapter {
  public calls: LLMInferenceInput[] = [];
  public shouldFail = false;

  async infer(request: LLMInferenceInput): Promise<LLMInferenceOutput> {
    this.calls.push(request);
    if (this.shouldFail) {
      throw new Error('LLM Gateway unavailable');
    }
    return {
      requestId: request.requestId,
      output: 'Based on your recent activity, we recommend a High-Yield Savings Account to optimise your idle funds.',
      modelId: 'llm-medium-30b',
      modelVersion: '2.1.0',
      tokenUsage: { prompt: 250, completion: 45, total: 295 },
      latencyMs: 800,
      costUnits: 0.003,
      auditArtefactId: `llm-audit-${request.requestId}`,
    };
  }
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

function createCreditInput(overrides?: Partial<CreditApplicationInput>): CreditApplicationInput {
  return {
    applicationId: 'app-001',
    applicationType: 'RETAIL_UNSECURED',
    customerId: 'cust-123',
    jurisdiction: 'IN',
    alternateDataConsent: true,
    applicantData: { income: 80000, employment: 'SALARIED' },
    ...overrides,
  };
}

function createDocumentInput(overrides?: Partial<DocumentSubmissionInput>): DocumentSubmissionInput {
  return {
    documentId: 'doc-001',
    documentType: 'NATIONAL_ID',
    binary: Buffer.from('mock-document-binary-content'),
    expectedFields: ['full_name', 'document_number', 'date_of_birth'],
    jurisdiction: 'IN',
    ...overrides,
  };
}

function createNBAInput(overrides?: Partial<NBARecommendationInput>): NBARecommendationInput {
  return {
    customerId: 'cust-456',
    segment: 'RETAIL',
    channel: 'MOBILE_APP',
    jurisdiction: 'IN',
    maxRecommendations: 5,
    requestTimestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('CreditDocumentFlowOrchestrator', () => {
  let creditUnderwriting: MockCreditUnderwritingAdapter;
  let featureStore: MockFeatureStoreAdapter;
  let humanReview: MockHumanReviewAdapter;
  let audit: MockAuditAdapter;
  let documentIntelligence: MockDocumentIntelligenceAdapter;
  let nbaEngine: MockNBAEngineAdapter;
  let llmGateway: MockLLMGatewayAdapter;
  let orchestrator: CreditDocumentFlowOrchestrator;

  beforeEach(() => {
    creditUnderwriting = new MockCreditUnderwritingAdapter();
    featureStore = new MockFeatureStoreAdapter();
    humanReview = new MockHumanReviewAdapter();
    audit = new MockAuditAdapter();
    documentIntelligence = new MockDocumentIntelligenceAdapter();
    nbaEngine = new MockNBAEngineAdapter();
    llmGateway = new MockLLMGatewayAdapter();

    orchestrator = new CreditDocumentFlowOrchestrator({
      creditUnderwriting,
      featureStore,
      humanReview,
      audit,
      documentIntelligence,
      nbaEngine,
      llmGateway,
    });
  });

  // ─── Credit Flow Tests ─────────────────────────────────────────────────────

  describe('Credit Application Flow (Requirement 5.1)', () => {
    it('should execute the full credit flow: Feature Store → Credit Underwriting → Audit', async () => {
      const input = createCreditInput();
      const result = await orchestrator.executeCreditFlow(input);

      expect(result.applicationId).toBe('app-001');
      expect(result.decision).toBe('APPROVE');
      expect(result.creditScore).toBe(720);
      expect(result.confidence).toBe(0.92);
      expect(result.auditArtefactId).toBeDefined();
      expect(result.totalProcessingMs).toBeGreaterThanOrEqual(0);
    });

    it('should fetch features from Feature Store with correct credit feature groups', async () => {
      const input = createCreditInput();
      await orchestrator.executeCreditFlow(input);

      expect(featureStore.calls).toHaveLength(1);
      expect(featureStore.calls[0].entityId).toBe('cust-123');
      expect(featureStore.calls[0].entityType).toBe('CUSTOMER');
      expect(featureStore.calls[0].featureGroups).toEqual(
        DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.creditFeatureGroups
      );
    });

    it('should pass the application to Credit Underwriting service', async () => {
      const input = createCreditInput();
      await orchestrator.executeCreditFlow(input);

      expect(creditUnderwriting.calls).toHaveLength(1);
      expect(creditUnderwriting.calls[0].applicationId).toBe('app-001');
      expect(creditUnderwriting.calls[0].applicationType).toBe('RETAIL_UNSECURED');
    });

    it('should route DECLINE decisions to Human Review with high-impact flag', async () => {
      creditUnderwriting.decision = 'DECLINE';
      creditUnderwriting.confidence = 0.85;

      const input = createCreditInput();
      const result = await orchestrator.executeCreditFlow(input);

      expect(result.status).toBe('PENDING_REVIEW');
      expect(result.humanReviewId).toBe('review-1');
      expect(humanReview.submissions).toHaveLength(1);
      expect(humanReview.submissions[0].isHighImpact).toBe(true);
      expect(humanReview.submissions[0].highImpactActionType).toBe('CREDIT_DECLINE');
    });

    it('should route REFER_TO_HUMAN decisions to Human Review', async () => {
      creditUnderwriting.decision = 'REFER_TO_HUMAN';
      creditUnderwriting.confidence = 0.55;

      const input = createCreditInput();
      const result = await orchestrator.executeCreditFlow(input);

      expect(result.status).toBe('PENDING_REVIEW');
      expect(result.humanReviewId).toBeDefined();
      expect(humanReview.submissions[0].useCase).toBe('CREDIT_UNDERWRITING');
    });

    it('should route low-confidence APPROVE decisions to Human Review', async () => {
      creditUnderwriting.decision = 'APPROVE';
      creditUnderwriting.confidence = 0.55; // below threshold of 0.70

      const input = createCreditInput();
      const result = await orchestrator.executeCreditFlow(input);

      expect(result.status).toBe('PENDING_REVIEW');
      expect(result.humanReviewId).toBeDefined();
    });

    it('should not route high-confidence APPROVE decisions to Human Review', async () => {
      creditUnderwriting.decision = 'APPROVE';
      creditUnderwriting.confidence = 0.92;

      const input = createCreditInput();
      const result = await orchestrator.executeCreditFlow(input);

      expect(result.status).toBe('COMPLETED');
      expect(result.humanReviewId).toBeUndefined();
      expect(humanReview.submissions).toHaveLength(0);
    });

    it('should persist an audit artefact for every credit decision', async () => {
      const input = createCreditInput();
      await orchestrator.executeCreditFlow(input);

      expect(audit.artefacts).toHaveLength(1);
      const artefact = audit.artefacts[0];
      expect(artefact.serviceId).toBe('credit-underwriting-service');
      expect(artefact.jurisdiction).toBe('IN');
      expect(artefact.modelVersion).toBe('credit-model-v3.2.0');
      expect(artefact.confidenceScore).toBe(0.92);
      expect(artefact.decision).toBe('APPROVE');
    });

    it('should include features in audit artefact input', async () => {
      const input = createCreditInput();
      await orchestrator.executeCreditFlow(input);

      const artefact = audit.artefacts[0];
      expect(artefact.inputFeatures).toBeDefined();
      expect(artefact.inputFeatures['bureau_score.value']).toBe(720);
    });

    it('should include model output in audit artefact', async () => {
      const input = createCreditInput();
      await orchestrator.executeCreditFlow(input);

      const artefact = audit.artefacts[0];
      const output = artefact.modelOutput as any;
      expect(output.decision).toBe('APPROVE');
      expect(output.creditScore).toBe(720);
      expect(output.riskFactors).toHaveLength(4);
    });

    it('should return feature store latency in the result', async () => {
      featureStore.latencyMs = 8;
      const input = createCreditInput();
      const result = await orchestrator.executeCreditFlow(input);

      expect(result.featureLatencyMs).toBe(8);
    });

    it('should handle SME applications correctly', async () => {
      const input = createCreditInput({ applicationType: 'SME_WORKING_CAPITAL' });
      await orchestrator.executeCreditFlow(input);

      expect(creditUnderwriting.calls[0].applicationType).toBe('SME_WORKING_CAPITAL');
    });

    it('should propagate jurisdiction to audit artefact', async () => {
      const input = createCreditInput({ jurisdiction: 'SG' });
      await orchestrator.executeCreditFlow(input);

      expect(audit.artefacts[0].jurisdiction).toBe('SG');
    });

    it('should propagate jurisdiction to human review submission', async () => {
      creditUnderwriting.decision = 'DECLINE';
      const input = createCreditInput({ jurisdiction: 'AE' });
      await orchestrator.executeCreditFlow(input);

      expect(humanReview.submissions[0].jurisdiction).toBe('AE');
    });
  });

  // ─── Document Flow Tests ───────────────────────────────────────────────────

  describe('Document Submission Flow (Requirement 9.1)', () => {
    it('should execute the full document flow: Document Intelligence → Audit', async () => {
      const input = createDocumentInput();
      const result = await orchestrator.executeDocumentFlow(input);

      expect(result.documentId).toBe('doc-001');
      expect(result.status).toBe('COMPLETED');
      expect(result.overallConfidence).toBe(0.92);
      expect(result.extractedFields).toHaveLength(3);
      expect(result.auditArtefactId).toBeDefined();
      expect(result.totalProcessingMs).toBeGreaterThanOrEqual(0);
    });

    it('should pass document to Document Intelligence service', async () => {
      const input = createDocumentInput();
      await orchestrator.executeDocumentFlow(input);

      expect(documentIntelligence.calls).toHaveLength(1);
      expect(documentIntelligence.calls[0].documentId).toBe('doc-001');
      expect(documentIntelligence.calls[0].documentType).toBe('NATIONAL_ID');
    });

    it('should route low-confidence extractions to Human Review', async () => {
      documentIntelligence.overallConfidence = 0.72; // below 0.85 threshold

      const input = createDocumentInput();
      const result = await orchestrator.executeDocumentFlow(input);

      expect(result.status).toBe('PENDING_REVIEW');
      expect(result.humanReviewId).toBeDefined();
      expect(humanReview.submissions).toHaveLength(1);
      expect(humanReview.submissions[0].useCase).toBe('DOCUMENT_EXTRACTION');
    });

    it('should route documents flagged by service to Human Review', async () => {
      documentIntelligence.requiresHumanReview = true;
      documentIntelligence.overallConfidence = 0.88;

      const input = createDocumentInput();
      const result = await orchestrator.executeDocumentFlow(input);

      expect(result.status).toBe('PENDING_REVIEW');
      expect(result.humanReviewId).toBeDefined();
    });

    it('should not route high-confidence extractions to Human Review', async () => {
      documentIntelligence.overallConfidence = 0.92;
      documentIntelligence.requiresHumanReview = false;

      const input = createDocumentInput();
      const result = await orchestrator.executeDocumentFlow(input);

      expect(result.status).toBe('COMPLETED');
      expect(result.humanReviewId).toBeUndefined();
      expect(humanReview.submissions).toHaveLength(0);
    });

    it('should persist an audit artefact for every document extraction', async () => {
      const input = createDocumentInput();
      await orchestrator.executeDocumentFlow(input);

      expect(audit.artefacts).toHaveLength(1);
      const artefact = audit.artefacts[0];
      expect(artefact.serviceId).toBe('document-intelligence-service');
      expect(artefact.jurisdiction).toBe('IN');
      expect(artefact.confidenceScore).toBe(0.92);
      expect(artefact.decision).toBe('EXTRACTED');
    });

    it('should mark audit decision as REQUIRES_HUMAN_REVIEW when routing to review', async () => {
      documentIntelligence.overallConfidence = 0.72;

      const input = createDocumentInput();
      await orchestrator.executeDocumentFlow(input);

      expect(audit.artefacts[0].decision).toBe('REQUIRES_HUMAN_REVIEW');
    });

    it('should include document type and ID in audit artefact input features', async () => {
      const input = createDocumentInput({ documentType: 'LETTER_OF_CREDIT' });
      await orchestrator.executeDocumentFlow(input);

      const artefact = audit.artefacts[0];
      expect(artefact.inputFeatures['documentType']).toBe('LETTER_OF_CREDIT');
      expect(artefact.inputFeatures['documentId']).toBe('doc-001');
    });

    it('should include extracted fields in audit artefact model output', async () => {
      const input = createDocumentInput();
      await orchestrator.executeDocumentFlow(input);

      const output = audit.artefacts[0].modelOutput as any;
      expect(output.extractedFields).toHaveLength(3);
      expect(output.overallConfidence).toBe(0.92);
    });

    it('should support trade-finance document types', async () => {
      const input = createDocumentInput({ documentType: 'BILL_OF_LADING' });
      await orchestrator.executeDocumentFlow(input);

      expect(documentIntelligence.calls[0].documentType).toBe('BILL_OF_LADING');
    });

    it('should propagate jurisdiction through the document flow', async () => {
      const input = createDocumentInput({ jurisdiction: 'GB' });
      await orchestrator.executeDocumentFlow(input);

      expect(audit.artefacts[0].jurisdiction).toBe('GB');
    });

    it('should include flagged fields in human review context', async () => {
      documentIntelligence.overallConfidence = 0.72;

      const input = createDocumentInput();
      await orchestrator.executeDocumentFlow(input);

      const submission = humanReview.submissions[0];
      expect(submission.decisionChain.context['flaggedFields']).toContain('document_number');
    });
  });

  // ─── NBA Flow Tests ────────────────────────────────────────────────────────

  describe('NBA Engine Flow (Requirement 11.1)', () => {
    it('should execute the full NBA flow: Feature Store → NBA Engine → LLM Gateway → Audit', async () => {
      const input = createNBAInput();
      const result = await orchestrator.executeNBAFlow(input);

      expect(result.customerId).toBe('cust-456');
      expect(result.status).toBe('COMPLETED');
      expect(result.recommendations).toHaveLength(2);
      expect(result.llmEnrichment).toBeDefined();
      expect(result.auditArtefactId).toBeDefined();
      expect(result.totalProcessingMs).toBeGreaterThanOrEqual(0);
    });

    it('should fetch real-time signals from Feature Store with NBA feature groups', async () => {
      const input = createNBAInput();
      await orchestrator.executeNBAFlow(input);

      expect(featureStore.calls).toHaveLength(1);
      expect(featureStore.calls[0].entityId).toBe('cust-456');
      expect(featureStore.calls[0].entityType).toBe('CUSTOMER');
      expect(featureStore.calls[0].featureGroups).toEqual(
        DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.nbaFeatureGroups
      );
    });

    it('should pass request to NBA Engine for recommendation computation', async () => {
      const input = createNBAInput();
      await orchestrator.executeNBAFlow(input);

      expect(nbaEngine.calls).toHaveLength(1);
      expect(nbaEngine.calls[0].customerId).toBe('cust-456');
      expect(nbaEngine.calls[0].channel).toBe('MOBILE_APP');
    });

    it('should enrich recommendations via LLM Gateway', async () => {
      const input = createNBAInput();
      const result = await orchestrator.executeNBAFlow(input);

      expect(llmGateway.calls).toHaveLength(1);
      expect(result.llmEnrichment).toBeDefined();
      expect(result.llmEnrichment!.output).toContain('High-Yield Savings Account');
      expect(result.llmEnrichment!.modelId).toBe('llm-medium-30b');
      expect(result.llmEnrichment!.latencyMs).toBe(800);
    });

    it('should pass correct LLM routing hints for NBA enrichment', async () => {
      const input = createNBAInput();
      await orchestrator.executeNBAFlow(input);

      const llmCall = llmGateway.calls[0];
      expect(llmCall.routingHints.maxLatencyMs).toBe(2000);
      expect(llmCall.routingHints.costCeiling).toBe('MEDIUM');
      expect(llmCall.routingHints.qualityFloor).toBe('STANDARD');
    });

    it('should include recommendations and features in LLM variables', async () => {
      const input = createNBAInput();
      await orchestrator.executeNBAFlow(input);

      const llmCall = llmGateway.calls[0];
      expect(llmCall.variables['customerId']).toBe('cust-456');
      expect(llmCall.variables['recommendations']).toBeDefined();
      expect(llmCall.variables['features']).toBeDefined();
    });

    it('should gracefully handle LLM Gateway failure without breaking the flow', async () => {
      llmGateway.shouldFail = true;

      const input = createNBAInput();
      const result = await orchestrator.executeNBAFlow(input);

      // Flow should still complete successfully
      expect(result.status).toBe('COMPLETED');
      expect(result.recommendations).toHaveLength(2);
      expect(result.llmEnrichment).toBeUndefined();
      expect(result.auditArtefactId).toBeDefined();
    });

    it('should skip LLM enrichment when no recommendations are generated', async () => {
      nbaEngine.recommendations = [];

      const input = createNBAInput();
      const result = await orchestrator.executeNBAFlow(input);

      expect(result.recommendations).toHaveLength(0);
      expect(result.llmEnrichment).toBeUndefined();
      expect(llmGateway.calls).toHaveLength(0);
    });

    it('should persist an audit artefact for every NBA session', async () => {
      const input = createNBAInput();
      await orchestrator.executeNBAFlow(input);

      expect(audit.artefacts).toHaveLength(1);
      const artefact = audit.artefacts[0];
      expect(artefact.serviceId).toBe('nba-engine');
      expect(artefact.jurisdiction).toBe('IN');
      expect(artefact.decision).toBe('RECOMMENDATIONS_GENERATED');
    });

    it('should include recommendations in audit artefact model output', async () => {
      const input = createNBAInput();
      await orchestrator.executeNBAFlow(input);

      const output = audit.artefacts[0].modelOutput as any;
      expect(output.recommendations).toHaveLength(2);
      expect(output.llmEnrichment).toBeDefined();
    });

    it('should include feature store features in audit artefact input', async () => {
      const input = createNBAInput();
      await orchestrator.executeNBAFlow(input);

      const artefact = audit.artefacts[0];
      expect(artefact.inputFeatures['channel_engagement.app_opens_7d']).toBe(12);
      expect(artefact.inputFeatures['product_holdings.count']).toBe(3);
    });

    it('should return feature store latency in the result', async () => {
      featureStore.latencyMs = 3;
      const input = createNBAInput();
      const result = await orchestrator.executeNBAFlow(input);

      expect(result.featureLatencyMs).toBe(3);
    });

    it('should use the configured prompt registry ID and version', async () => {
      const input = createNBAInput();
      await orchestrator.executeNBAFlow(input);

      const llmCall = llmGateway.calls[0];
      expect(llmCall.promptRegistryId).toBe('nba-recommendation-enrichment');
      expect(llmCall.promptVersion).toBe('1.0.0');
    });

    it('should propagate jurisdiction to LLM Gateway calls', async () => {
      const input = createNBAInput({ jurisdiction: 'SG' });
      await orchestrator.executeNBAFlow(input);

      expect(llmGateway.calls[0].jurisdiction).toBe('SG');
    });

    it('should use relevance score of first recommendation as confidence score in audit', async () => {
      const input = createNBAInput();
      await orchestrator.executeNBAFlow(input);

      expect(audit.artefacts[0].confidenceScore).toBe(0.92);
    });

    it('should set confidence score to 0 when no recommendations produced', async () => {
      nbaEngine.recommendations = [];

      const input = createNBAInput();
      await orchestrator.executeNBAFlow(input);

      expect(audit.artefacts[0].confidenceScore).toBe(0);
    });
  });

  // ─── Cross-Flow Integration Tests ──────────────────────────────────────────

  describe('Cross-flow integration', () => {
    it('should execute all three flows independently on the same orchestrator', async () => {
      const creditResult = await orchestrator.executeCreditFlow(createCreditInput());
      const docResult = await orchestrator.executeDocumentFlow(createDocumentInput());
      const nbaResult = await orchestrator.executeNBAFlow(createNBAInput());

      expect(creditResult.status).toBe('COMPLETED');
      expect(docResult.status).toBe('COMPLETED');
      expect(nbaResult.status).toBe('COMPLETED');
      expect(audit.artefacts).toHaveLength(3);
    });

    it('should produce separate audit artefacts for each flow', async () => {
      await orchestrator.executeCreditFlow(createCreditInput());
      await orchestrator.executeDocumentFlow(createDocumentInput());
      await orchestrator.executeNBAFlow(createNBAInput());

      const serviceIds = audit.artefacts.map((a) => a.serviceId);
      expect(serviceIds).toContain('credit-underwriting-service');
      expect(serviceIds).toContain('document-intelligence-service');
      expect(serviceIds).toContain('nba-engine');
    });

    it('should use the correct feature groups per flow type', async () => {
      await orchestrator.executeCreditFlow(createCreditInput());
      await orchestrator.executeNBAFlow(createNBAInput());

      // Credit flow uses credit feature groups
      expect(featureStore.calls[0].featureGroups).toEqual(
        DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.creditFeatureGroups
      );
      // NBA flow uses NBA feature groups
      expect(featureStore.calls[1].featureGroups).toEqual(
        DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.nbaFeatureGroups
      );
    });

    it('should support custom configuration overrides', () => {
      const customOrchestrator = new CreditDocumentFlowOrchestrator({
        creditUnderwriting,
        featureStore,
        humanReview,
        audit,
        documentIntelligence,
        nbaEngine,
        llmGateway,
        config: {
          creditConfidenceThreshold: 0.80,
          documentConfidenceThreshold: 0.90,
        },
      });

      // Verify it constructs without error
      expect(customOrchestrator).toBeDefined();
    });

    it('should use custom confidence threshold when provided', async () => {
      const customOrchestrator = new CreditDocumentFlowOrchestrator({
        creditUnderwriting,
        featureStore,
        humanReview,
        audit,
        documentIntelligence,
        nbaEngine,
        llmGateway,
        config: { creditConfidenceThreshold: 0.95 },
      });

      creditUnderwriting.confidence = 0.92; // above default 0.70 but below custom 0.95

      const result = await customOrchestrator.executeCreditFlow(createCreditInput());

      // Should route to review since 0.92 < 0.95
      expect(result.status).toBe('PENDING_REVIEW');
    });
  });

  // ─── Default Configuration Tests ───────────────────────────────────────────

  describe('Default configuration', () => {
    it('should define credit confidence threshold at 0.70', () => {
      expect(DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.creditConfidenceThreshold).toBe(0.70);
    });

    it('should define document confidence threshold at 0.85', () => {
      expect(DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.documentConfidenceThreshold).toBe(0.85);
    });

    it('should define credit feature groups', () => {
      expect(DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.creditFeatureGroups).toContain('bureau_score');
      expect(DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.creditFeatureGroups).toContain('behaviour_90d');
    });

    it('should define NBA feature groups', () => {
      expect(DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.nbaFeatureGroups).toContain('channel_engagement');
      expect(DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.nbaFeatureGroups).toContain('product_holdings');
    });

    it('should define NBA LLM prompt registry configuration', () => {
      expect(DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.nbaLLMPromptRegistryId).toBe('nba-recommendation-enrichment');
      expect(DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG.nbaLLMPromptVersion).toBe('1.0.0');
    });
  });
});
