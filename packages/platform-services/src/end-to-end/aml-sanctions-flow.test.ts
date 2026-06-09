/**
 * End-to-End AML/Sanctions Flow Integration Tests
 *
 * Validates the full wiring of both flows:
 *
 * AML Flow:
 *   AML Alerts → AML Triage → RAG Pipeline → Human Review Queue → Audit Service
 *
 * Sanctions Flow:
 *   Sanctions Screening → LLM Gateway → Guardrails → Human Review → Audit
 *
 * Covers:
 * - Correct service composition and orchestration
 * - Human review routing based on confidence thresholds and HITL gates
 * - Guardrails enforcement on sanctions screening output
 * - Audit artefact persistence at every flow execution
 * - Error handling when adapters fail
 * - Step tracking and flow status reporting
 *
 * Validates: Requirements 3.1, 4.3, 4.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AMLSanctionsFlow } from './aml-sanctions-flow.js';
import type {
  AMLTriageAdapter,
  RAGPipelineAdapter,
  SanctionsScreeningAdapter,
  LLMGatewayAdapter,
  GuardrailsAdapter,
  HumanReviewAdapter,
  AuditServiceAdapter,
  AMLAlertInput,
  SanctionsScreeningInput,
} from './types.js';

// ─── Mock Adapters ─────────────────────────────────────────────────────────────

class MockAMLTriageAdapter implements AMLTriageAdapter {
  public calls: unknown[] = [];
  public disposition = 'INVESTIGATE';
  public priorityScore = 65;
  public confidence = 0.82;
  public shouldThrow = false;

  async triageAlert(request: Parameters<AMLTriageAdapter['triageAlert']>[0]) {
    if (this.shouldThrow) throw new Error('AML Triage service unavailable');
    this.calls.push(request);
    return {
      disposition: this.disposition,
      priorityScore: this.priorityScore,
      confidence: this.confidence,
      reasoningSummary: `Alert classified as ${this.disposition} with priority ${this.priorityScore}/100. Contributing factors: high transaction velocity; unusual geography.`,
      auditArtefactId: 'aml-triage-audit-001',
    };
  }
}

class MockRAGPipelineAdapter implements RAGPipelineAdapter {
  public calls: unknown[] = [];
  public groundednessScore = 0.85;
  public shouldThrow = false;

  async retrieveCaseHistory(request: Parameters<RAGPipelineAdapter['retrieveCaseHistory']>[0]) {
    if (this.shouldThrow) throw new Error('RAG Pipeline unavailable');
    this.calls.push(request);
    return {
      chunks: [
        {
          chunkId: 'chunk-001',
          content: 'Entity flagged in prior investigation for structuring patterns.',
          source: {
            documentName: 'Case-2023-456',
            section: 'Transaction Analysis',
            publicationDate: '2023-06-15T00:00:00.000Z',
          },
          relevanceScore: 0.92,
        },
        {
          chunkId: 'chunk-002',
          content: 'KYC review completed with enhanced due diligence.',
          source: {
            documentName: 'KYC-ENT-789',
            section: 'Due Diligence',
            publicationDate: '2023-08-20T00:00:00.000Z',
          },
          relevanceScore: 0.78,
        },
      ],
      groundednessScore: this.groundednessScore,
      retrievalLatencyMs: 120,
    };
  }
}

class MockSanctionsScreeningAdapter implements SanctionsScreeningAdapter {
  public calls: unknown[] = [];
  public disposition = 'CLEAR';
  public fallbackUsed = false;
  public disambiguationResult: { confidence: number; [key: string]: unknown } | undefined;
  public shouldThrow = false;

  async screen(request: Parameters<SanctionsScreeningAdapter['screen']>[0]) {
    if (this.shouldThrow) throw new Error('Sanctions Screening service unavailable');
    this.calls.push(request);
    return {
      disposition: this.disposition,
      matchResults: this.disposition === 'CLEAR'
        ? []
        : [{ confidenceScore: 0.72, matchType: 'FUZZY', matchedFields: ['name'] }],
      reasoning: `Entity screening completed. Disposition: ${this.disposition}.`,
      disambiguationResult: this.disambiguationResult,
      fallbackUsed: this.fallbackUsed,
      processingTimeMs: 450,
      auditArtefactId: 'sanctions-audit-001',
    };
  }
}

class MockLLMGatewayAdapter implements LLMGatewayAdapter {
  public calls: unknown[] = [];

  async infer(request: Parameters<LLMGatewayAdapter['infer']>[0]) {
    this.calls.push(request);
    return {
      output: 'LLM disambiguation output: Entity is likely not the same individual.',
      modelId: 'sanctions-disambiguator-7b',
      latencyMs: 2500,
      auditArtefactId: 'llm-audit-001',
    };
  }
}

class MockGuardrailsAdapter implements GuardrailsAdapter {
  public calls: unknown[] = [];
  public passed = true;
  public redactedContent: string | undefined;

  async check(request: Parameters<GuardrailsAdapter['check']>[0]) {
    this.calls.push(request);
    return {
      passed: this.passed,
      flags: this.passed
        ? []
        : [{ type: 'PII_REDACTION', confidence: 0.95, description: 'PII detected and redacted' }],
      redactedContent: this.redactedContent,
      blockReason: this.passed ? undefined : 'PII detected in output',
    };
  }
}

class MockHumanReviewAdapter implements HumanReviewAdapter {
  public calls: unknown[] = [];
  public reviewId = 'review-001';

  async submitForReview(request: Parameters<HumanReviewAdapter['submitForReview']>[0]) {
    this.calls.push(request);
    return {
      reviewId: this.reviewId,
      status: 'PENDING',
      isHighImpact: request.isHighImpact,
    };
  }
}

class MockAuditServiceAdapter implements AuditServiceAdapter {
  public calls: unknown[] = [];
  public auditArtefactId = 'audit-artefact-001';

  async persistArtefact(artefact: Parameters<AuditServiceAdapter['persistArtefact']>[0]) {
    this.calls.push(artefact);
    return this.auditArtefactId;
  }
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

function createAMLAlertInput(overrides?: Partial<AMLAlertInput>): AMLAlertInput {
  return {
    alertId: 'alert-001',
    alertType: 'TRANSACTION_MONITORING',
    entityId: 'entity-123',
    alertData: {
      amount: 150000,
      currency: 'INR',
      alertTimestamp: '2024-01-15T10:30:00.000Z',
      sourceSystem: 'TM-ENGINE',
      triggerRule: 'STRUCTURING_PATTERN',
      riskIndicators: ['high_velocity', 'unusual_geography'],
    },
    jurisdiction: 'IN',
    tenantId: 'afg-india',
    ...overrides,
  };
}

function createSanctionsInput(overrides?: Partial<SanctionsScreeningInput>): SanctionsScreeningInput {
  return {
    requestId: 'screen-001',
    entityName: 'John Smith',
    entityType: 'INDIVIDUAL',
    attributes: { dateOfBirth: '1975-03-15', nationality: 'GB' },
    jurisdiction: 'UK',
    tenantId: 'afg-london',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('AMLSanctionsFlow', () => {
  let amlTriage: MockAMLTriageAdapter;
  let ragPipeline: MockRAGPipelineAdapter;
  let sanctionsScreening: MockSanctionsScreeningAdapter;
  let llmGateway: MockLLMGatewayAdapter;
  let guardrails: MockGuardrailsAdapter;
  let humanReview: MockHumanReviewAdapter;
  let auditService: MockAuditServiceAdapter;
  let flow: AMLSanctionsFlow;

  beforeEach(() => {
    amlTriage = new MockAMLTriageAdapter();
    ragPipeline = new MockRAGPipelineAdapter();
    sanctionsScreening = new MockSanctionsScreeningAdapter();
    llmGateway = new MockLLMGatewayAdapter();
    guardrails = new MockGuardrailsAdapter();
    humanReview = new MockHumanReviewAdapter();
    auditService = new MockAuditServiceAdapter();

    flow = new AMLSanctionsFlow(
      amlTriage,
      ragPipeline,
      sanctionsScreening,
      llmGateway,
      guardrails,
      humanReview,
      auditService
    );
  });

  // ─── AML Flow Tests ─────────────────────────────────────────────────────────

  describe('AML Flow: AML Alerts → AML Triage → RAG Pipeline → Human Review → Audit', () => {
    it('should execute the full AML flow end-to-end with all steps completed', async () => {
      const input = createAMLAlertInput();
      const result = await flow.executeAMLFlow(input);

      expect(result.status).toBe('COMPLETED');
      expect(result.alertId).toBe('alert-001');
      expect(result.disposition).toBe('INVESTIGATE');
      expect(result.priorityScore).toBe(65);
      expect(result.confidence).toBe(0.82);
      expect(result.ragChunksRetrieved).toBe(2);
      expect(result.groundednessScore).toBe(0.85);
      expect(result.auditArtefactId).toBeDefined();
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should invoke AML Triage with the correct alert data', async () => {
      const input = createAMLAlertInput();
      await flow.executeAMLFlow(input);

      expect(amlTriage.calls).toHaveLength(1);
      const call = amlTriage.calls[0] as any;
      expect(call.alertId).toBe('alert-001');
      expect(call.alertType).toBe('TRANSACTION_MONITORING');
      expect(call.entityId).toBe('entity-123');
      expect(call.jurisdiction).toBe('IN');
    });

    it('should retrieve case history via RAG Pipeline', async () => {
      const input = createAMLAlertInput();
      await flow.executeAMLFlow(input);

      expect(ragPipeline.calls).toHaveLength(1);
      const call = ragPipeline.calls[0] as any;
      expect(call.caseId).toBe('alert-001');
      expect(call.tenantId).toBe('afg-india');
      expect(call.jurisdiction).toBe('IN');
      expect(call.corpusIds).toEqual(['aml-case-history']);
    });

    it('should route to human review when disposition is ESCALATE_L2', async () => {
      amlTriage.disposition = 'ESCALATE_L2';
      amlTriage.confidence = 0.90;

      const input = createAMLAlertInput();
      const result = await flow.executeAMLFlow(input);

      expect(result.humanReviewRequired).toBe(true);
      expect(result.reviewId).toBe('review-001');
      expect(humanReview.calls).toHaveLength(1);

      const reviewCall = humanReview.calls[0] as any;
      expect(reviewCall.useCase).toBe('AML_TRIAGE');
      expect(reviewCall.isHighImpact).toBe(true);
      expect(reviewCall.highImpactActionType).toBe('SAR_FILING');
    });

    it('should route to human review when confidence is below threshold', async () => {
      amlTriage.confidence = 0.60; // Below default 0.75 threshold

      const input = createAMLAlertInput();
      const result = await flow.executeAMLFlow(input);

      expect(result.humanReviewRequired).toBe(true);
      expect(humanReview.calls).toHaveLength(1);
    });

    it('should NOT route to human review when confidence is above threshold and disposition is not ESCALATE_L2', async () => {
      amlTriage.disposition = 'RECOMMEND_CLOSURE';
      amlTriage.confidence = 0.90;

      const input = createAMLAlertInput();
      const result = await flow.executeAMLFlow(input);

      expect(result.humanReviewRequired).toBe(false);
      expect(result.reviewId).toBeUndefined();
      expect(humanReview.calls).toHaveLength(0);
    });

    it('should persist audit artefact with complete decision chain', async () => {
      const input = createAMLAlertInput();
      await flow.executeAMLFlow(input);

      expect(auditService.calls).toHaveLength(1);
      const artefact = auditService.calls[0] as any;
      expect(artefact.jurisdiction).toBe('IN');
      expect(artefact.serviceId).toBe('aml-sanctions-flow');
      expect(artefact.inputFeatures.alertId).toBe('alert-001');
      expect(artefact.inputFeatures.entityId).toBe('entity-123');
      expect(artefact.modelOutput.disposition).toBe('INVESTIGATE');
      expect(artefact.confidenceScore).toBe(0.82);
      expect(artefact.decision).toBe('INVESTIGATE');
      expect(artefact.retrievedContext).toHaveLength(2);
    });

    it('should track all flow steps in order', async () => {
      amlTriage.disposition = 'ESCALATE_L2';
      const input = createAMLAlertInput();
      const result = await flow.executeAMLFlow(input);

      const stepNames = result.steps.map((s) => s.step);
      expect(stepNames).toEqual(['AML_TRIAGE', 'RAG_RETRIEVAL', 'HUMAN_REVIEW', 'AUDIT']);
      expect(result.steps.every((s) => s.status === 'COMPLETED')).toBe(true);
    });

    it('should handle AML Triage service failure gracefully', async () => {
      amlTriage.shouldThrow = true;

      const input = createAMLAlertInput();
      const result = await flow.executeAMLFlow(input);

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('AML Triage service unavailable');
      expect(result.steps.some((s) => s.status === 'FAILED')).toBe(true);
    });

    it('should handle RAG Pipeline failure gracefully', async () => {
      ragPipeline.shouldThrow = true;

      const input = createAMLAlertInput();
      const result = await flow.executeAMLFlow(input);

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('RAG Pipeline unavailable');
    });

    it('should use custom corpus IDs when provided', async () => {
      const input = createAMLAlertInput({ corpusIds: ['custom-corpus-1', 'custom-corpus-2'] });
      await flow.executeAMLFlow(input);

      const call = ragPipeline.calls[0] as any;
      expect(call.corpusIds).toEqual(['custom-corpus-1', 'custom-corpus-2']);
    });

    it('should generate a unique flow ID', async () => {
      const input = createAMLAlertInput();
      const result1 = await flow.executeAMLFlow(input);
      const result2 = await flow.executeAMLFlow(input);

      expect(result1.flowId).not.toBe(result2.flowId);
      expect(result1.flowId).toMatch(/^aml-flow-/);
    });
  });

  // ─── Sanctions Flow Tests ───────────────────────────────────────────────────

  describe('Sanctions Flow: Screening → LLM Gateway → Guardrails → Human Review → Audit', () => {
    it('should execute the full sanctions flow end-to-end for a CLEAR disposition', async () => {
      const input = createSanctionsInput();
      const result = await flow.executeSanctionsFlow(input);

      expect(result.status).toBe('COMPLETED');
      expect(result.requestId).toBe('screen-001');
      expect(result.disposition).toBe('CLEAR');
      expect(result.matchCount).toBe(0);
      expect(result.disambiguationPerformed).toBe(false);
      expect(result.humanReviewRequired).toBe(false);
      expect(result.fallbackUsed).toBe(false);
      expect(result.auditArtefactId).toBeDefined();
    });

    it('should invoke Sanctions Screening with the correct entity data', async () => {
      const input = createSanctionsInput();
      await flow.executeSanctionsFlow(input);

      expect(sanctionsScreening.calls).toHaveLength(1);
      const call = sanctionsScreening.calls[0] as any;
      expect(call.requestId).toBe('screen-001');
      expect(call.entityName).toBe('John Smith');
      expect(call.entityType).toBe('INDIVIDUAL');
      expect(call.jurisdiction).toBe('UK');
      expect(call.tenantId).toBe('afg-london');
    });

    it('should apply Guardrails to LLM disambiguation output', async () => {
      sanctionsScreening.disposition = 'PENDING_REVIEW';
      sanctionsScreening.disambiguationResult = {
        confidence: 0.55,
        isMatch: false,
        reasoning: 'Entity attributes differ significantly.',
      };

      const input = createSanctionsInput();
      const result = await flow.executeSanctionsFlow(input);

      expect(guardrails.calls).toHaveLength(1);
      const guardrailCall = guardrails.calls[0] as any;
      expect(guardrailCall.direction).toBe('OUTPUT');
      expect(guardrailCall.checks).toContain('PII_REDACTION');
      expect(guardrailCall.checks).toContain('POLICY_COMPLIANCE');
      expect(guardrailCall.context.useCase).toBe('SANCTIONS_SCREENING');
      expect(result.guardrailsPassed).toBe(true);
    });

    it('should apply Guardrails for non-CLEAR dispositions without disambiguation', async () => {
      sanctionsScreening.disposition = 'ESCALATE';
      sanctionsScreening.disambiguationResult = undefined;

      const input = createSanctionsInput();
      await flow.executeSanctionsFlow(input);

      expect(guardrails.calls).toHaveLength(1);
      const guardrailCall = guardrails.calls[0] as any;
      expect(guardrailCall.direction).toBe('OUTPUT');
    });

    it('should NOT apply Guardrails for CLEAR dispositions without disambiguation', async () => {
      sanctionsScreening.disposition = 'CLEAR';
      sanctionsScreening.disambiguationResult = undefined;

      const input = createSanctionsInput();
      await flow.executeSanctionsFlow(input);

      expect(guardrails.calls).toHaveLength(0);
    });

    it('should route PENDING_REVIEW disposition to human review', async () => {
      sanctionsScreening.disposition = 'PENDING_REVIEW';

      const input = createSanctionsInput();
      const result = await flow.executeSanctionsFlow(input);

      expect(result.humanReviewRequired).toBe(true);
      expect(result.reviewId).toBe('review-001');
      expect(humanReview.calls).toHaveLength(1);

      const reviewCall = humanReview.calls[0] as any;
      expect(reviewCall.useCase).toBe('SANCTIONS_SCREENING');
      expect(reviewCall.jurisdiction).toBe('UK');
    });

    it('should route ESCALATE disposition to human review with high-impact flag', async () => {
      sanctionsScreening.disposition = 'ESCALATE';

      const input = createSanctionsInput();
      const result = await flow.executeSanctionsFlow(input);

      expect(result.humanReviewRequired).toBe(true);
      const reviewCall = humanReview.calls[0] as any;
      expect(reviewCall.isHighImpact).toBe(true);
    });

    it('should NOT route CLEAR disposition to human review', async () => {
      sanctionsScreening.disposition = 'CLEAR';

      const input = createSanctionsInput();
      const result = await flow.executeSanctionsFlow(input);

      expect(result.humanReviewRequired).toBe(false);
      expect(humanReview.calls).toHaveLength(0);
    });

    it('should use redacted content when Guardrails redacts PII', async () => {
      sanctionsScreening.disposition = 'PENDING_REVIEW';
      sanctionsScreening.disambiguationResult = { confidence: 0.60, isMatch: false, reasoning: 'Different person.' };
      guardrails.redactedContent = 'Entity screening completed. Disposition: PENDING_REVIEW. [PII REDACTED]';

      const input = createSanctionsInput();
      await flow.executeSanctionsFlow(input);

      // Audit should receive the redacted content in model output
      const artefact = auditService.calls[0] as any;
      expect(artefact.modelOutput.reasoning).toContain('[PII REDACTED]');
    });

    it('should persist audit artefact with complete screening context', async () => {
      sanctionsScreening.disposition = 'ESCALATE';

      const input = createSanctionsInput();
      await flow.executeSanctionsFlow(input);

      expect(auditService.calls).toHaveLength(1);
      const artefact = auditService.calls[0] as any;
      expect(artefact.jurisdiction).toBe('UK');
      expect(artefact.serviceId).toBe('sanctions-flow');
      expect(artefact.inputFeatures.entityName).toBe('John Smith');
      expect(artefact.inputFeatures.entityType).toBe('INDIVIDUAL');
      expect(artefact.modelOutput.disposition).toBe('ESCALATE');
      expect(artefact.decision).toBe('ESCALATE');
    });

    it('should report fallback usage in the flow result', async () => {
      sanctionsScreening.disposition = 'PENDING_REVIEW';
      sanctionsScreening.fallbackUsed = true;

      const input = createSanctionsInput();
      const result = await flow.executeSanctionsFlow(input);

      expect(result.fallbackUsed).toBe(true);
    });

    it('should track all flow steps for sanctions screening', async () => {
      sanctionsScreening.disposition = 'ESCALATE';
      sanctionsScreening.disambiguationResult = { confidence: 0.92, isMatch: true, reasoning: 'Same entity.' };

      const input = createSanctionsInput();
      const result = await flow.executeSanctionsFlow(input);

      const stepNames = result.steps.map((s) => s.step);
      expect(stepNames).toContain('SANCTIONS_SCREENING');
      expect(stepNames).toContain('LLM_GATEWAY_GUARDRAILS');
      expect(stepNames).toContain('HUMAN_REVIEW');
      expect(stepNames).toContain('AUDIT');
      expect(result.steps.every((s) => s.status === 'COMPLETED')).toBe(true);
    });

    it('should handle Sanctions Screening service failure gracefully', async () => {
      sanctionsScreening.shouldThrow = true;

      const input = createSanctionsInput();
      const result = await flow.executeSanctionsFlow(input);

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('Sanctions Screening service unavailable');
      expect(result.steps.some((s) => s.status === 'FAILED')).toBe(true);
    });

    it('should generate a unique flow ID for sanctions flow', async () => {
      const input = createSanctionsInput();
      const result1 = await flow.executeSanctionsFlow(input);
      const result2 = await flow.executeSanctionsFlow(input);

      expect(result1.flowId).not.toBe(result2.flowId);
      expect(result1.flowId).toMatch(/^sanctions-flow-/);
    });

    it('should report disambiguation performed when result exists', async () => {
      sanctionsScreening.disposition = 'CLEAR';
      sanctionsScreening.disambiguationResult = { confidence: 0.85, isMatch: false, reasoning: 'Different entity.' };

      const input = createSanctionsInput();
      const result = await flow.executeSanctionsFlow(input);

      expect(result.disambiguationPerformed).toBe(true);
    });
  });

  // ─── Cross-Flow Integration Tests ──────────────────────────────────────────

  describe('Cross-flow integration', () => {
    it('should allow executing both flows independently on the same instance', async () => {
      const amlInput = createAMLAlertInput();
      const sanctionsInput = createSanctionsInput();

      const amlResult = await flow.executeAMLFlow(amlInput);
      const sanctionsResult = await flow.executeSanctionsFlow(sanctionsInput);

      expect(amlResult.status).toBe('COMPLETED');
      expect(sanctionsResult.status).toBe('COMPLETED');
      expect(amlResult.flowId).not.toBe(sanctionsResult.flowId);
    });

    it('should use separate service IDs for AML and Sanctions audit artefacts', async () => {
      amlTriage.disposition = 'INVESTIGATE';
      sanctionsScreening.disposition = 'CLEAR';

      await flow.executeAMLFlow(createAMLAlertInput());
      await flow.executeSanctionsFlow(createSanctionsInput());

      expect(auditService.calls).toHaveLength(2);
      const amlAudit = auditService.calls[0] as any;
      const sanctionsAudit = auditService.calls[1] as any;
      expect(amlAudit.serviceId).toBe('aml-sanctions-flow');
      expect(sanctionsAudit.serviceId).toBe('sanctions-flow');
    });

    it('should pass custom AML configuration through constructor', () => {
      const customFlow = new AMLSanctionsFlow(
        amlTriage,
        ragPipeline,
        sanctionsScreening,
        llmGateway,
        guardrails,
        humanReview,
        auditService,
        { confidenceThreshold: 0.90, groundednessThreshold: 0.80 },
        { confidenceThreshold: 0.85 }
      );

      // Verify it doesn't throw and can be used
      expect(customFlow).toBeDefined();
    });

    it('should respect custom confidence threshold for human review routing', async () => {
      // Create flow with high confidence threshold (0.90)
      const strictFlow = new AMLSanctionsFlow(
        amlTriage,
        ragPipeline,
        sanctionsScreening,
        llmGateway,
        guardrails,
        humanReview,
        auditService,
        { confidenceThreshold: 0.90 }
      );

      // Confidence 0.82 is below the custom 0.90 threshold
      amlTriage.confidence = 0.82;
      amlTriage.disposition = 'INVESTIGATE';

      const result = await strictFlow.executeAMLFlow(createAMLAlertInput());
      expect(result.humanReviewRequired).toBe(true);
    });
  });
});
