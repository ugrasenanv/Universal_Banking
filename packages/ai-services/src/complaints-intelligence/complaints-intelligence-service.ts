/**
 * Complaints Intelligence Service
 *
 * Classifies customer complaints into predefined categories, routes them to
 * the appropriate resolution team, and generates structured summaries conforming
 * to the RBI CMS and Banking Ombudsman reporting schema.
 *
 * Key responsibilities:
 * - Classification into predefined categories within 30 seconds (Req 10.1)
 * - Misrouting rate <5% (from 22% baseline) (Req 10.2)
 * - Structured summary generation (RBI CMS schema) (Req 10.3)
 * - Audit trail with 7-year retention (Req 10.4)
 * - Low-confidence escalation to senior officer (Req 10.5)
 * - Fallback to manual classification on failure/timeout (Req 10.6)
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import type {
  ComplaintClassificationRequest,
  ComplaintClassificationResponse,
  ComplaintClassificationModelAdapter,
  ComplaintClassificationResult,
  ComplaintAuditEmitter,
  ComplaintAuditRecord,
  ComplaintsIntelligenceConfig,
  RBICMSComplaintSummary,
  ComplaintCategory,
  ResolutionTeam,
} from './types.js';

import { DEFAULT_COMPLAINTS_INTELLIGENCE_CONFIG } from './types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Service Implementation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * ComplaintsIntelligenceService provides AI-powered complaint classification
 * and deterministic routing to resolution teams.
 *
 * Implements the 5-tier degradation hierarchy:
 * - Tier 1: ML classification model
 * - Tier 5 (fallback): Manual classification by senior officer
 *
 * For complaints, the fallback is direct routing to senior officer
 * when service is unavailable or times out (Req 10.6).
 */
export class ComplaintsIntelligenceService {
  private readonly config: ComplaintsIntelligenceConfig;
  private readonly classificationModel: ComplaintClassificationModelAdapter;
  private readonly auditEmitter: ComplaintAuditEmitter;

  constructor(
    classificationModel: ComplaintClassificationModelAdapter,
    auditEmitter: ComplaintAuditEmitter,
    config?: Partial<ComplaintsIntelligenceConfig>
  ) {
    this.config = { ...DEFAULT_COMPLAINTS_INTELLIGENCE_CONFIG, ...config };
    this.classificationModel = classificationModel;
    this.auditEmitter = auditEmitter;
  }

  /**
   * Classify and route a customer complaint.
   *
   * Workflow:
   * 1. Validate the request
   * 2. Attempt ML classification (with timeout enforcement)
   * 3. Determine routing based on category-team mapping
   * 4. If confidence below threshold, escalate to senior officer
   * 5. Generate structured summary (RBI CMS schema)
   * 6. Emit audit artefact
   * 7. Return classification response
   *
   * If classification fails or times out, falls back to manual routing
   * to a senior officer (Req 10.6).
   */
  async classifyAndRoute(
    request: ComplaintClassificationRequest
  ): Promise<ComplaintClassificationResponse> {
    const startTime = Date.now();

    this.validateRequest(request);

    let classificationResult: ComplaintClassificationResult | null = null;
    let fallbackTriggered = false;
    let failureEvent: string | undefined;

    try {
      classificationResult = await this.classifyWithTimeout(request);
    } catch (error) {
      // Fallback to manual classification (Req 10.6)
      fallbackTriggered = true;
      failureEvent =
        error instanceof Error ? error.message : 'Classification service unavailable';
    }

    // Determine routing
    const { category, subcategory, confidence, routedToTeam, escalated, escalationReason } =
      this.determineRouting(classificationResult, fallbackTriggered);

    // Generate structured summary (Req 10.3)
    const structuredSummary = this.generateStructuredSummary(
      request,
      category,
      subcategory,
      routedToTeam,
      confidence,
      escalated,
      escalationReason
    );

    // Emit audit artefact (Req 10.4)
    const auditArtefactId = await this.emitAuditRecord(
      request,
      category,
      subcategory,
      confidence,
      classificationResult?.reasoningFactors ?? [],
      routedToTeam,
      escalated,
      escalationReason,
      fallbackTriggered,
      failureEvent
    );

    const processingTimeMs = Date.now() - startTime;

    return {
      complaintId: request.complaintId,
      category,
      subcategory,
      routedToTeam,
      confidence,
      escalatedToSeniorOfficer: escalated,
      structuredSummary,
      processingTimeMs,
      auditArtefactId,
      fallbackTriggered,
    };
  }

  /**
   * Get current service configuration.
   */
  getConfig(): ComplaintsIntelligenceConfig {
    return { ...this.config };
  }

  /**
   * Look up the resolution team for a given category.
   */
  getTeamForCategory(category: ComplaintCategory): ResolutionTeam {
    return this.config.categoryTeamMap[category];
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Attempt classification with timeout enforcement.
   * Throws if classification exceeds the configured timeout (Req 10.6).
   */
  private async classifyWithTimeout(
    request: ComplaintClassificationRequest
  ): Promise<ComplaintClassificationResult> {
    const timeoutMs = this.config.classificationTimeoutMs;

    const classificationPromise = this.classificationModel.classify(request);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Classification timeout: exceeded ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    return Promise.race([classificationPromise, timeoutPromise]);
  }

  /**
   * Determine routing based on classification result or fallback.
   *
   * - If classification succeeded and confidence >= threshold: route to mapped team
   * - If classification succeeded but confidence < threshold: escalate to senior officer (Req 10.5)
   * - If fallback triggered: route to senior officer for manual classification (Req 10.6)
   */
  private determineRouting(
    result: ComplaintClassificationResult | null,
    fallbackTriggered: boolean
  ): {
    category: ComplaintCategory;
    subcategory: typeof result extends null ? 'MISCELLANEOUS' : NonNullable<typeof result>['subcategory'];
    confidence: number;
    routedToTeam: ResolutionTeam;
    escalated: boolean;
    escalationReason?: string;
  } {
    // Fallback case (Req 10.6): service unavailable or timeout
    if (fallbackTriggered || !result) {
      return {
        category: 'OTHERS',
        subcategory: 'MISCELLANEOUS',
        confidence: 0,
        routedToTeam: 'SENIOR_OFFICER',
        escalated: true,
        escalationReason: 'Service unavailable or classification timeout — routed to manual classification',
      };
    }

    const { category, subcategory, confidence } = result;

    // Low-confidence escalation (Req 10.5)
    if (confidence < this.config.confidenceThreshold) {
      return {
        category,
        subcategory,
        confidence,
        routedToTeam: 'SENIOR_OFFICER',
        escalated: true,
        escalationReason: `Classification confidence ${confidence.toFixed(2)} below threshold ${this.config.confidenceThreshold}`,
      };
    }

    // Normal routing: deterministic mapping from category to team (Req 10.1)
    const routedToTeam = this.config.categoryTeamMap[category];

    return {
      category,
      subcategory,
      confidence,
      routedToTeam,
      escalated: false,
    };
  }

  /**
   * Generate a structured summary conforming to RBI CMS schema (Req 10.3).
   */
  private generateStructuredSummary(
    request: ComplaintClassificationRequest,
    category: ComplaintCategory,
    subcategory: ComplaintClassificationResult['subcategory'],
    resolutionTeam: ResolutionTeam,
    confidence: number,
    escalated: boolean,
    escalationReason?: string
  ): RBICMSComplaintSummary {
    return {
      complaintReferenceNumber: request.complaintId,
      category,
      subcategory,
      customerIssue: request.complaintText.slice(0, 500), // Truncate for summary
      resolutionTeam,
      classificationConfidence: confidence,
      classifiedAt: new Date().toISOString(),
      escalated,
      escalationReason,
    };
  }

  /**
   * Emit audit artefact for regulatory retention (Req 10.4).
   * Retention: 7 years minimum.
   */
  private async emitAuditRecord(
    request: ComplaintClassificationRequest,
    category: ComplaintCategory,
    subcategory: ComplaintClassificationResult['subcategory'],
    confidence: number,
    reasoningFactors: string[],
    routingDecision: ResolutionTeam,
    escalated: boolean,
    escalationReason: string | undefined,
    fallbackTriggered: boolean,
    failureEvent: string | undefined
  ): Promise<string> {
    const now = new Date();
    const retentionExpiry = new Date(now);
    retentionExpiry.setFullYear(retentionExpiry.getFullYear() + this.config.retentionYears);

    const record: Omit<ComplaintAuditRecord, 'artefactId'> = {
      complaintId: request.complaintId,
      timestamp: now.toISOString(),
      categoryAssigned: category,
      subcategoryAssigned: subcategory,
      confidenceScore: confidence,
      classificationReasoning: reasoningFactors,
      routingDecision,
      escalated,
      escalationReason,
      jurisdiction: request.jurisdiction,
      serviceVersion: this.config.serviceVersion,
      retentionExpiry: retentionExpiry.toISOString(),
      fallbackTriggered,
      failureEvent,
    };

    return this.auditEmitter.emit(record);
  }

  /**
   * Validate the incoming classification request.
   */
  private validateRequest(request: ComplaintClassificationRequest): void {
    if (!request.complaintId || request.complaintId.trim() === '') {
      throw new Error('complaintId is required');
    }
    if (!request.customerId || request.customerId.trim() === '') {
      throw new Error('customerId is required');
    }
    if (!request.complaintText || request.complaintText.trim() === '') {
      throw new Error('complaintText is required');
    }
    if (!request.receivedAt) {
      throw new Error('receivedAt timestamp is required');
    }
    if (!request.jurisdiction) {
      throw new Error('jurisdiction is required');
    }
    if (!request.channel) {
      throw new Error('channel is required');
    }
  }
}
