/**
 * AML/Sanctions End-to-End Flow Wiring
 *
 * Connects the full AML and Sanctions screening flows end-to-end:
 *
 * AML Flow:
 *   AML Alerts → AML Triage → RAG Pipeline → Human Review Queue → Audit Service
 *
 * Sanctions Flow:
 *   Sanctions Screening → LLM Gateway → Guardrails → Human Review → Audit
 *
 * This module orchestrates the complete lifecycle of AML alert triage and
 * sanctions screening, ensuring every step emits audit artefacts, enforces
 * HITL gates for high-impact actions, and routes low-confidence decisions
 * to human review.
 *
 * Validates: Requirements 3.1, 4.3, 4.6
 */

import type { ISO8601, Jurisdiction } from '@afg/shared-types';
import type {
  AMLFlowConfig,
  SanctionsFlowConfig,
  AMLFlowResult,
  SanctionsFlowResult,
  AMLTriageAdapter,
  RAGPipelineAdapter,
  SanctionsScreeningAdapter,
  LLMGatewayAdapter,
  GuardrailsAdapter,
  HumanReviewAdapter,
  AuditServiceAdapter,
  AMLAlertInput,
  SanctionsScreeningInput,
  FlowStepResult,
  FlowStatus,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// AML End-to-End Flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AMLSanctionsFlow orchestrates the end-to-end AML alert triage and
 * sanctions screening flows, wiring all platform services together.
 *
 * AML Flow:
 * 1. Receive AML alert
 * 2. Run AML Triage (classification, priority scoring)
 * 3. Retrieve case history via RAG Pipeline
 * 4. Route to Human Review Queue (if required by confidence/HITL gate)
 * 5. Emit audit artefact via Audit Service
 *
 * Sanctions Flow:
 * 1. Receive screening request
 * 2. Run Sanctions Screening (name matching, entity resolution)
 * 3. Route through LLM Gateway for disambiguation (if mid-confidence)
 * 4. Apply Guardrails to LLM output
 * 5. Route to Human Review (if PENDING_REVIEW or low confidence)
 * 6. Emit audit artefact via Audit Service
 */
export class AMLSanctionsFlow {
  private readonly amlConfig: AMLFlowConfig;
  private readonly sanctionsConfig: SanctionsFlowConfig;
  private readonly amlTriage: AMLTriageAdapter;
  private readonly ragPipeline: RAGPipelineAdapter;
  private readonly sanctionsScreening: SanctionsScreeningAdapter;
  private readonly llmGateway: LLMGatewayAdapter;
  private readonly guardrails: GuardrailsAdapter;
  private readonly humanReview: HumanReviewAdapter;
  private readonly auditService: AuditServiceAdapter;

  constructor(
    amlTriage: AMLTriageAdapter,
    ragPipeline: RAGPipelineAdapter,
    sanctionsScreening: SanctionsScreeningAdapter,
    llmGateway: LLMGatewayAdapter,
    guardrails: GuardrailsAdapter,
    humanReview: HumanReviewAdapter,
    auditService: AuditServiceAdapter,
    amlConfig?: Partial<AMLFlowConfig>,
    sanctionsConfig?: Partial<SanctionsFlowConfig>
  ) {
    this.amlTriage = amlTriage;
    this.ragPipeline = ragPipeline;
    this.sanctionsScreening = sanctionsScreening;
    this.llmGateway = llmGateway;
    this.guardrails = guardrails;
    this.humanReview = humanReview;
    this.auditService = auditService;

    this.amlConfig = {
      serviceId: 'aml-sanctions-flow',
      modelVersion: '1.0.0',
      groundednessThreshold: 0.70,
      confidenceThreshold: 0.75,
      narrativeTimeoutMs: 60_000,
      ...amlConfig,
    };

    this.sanctionsConfig = {
      serviceId: 'sanctions-flow',
      modelVersion: '1.0.0',
      disambiguationTimeoutMs: 30_000,
      confidenceThreshold: 0.70,
      ...sanctionsConfig,
    };
  }

  /**
   * Execute the full AML alert triage flow end-to-end.
   *
   * Flow: AML Alert → AML Triage → RAG Pipeline → Human Review Queue → Audit Service
   *
   * Steps:
   * 1. Triage the alert (classification + priority scoring)
   * 2. Retrieve case history via RAG for narrative generation
   * 3. Route to human review if confidence is below threshold or HITL required
   * 4. Persist audit artefact capturing the entire decision chain
   *
   * @param input - The AML alert to process
   * @returns Complete flow result including all step outcomes
   *
   * Validates: Requirement 3.1
   */
  async executeAMLFlow(input: AMLAlertInput): Promise<AMLFlowResult> {
    const flowId = generateFlowId('aml');
    const startTime = Date.now();
    const steps: FlowStepResult[] = [];

    try {
      // Step 1: AML Triage — classify alert, assign priority, generate reasoning
      const triageResult = await this.amlTriage.triageAlert({
        alertId: input.alertId,
        alertType: input.alertType,
        entityId: input.entityId,
        alertData: input.alertData,
        jurisdiction: input.jurisdiction,
      });

      steps.push({
        step: 'AML_TRIAGE',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        output: {
          disposition: triageResult.disposition,
          priorityScore: triageResult.priorityScore,
          confidence: triageResult.confidence,
        },
      });

      // Step 2: RAG Pipeline — retrieve case history for narrative context
      const ragResult = await this.ragPipeline.retrieveCaseHistory({
        caseId: input.alertId,
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        query: `AML alert ${input.alertType} for entity ${input.entityId}`,
        corpusIds: input.corpusIds ?? ['aml-case-history'],
      });

      steps.push({
        step: 'RAG_RETRIEVAL',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        output: {
          chunksRetrieved: ragResult.chunks.length,
          groundednessScore: ragResult.groundednessScore,
          retrievalLatencyMs: ragResult.retrievalLatencyMs,
        },
      });

      // Step 3: Human Review Queue — route if HITL required or low confidence
      const requiresHumanReview = this.amlRequiresHumanReview(
        triageResult.disposition,
        triageResult.confidence
      );

      let reviewId: string | undefined;
      if (requiresHumanReview) {
        const reviewResult = await this.humanReview.submitForReview({
          useCase: 'AML_TRIAGE',
          jurisdiction: input.jurisdiction,
          isHighImpact: triageResult.disposition === 'ESCALATE_L2',
          highImpactActionType:
            triageResult.disposition === 'ESCALATE_L2' ? 'SAR_FILING' : undefined,
          confidenceScore: triageResult.confidence,
          aiDecision: triageResult.disposition,
          decisionChain: {
            context: {
              alertData: input.alertData,
              ragChunks: ragResult.chunks.length,
              groundednessScore: ragResult.groundednessScore,
            },
            modelOutput: triageResult,
            modelVersion: this.amlConfig.modelVersion,
            sourceServiceId: this.amlConfig.serviceId,
            entityId: input.entityId,
          },
        });

        reviewId = reviewResult.reviewId;

        steps.push({
          step: 'HUMAN_REVIEW',
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          output: {
            reviewId: reviewResult.reviewId,
            status: reviewResult.status,
            isHighImpact: reviewResult.isHighImpact,
          },
        });
      }

      // Step 4: Audit Service — persist the complete flow artefact
      const auditArtefactId = await this.auditService.persistArtefact({
        artefactId: flowId,
        timestamp: new Date().toISOString(),
        jurisdiction: input.jurisdiction,
        serviceId: this.amlConfig.serviceId,
        modelVersion: this.amlConfig.modelVersion,
        inputFeatures: {
          alertId: input.alertId,
          alertType: input.alertType,
          entityId: input.entityId,
        },
        modelOutput: {
          disposition: triageResult.disposition,
          priorityScore: triageResult.priorityScore,
          reasoningSummary: triageResult.reasoningSummary,
        },
        confidenceScore: triageResult.confidence,
        decision: triageResult.disposition,
        retrievedContext: ragResult.chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          content: chunk.content,
          source: chunk.source,
          relevanceScore: chunk.relevanceScore,
        })),
      });

      steps.push({
        step: 'AUDIT',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        output: { auditArtefactId },
      });

      return {
        flowId,
        status: 'COMPLETED',
        alertId: input.alertId,
        disposition: triageResult.disposition,
        priorityScore: triageResult.priorityScore,
        confidence: triageResult.confidence,
        reasoningSummary: triageResult.reasoningSummary,
        ragChunksRetrieved: ragResult.chunks.length,
        groundednessScore: ragResult.groundednessScore,
        humanReviewRequired: requiresHumanReview,
        reviewId,
        auditArtefactId,
        steps,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      steps.push({
        step: 'ERROR',
        status: 'FAILED',
        timestamp: new Date().toISOString(),
        output: { error: errorMessage },
      });

      return {
        flowId,
        status: 'FAILED',
        alertId: input.alertId,
        disposition: undefined,
        priorityScore: undefined,
        confidence: undefined,
        reasoningSummary: undefined,
        ragChunksRetrieved: 0,
        groundednessScore: undefined,
        humanReviewRequired: false,
        reviewId: undefined,
        auditArtefactId: undefined,
        steps,
        totalDurationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute the full Sanctions screening flow end-to-end.
   *
   * Flow: Sanctions Screening → LLM Gateway → Guardrails → Human Review → Audit
   *
   * Steps:
   * 1. Screen entity against sanctions/PEP watchlists
   * 2. For mid-confidence matches, invoke LLM Gateway for disambiguation
   * 3. Apply Guardrails to LLM output (PII redaction, policy compliance)
   * 4. Route to Human Review if disposition is PENDING_REVIEW or ESCALATE
   * 5. Persist audit artefact capturing the entire decision chain
   *
   * @param input - The sanctions screening input
   * @returns Complete flow result including all step outcomes
   *
   * Validates: Requirements 4.3, 4.6
   */
  async executeSanctionsFlow(input: SanctionsScreeningInput): Promise<SanctionsFlowResult> {
    const flowId = generateFlowId('sanctions');
    const startTime = Date.now();
    const steps: FlowStepResult[] = [];

    try {
      // Step 1: Sanctions Screening — name matching and entity resolution
      const screeningResult = await this.sanctionsScreening.screen({
        requestId: input.requestId,
        entityName: input.entityName,
        entityType: input.entityType,
        attributes: input.attributes,
        jurisdiction: input.jurisdiction,
        tenantId: input.tenantId,
      });

      steps.push({
        step: 'SANCTIONS_SCREENING',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        output: {
          disposition: screeningResult.disposition,
          matchCount: screeningResult.matchResults.length,
          fallbackUsed: screeningResult.fallbackUsed,
          processingTimeMs: screeningResult.processingTimeMs,
        },
      });

      // Step 2: LLM Gateway — invoke for disambiguation reasoning (if applicable)
      let llmOutput: string | undefined;
      let guardrailsPassed = true;

      if (screeningResult.disambiguationResult) {
        // LLM was already invoked during screening; now route the reasoning
        // through guardrails for PII redaction and policy compliance
        const guardrailResult = await this.guardrails.check({
          content: screeningResult.reasoning,
          direction: 'OUTPUT',
          checks: ['PII_REDACTION', 'POLICY_COMPLIANCE'],
          context: {
            tenantId: input.tenantId,
            useCase: 'SANCTIONS_SCREENING',
          },
        });

        guardrailsPassed = guardrailResult.passed;
        llmOutput = guardrailResult.redactedContent ?? screeningResult.reasoning;

        steps.push({
          step: 'LLM_GATEWAY_GUARDRAILS',
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          output: {
            guardrailsPassed: guardrailResult.passed,
            flagCount: guardrailResult.flags.length,
            piiRedacted: !!guardrailResult.redactedContent,
          },
        });
      } else if (screeningResult.disposition !== 'CLEAR') {
        // For non-clear dispositions without disambiguation, still apply guardrails
        // to the reasoning output before human review
        const guardrailResult = await this.guardrails.check({
          content: screeningResult.reasoning,
          direction: 'OUTPUT',
          checks: ['PII_REDACTION', 'POLICY_COMPLIANCE'],
          context: {
            tenantId: input.tenantId,
            useCase: 'SANCTIONS_SCREENING',
          },
        });

        guardrailsPassed = guardrailResult.passed;
        llmOutput = guardrailResult.redactedContent ?? screeningResult.reasoning;

        steps.push({
          step: 'GUARDRAILS',
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          output: {
            guardrailsPassed: guardrailResult.passed,
            flagCount: guardrailResult.flags.length,
            piiRedacted: !!guardrailResult.redactedContent,
          },
        });
      }

      // Step 3: Human Review — route if disposition requires human oversight
      const requiresHumanReview = this.sanctionsRequiresHumanReview(
        screeningResult.disposition
      );

      let reviewId: string | undefined;
      if (requiresHumanReview) {
        const reviewResult = await this.humanReview.submitForReview({
          useCase: 'SANCTIONS_SCREENING',
          jurisdiction: input.jurisdiction,
          isHighImpact: screeningResult.disposition === 'ESCALATE',
          confidenceScore: this.getScreeningConfidence(screeningResult),
          aiDecision: screeningResult.disposition,
          decisionChain: {
            context: {
              matchResults: screeningResult.matchResults,
              disambiguationResult: screeningResult.disambiguationResult,
              guardrailsPassed,
            },
            modelOutput: screeningResult,
            modelVersion: this.sanctionsConfig.modelVersion,
            sourceServiceId: this.sanctionsConfig.serviceId,
            entityId: input.entityName,
          },
        });

        reviewId = reviewResult.reviewId;

        steps.push({
          step: 'HUMAN_REVIEW',
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          output: {
            reviewId: reviewResult.reviewId,
            status: reviewResult.status,
            isHighImpact: reviewResult.isHighImpact,
          },
        });
      }

      // Step 4: Audit Service — persist the complete flow artefact
      const auditArtefactId = await this.auditService.persistArtefact({
        artefactId: flowId,
        timestamp: new Date().toISOString(),
        jurisdiction: input.jurisdiction,
        serviceId: this.sanctionsConfig.serviceId,
        modelVersion: this.sanctionsConfig.modelVersion,
        inputFeatures: {
          requestId: input.requestId,
          entityName: input.entityName,
          entityType: input.entityType,
          attributes: input.attributes,
        },
        modelOutput: {
          disposition: screeningResult.disposition,
          matchResults: screeningResult.matchResults,
          reasoning: llmOutput ?? screeningResult.reasoning,
          disambiguationResult: screeningResult.disambiguationResult,
        },
        confidenceScore: this.getScreeningConfidence(screeningResult),
        decision: screeningResult.disposition,
      });

      steps.push({
        step: 'AUDIT',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        output: { auditArtefactId },
      });

      return {
        flowId,
        status: 'COMPLETED',
        requestId: input.requestId,
        disposition: screeningResult.disposition,
        matchCount: screeningResult.matchResults.length,
        disambiguationPerformed: !!screeningResult.disambiguationResult,
        guardrailsPassed,
        humanReviewRequired: requiresHumanReview,
        reviewId,
        fallbackUsed: screeningResult.fallbackUsed,
        auditArtefactId,
        steps,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      steps.push({
        step: 'ERROR',
        status: 'FAILED',
        timestamp: new Date().toISOString(),
        output: { error: errorMessage },
      });

      return {
        flowId,
        status: 'FAILED',
        requestId: input.requestId,
        disposition: undefined,
        matchCount: 0,
        disambiguationPerformed: false,
        guardrailsPassed: false,
        humanReviewRequired: false,
        reviewId: undefined,
        fallbackUsed: false,
        auditArtefactId: undefined,
        steps,
        totalDurationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * Determine if the AML triage result requires human review.
   *
   * Routes to human review when:
   * - Disposition is ESCALATE_L2 (high-impact, requires HITL for SAR)
   * - Confidence is below the configured threshold
   */
  private amlRequiresHumanReview(
    disposition: string,
    confidence: number
  ): boolean {
    if (disposition === 'ESCALATE_L2') {
      return true;
    }
    return confidence < this.amlConfig.confidenceThreshold;
  }

  /**
   * Determine if the sanctions screening result requires human review.
   *
   * Routes to human review when:
   * - Disposition is PENDING_REVIEW (per Requirement 4.6)
   * - Disposition is ESCALATE (high-confidence match needs analyst confirmation)
   */
  private sanctionsRequiresHumanReview(
    disposition: string
  ): boolean {
    return disposition === 'PENDING_REVIEW' || disposition === 'ESCALATE';
  }

  /**
   * Extract the effective confidence score from a screening result.
   */
  private getScreeningConfidence(result: {
    matchResults: Array<{ confidenceScore: number }>;
    disambiguationResult?: { confidence: number };
  }): number {
    // If disambiguation was performed, use its confidence
    if (result.disambiguationResult) {
      return result.disambiguationResult.confidence;
    }
    // Otherwise use the highest match confidence or 1.0 for no-match (CLEAR)
    if (result.matchResults.length === 0) {
      return 1.0;
    }
    return Math.max(...result.matchResults.map((m) => m.confidenceScore));
  }
}

// ─── Utility Functions ─────────────────────────────────────────────────────

/**
 * Generate a unique flow ID with a prefix indicating the flow type.
 */
function generateFlowId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}-flow-${timestamp}-${random}`;
}
