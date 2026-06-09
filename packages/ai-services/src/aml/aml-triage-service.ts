/**
 * AML Triage Service
 *
 * Provides alert triage classification, priority scoring, investigation narrative
 * generation via RAG, and SAR draft preparation with mandatory HITL enforcement.
 *
 * Key constraints:
 * - Alert classification: ESCALATE_L2 | RECOMMEND_CLOSURE | INVESTIGATE
 * - Priority scoring: 1-100 with reasoning summary
 * - Narrative generation within 60 seconds using RAG over case history
 * - SAR draft targets <45 min analyst interaction time
 * - No SAR filed without explicit analyst approval (HITL mode)
 * - Full audit artefacts: prompt, context, output, analyst decision (7-year retention)
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
 */

import type {
  AMLTriageRequest,
  AMLTriageResponse,
  NarrativeGenerationRequest,
  NarrativeGenerationResponse,
  SARFilingRequest,
  SARFilingResponse,
  AMLTriageConfig,
  AMLClassificationModelAdapter,
  AMLRAGAdapter,
  AMLNarrativeGeneratorAdapter,
  AMLAuditEmitter,
  AMLAuditArtefactInput,
  Citation,
  DataSourceStatus,
} from './types.js';
import { DEFAULT_AML_TRIAGE_CONFIG } from './types.js';

/**
 * AMLTriageService performs alert triage, narrative generation, and SAR preparation.
 *
 * Architecture:
 * 1. Alert triage: classify alert → assign priority → generate reasoning → emit audit
 * 2. Narrative generation: RAG retrieval → LLM generation → groundedness scoring → emit audit
 * 3. SAR filing: validate analyst approval → file → emit audit
 *
 * All operations enforce HITL for SAR filing and emit complete audit artefacts.
 */
export class AMLTriageService {
  private readonly config: AMLTriageConfig;
  private readonly classificationModel: AMLClassificationModelAdapter;
  private readonly ragAdapter: AMLRAGAdapter;
  private readonly narrativeGenerator: AMLNarrativeGeneratorAdapter;
  private readonly auditEmitter: AMLAuditEmitter;

  constructor(
    classificationModel: AMLClassificationModelAdapter,
    ragAdapter: AMLRAGAdapter,
    narrativeGenerator: AMLNarrativeGeneratorAdapter,
    auditEmitter: AMLAuditEmitter,
    config?: Partial<AMLTriageConfig>
  ) {
    this.config = { ...DEFAULT_AML_TRIAGE_CONFIG, ...config };
    this.classificationModel = classificationModel;
    this.ragAdapter = ragAdapter;
    this.narrativeGenerator = narrativeGenerator;
    this.auditEmitter = auditEmitter;
  }

  /**
   * Triage an AML alert.
   *
   * Classifies the alert into a disposition category (ESCALATE_L2, RECOMMEND_CLOSURE,
   * INVESTIGATE), assigns a priority score (1-100), and generates a reasoning summary.
   *
   * Emits a complete audit artefact with input features, model output, and decision.
   *
   * @param request - The AML triage request
   * @returns Triage response with disposition, priority, confidence, and audit reference
   * @throws Error if request validation fails
   *
   * Validates: Requirement 3.1
   */
  async triageAlert(request: AMLTriageRequest): Promise<AMLTriageResponse> {
    this.validateTriageRequest(request);

    // Step 1: Run ML classification
    const classificationResult = await this.classificationModel.classify(request);

    // Step 2: Clamp and validate priority score (1-100)
    const priorityScore = clampPriorityScore(classificationResult.priorityScore);

    // Step 3: Clamp confidence to [0.00, 1.00]
    const confidence = clampConfidence(classificationResult.confidence);

    // Step 4: Generate reasoning summary from factors
    const reasoningSummary = this.buildReasoningSummary(
      classificationResult.reasoningFactors,
      classificationResult.disposition,
      priorityScore
    );

    // Step 5: Emit audit artefact
    const auditInput: AMLAuditArtefactInput = {
      serviceId: this.config.serviceId,
      timestamp: new Date().toISOString(),
      jurisdiction: request.jurisdiction,
      modelVersion: this.config.modelVersion,
      inputFeatures: {
        alertId: request.alertId,
        alertType: request.alertType,
        entityId: request.entityId,
        alertData: request.alertData,
      },
      modelOutput: {
        disposition: classificationResult.disposition,
        priorityScore,
        confidence,
        reasoningFactors: classificationResult.reasoningFactors,
      },
      confidenceScore: confidence,
      decision: classificationResult.disposition,
    };

    const auditArtefactId = await this.auditEmitter.emit(auditInput);

    return {
      alertId: request.alertId,
      disposition: classificationResult.disposition,
      priorityScore,
      reasoningSummary,
      confidence,
      auditArtefactId,
    };
  }

  /**
   * Generate an investigation narrative or SAR draft using RAG over case history.
   *
   * Retrieves case history from the RAG pipeline, generates a narrative via LLM,
   * computes groundedness scoring, and flags low-confidence content.
   *
   * Must complete within 60 seconds (configurable via narrativeTimeoutMs).
   *
   * @param request - Narrative generation request
   * @returns Narrative with citations, groundedness score, and data source status
   * @throws Error if generation exceeds timeout or request is invalid
   *
   * Validates: Requirements 3.2, 3.3, 3.7, 3.8, 3.9
   */
  async generateNarrative(
    request: NarrativeGenerationRequest
  ): Promise<NarrativeGenerationResponse> {
    this.validateNarrativeRequest(request);

    const startTime = performance.now();

    // Step 1: Retrieve case history via RAG
    const ragResult = await this.ragAdapter.retrieveCaseHistory(
      request.caseId,
      this.config.tenantId,
      request.jurisdiction
    );

    // Step 2: Check for timeout after RAG retrieval
    this.checkTimeout(startTime, 'RAG retrieval');

    // Step 3: Determine data source status (Requirement 3.9)
    const dataSourceStatus: DataSourceStatus = {
      allSourcesAvailable: ragResult.success && ragResult.unavailableSources.length === 0,
      unavailableSources: ragResult.unavailableSources,
    };

    // Step 4: Build prompt for narrative generation
    const prompt = this.buildNarrativePrompt(request, ragResult.chunks);

    // Step 5: Generate narrative via LLM
    const narrativeResult = await this.narrativeGenerator.generateNarrative(
      prompt,
      ragResult.chunks,
      request.scope
    );

    // Step 6: Check for timeout after generation
    this.checkTimeout(startTime, 'narrative generation');

    // Step 7: Evaluate groundedness (Requirement 3.8)
    const lowConfidenceFlag =
      narrativeResult.groundednessScore < this.config.groundednessThreshold;

    // Step 8: Build citations from RAG chunks (Requirement 3.7)
    const citations: Citation[] = ragResult.chunks.map((chunk) => ({
      documentName: chunk.source.documentName,
      section: chunk.source.section,
      publicationDate: chunk.source.publicationDate,
      relevanceScore: chunk.relevanceScore,
      chunkId: chunk.chunkId,
    }));

    // Step 9: SAR drafts always require human approval (HITL - Requirement 3.5)
    const requiresHumanApproval = request.scope === 'SAR_DRAFT' || lowConfidenceFlag;

    // Step 10: Emit audit artefact (Requirement 3.6)
    const auditInput: AMLAuditArtefactInput = {
      serviceId: this.config.serviceId,
      timestamp: new Date().toISOString(),
      jurisdiction: request.jurisdiction,
      modelVersion: this.config.modelVersion,
      inputFeatures: {
        caseId: request.caseId,
        analystId: request.analystId,
        scope: request.scope,
      },
      prompt,
      retrievedContext: ragResult.chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        content: chunk.content,
        source: chunk.source,
        relevanceScore: chunk.relevanceScore,
      })),
      modelOutput: {
        narrative: narrativeResult.narrative,
        groundednessScore: narrativeResult.groundednessScore,
      },
      confidenceScore: narrativeResult.groundednessScore,
      decision: requiresHumanApproval ? 'REQUIRES_APPROVAL' : 'GENERATED',
      contextPayload: {
        dataSourceStatus,
        lowConfidenceFlag,
        generationTimeMs: performance.now() - startTime,
      },
    };

    const auditArtefactId = await this.auditEmitter.emit(auditInput);

    return {
      caseId: request.caseId,
      narrative: narrativeResult.narrative,
      citations,
      groundednessScore: narrativeResult.groundednessScore,
      requiresHumanApproval,
      auditArtefactId,
      lowConfidenceFlag,
      dataSourceStatus,
    };
  }

  /**
   * File a SAR with mandatory analyst approval (HITL enforcement).
   *
   * No SAR is filed without explicit analyst approval. This is the HITL gate
   * that ensures human oversight for high-impact regulatory actions.
   *
   * @param request - SAR filing request with analyst approval flag
   * @returns Filing result with audit trail reference
   *
   * Validates: Requirements 3.3, 3.5, 3.6
   */
  async fileSAR(request: SARFilingRequest): Promise<SARFilingResponse> {
    this.validateSARRequest(request);

    const timestamp = new Date().toISOString();

    // HITL GATE: No SAR filed without explicit analyst approval (Requirement 3.5)
    if (!request.analystApproval) {
      const auditInput: AMLAuditArtefactInput = {
        serviceId: this.config.serviceId,
        timestamp,
        jurisdiction: request.jurisdiction,
        modelVersion: this.config.modelVersion,
        inputFeatures: {
          caseId: request.caseId,
          analystId: request.analystId,
          narrativeId: request.narrativeId,
        },
        modelOutput: { action: 'SAR_FILING_REJECTED' },
        confidenceScore: 0,
        decision: 'REJECTED_NO_APPROVAL',
        analystDecision: 'NOT_APPROVED',
      };

      const auditArtefactId = await this.auditEmitter.emit(auditInput);

      return {
        caseId: request.caseId,
        filed: false,
        rejectionReason: 'SAR filing requires explicit analyst approval (HITL enforcement)',
        auditArtefactId,
      };
    }

    // Step 2: File the SAR (analyst has approved)
    const filingTimestamp = new Date().toISOString();

    // Step 3: Emit audit artefact with analyst decision (Requirement 3.6)
    const auditInput: AMLAuditArtefactInput = {
      serviceId: this.config.serviceId,
      timestamp: filingTimestamp,
      jurisdiction: request.jurisdiction,
      modelVersion: this.config.modelVersion,
      inputFeatures: {
        caseId: request.caseId,
        analystId: request.analystId,
        narrativeId: request.narrativeId,
        dataGapAcknowledgement: request.dataGapAcknowledgement ?? false,
      },
      modelOutput: { action: 'SAR_FILED' },
      confidenceScore: 1.0,
      decision: 'SAR_FILED',
      analystDecision: 'APPROVED',
      contextPayload: {
        filingTimestamp,
        analystApproval: true,
        dataGapAcknowledgement: request.dataGapAcknowledgement ?? false,
      },
    };

    const auditArtefactId = await this.auditEmitter.emit(auditInput);

    return {
      caseId: request.caseId,
      filed: true,
      filingTimestamp,
      auditArtefactId,
    };
  }

  /**
   * Get the current service configuration.
   */
  getConfig(): AMLTriageConfig {
    return { ...this.config };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Validate triage request fields.
   */
  private validateTriageRequest(request: AMLTriageRequest): void {
    if (!request.alertId || request.alertId.trim() === '') {
      throw new Error('alertId is required');
    }
    if (!request.alertType) {
      throw new Error('alertType is required');
    }
    if (!request.entityId || request.entityId.trim() === '') {
      throw new Error('entityId is required');
    }
    if (!request.alertData) {
      throw new Error('alertData is required');
    }
    if (!request.jurisdiction) {
      throw new Error('jurisdiction is required');
    }
  }

  /**
   * Validate narrative generation request fields.
   */
  private validateNarrativeRequest(request: NarrativeGenerationRequest): void {
    if (!request.caseId || request.caseId.trim() === '') {
      throw new Error('caseId is required');
    }
    if (!request.analystId || request.analystId.trim() === '') {
      throw new Error('analystId is required');
    }
    if (!request.scope) {
      throw new Error('scope is required');
    }
    if (!request.jurisdiction) {
      throw new Error('jurisdiction is required');
    }
  }

  /**
   * Validate SAR filing request fields.
   */
  private validateSARRequest(request: SARFilingRequest): void {
    if (!request.caseId || request.caseId.trim() === '') {
      throw new Error('caseId is required');
    }
    if (!request.analystId || request.analystId.trim() === '') {
      throw new Error('analystId is required');
    }
    if (!request.narrativeId || request.narrativeId.trim() === '') {
      throw new Error('narrativeId is required');
    }
    if (!request.jurisdiction) {
      throw new Error('jurisdiction is required');
    }
  }

  /**
   * Build reasoning summary from classification factors.
   */
  private buildReasoningSummary(
    factors: string[],
    disposition: string,
    priorityScore: number
  ): string {
    const factorList = factors.length > 0 ? factors.join('; ') : 'No specific factors identified';
    return `Alert classified as ${disposition} with priority ${priorityScore}/100. Contributing factors: ${factorList}.`;
  }

  /**
   * Build a prompt for narrative generation.
   */
  private buildNarrativePrompt(
    request: NarrativeGenerationRequest,
    chunks: Array<{ content: string; source: { documentName: string; section: string } }>
  ): string {
    const scopeDescription =
      request.scope === 'SAR_DRAFT'
        ? 'Generate a Suspicious Activity Report (SAR) draft'
        : 'Generate an investigation narrative';

    const contextSummary = chunks
      .map((c, i) => `[${i + 1}] ${c.source.documentName} - ${c.source.section}: ${c.content}`)
      .join('\n\n');

    return [
      `${scopeDescription} for case ${request.caseId}.`,
      '',
      'Retrieved case history context:',
      contextSummary,
      '',
      'Provide source citations for every factual claim.',
      'Flag any content where groundedness cannot be verified.',
    ].join('\n');
  }

  /**
   * Check if the operation has exceeded the configured timeout.
   */
  private checkTimeout(startTime: number, phase: string): void {
    const elapsed = performance.now() - startTime;
    if (elapsed > this.config.narrativeTimeoutMs) {
      throw new Error(
        `AML narrative generation timed out during ${phase}: ${Math.round(elapsed)}ms exceeds ${this.config.narrativeTimeoutMs}ms limit`
      );
    }
  }
}

/**
 * Clamp priority score to the valid range [1, 100].
 */
function clampPriorityScore(score: number): number {
  return Math.max(1, Math.min(100, Math.round(score)));
}

/**
 * Clamp confidence to the valid range [0.00, 1.00].
 */
function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, confidence));
}
