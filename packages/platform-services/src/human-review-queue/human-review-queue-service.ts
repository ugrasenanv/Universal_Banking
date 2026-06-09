/**
 * Human Review Queue Service — structured human oversight for AI decisions.
 *
 * Responsibilities:
 * - Route low-confidence decisions to human reviewers within 30 seconds
 * - Enforce HITL gate for high-impact actions (SAR filing, holds >1h, credit decline, credit-line reduction)
 * - Capture complete decision chain (prompt, context, model output, human decision, rationale)
 * - Ingest feedback into model improvement pipeline (within 24h, no PII in training)
 * - Manage configurable confidence thresholds per use case
 * - Notify customers of holds within 60 seconds
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import type { ISO8601, Jurisdiction } from '@afg/shared-types';
import type {
  ConfidenceThresholdConfig,
  CustomerNotification,
  HighImpactActionType,
  NotificationService,
  RecordReviewDecisionRequest,
  ReviewDecision,
  ReviewFeedback,
  ReviewItem,
  ReviewItemStatus,
  ReviewOutcome,
  ReviewQueueStore,
  ReviewUseCase,
  SubmitForReviewRequest,
} from './types.js';

/** Maximum routing time in milliseconds (Requirement 15.1). */
const MAX_ROUTING_TIME_MS = 30_000;

/** Maximum customer notification time in milliseconds (Requirement 15.6). */
const MAX_NOTIFICATION_TIME_MS = 60_000;

/** Feedback ingestion deadline in hours (Requirement 15.4). */
const FEEDBACK_INGESTION_HOURS = 24;

/** High-impact actions that always require HITL approval (Requirement 15.2). */
const HIGH_IMPACT_ACTIONS: readonly HighImpactActionType[] = [
  'SAR_FILING',
  'TRANSACTION_HOLD_GT_1H',
  'CREDIT_DECLINE',
  'CREDIT_LINE_REDUCTION',
] as const;

/**
 * HumanReviewQueue provides structured human oversight for AI decisions.
 *
 * All high-impact AI decisions and low-confidence outputs are routed
 * through this service before execution, ensuring regulatory accountability
 * and enabling model improvement through feedback loops.
 */
export class HumanReviewQueue {
  private readonly store: ReviewQueueStore;
  private readonly notificationService: NotificationService;
  private thresholds: Map<ReviewUseCase, ConfidenceThresholdConfig>;

  constructor(
    store: ReviewQueueStore,
    notificationService: NotificationService,
    initialThresholds?: ConfidenceThresholdConfig[]
  ) {
    this.store = store;
    this.notificationService = notificationService;
    this.thresholds = new Map();

    if (initialThresholds) {
      for (const config of initialThresholds) {
        this.thresholds.set(config.useCase, config);
      }
    }
  }

  /**
   * Submit an AI decision for human review (Requirement 15.1).
   *
   * Routes the decision within 30 seconds. If the item is a high-impact
   * action, it is marked as requiring mandatory approval before execution.
   *
   * @param request - The review submission request
   * @returns The created review item
   * @throws Error if validation fails
   */
  async submitForReview(request: SubmitForReviewRequest): Promise<ReviewItem> {
    this.validateSubmission(request);

    const now = new Date();
    const reviewId = this.generateReviewId();

    const item: ReviewItem = {
      reviewId,
      queuedAt: now.toISOString(),
      routedAt: now.toISOString(), // Routed immediately upon submission
      status: 'PENDING',
      jurisdiction: request.jurisdiction,
      useCase: request.useCase,
      isHighImpact: request.isHighImpact,
      highImpactActionType: request.highImpactActionType,
      confidenceScore: request.confidenceScore,
      thresholdAtRouting: this.getEffectiveThreshold(request.useCase, request.jurisdiction),
      aiDecision: request.aiDecision,
      decisionChain: request.decisionChain,
    };

    // Persist the review item
    await this.store.save(item);

    // Send customer notification for hold scenarios (Requirement 15.6)
    if (request.customerId && request.isHighImpact) {
      const notification = await this.sendCustomerNotification(
        request.customerId,
        request.jurisdiction,
        item
      );
      item.customerNotification = notification;
      await this.store.update(item);
    }

    return item;
  }

  /**
   * Check whether an action requires human review based on confidence
   * threshold or high-impact classification (Requirements 15.1, 15.2, 15.5).
   *
   * @param useCase - The use case to check
   * @param confidenceScore - The AI confidence score
   * @param jurisdiction - The jurisdiction (for threshold overrides)
   * @param isHighImpactAction - Whether this is a high-impact action type
   * @returns true if human review is required
   */
  requiresHumanReview(
    useCase: ReviewUseCase,
    confidenceScore: number,
    jurisdiction: Jurisdiction,
    isHighImpactAction?: HighImpactActionType
  ): boolean {
    // High-impact actions ALWAYS require review (Requirement 15.2)
    if (isHighImpactAction && HIGH_IMPACT_ACTIONS.includes(isHighImpactAction)) {
      return true;
    }

    // Check confidence threshold (Requirement 15.1, 15.5)
    const threshold = this.getEffectiveThreshold(useCase, jurisdiction);
    return confidenceScore < threshold;
  }

  /**
   * Record a human reviewer's decision (Requirement 15.3).
   *
   * Captures the complete human decision including rationale for the
   * audit trail. The item must be in PENDING or ASSIGNED status.
   *
   * @param request - The review decision to record
   * @returns The updated review item
   * @throws Error if item not found, already decided, or validation fails
   */
  async recordDecision(request: RecordReviewDecisionRequest): Promise<ReviewItem> {
    this.validateDecisionRequest(request);

    const item = await this.store.getById(request.reviewId);
    if (!item) {
      throw new Error(`Review item not found: ${request.reviewId}`);
    }

    if (item.status !== 'PENDING' && item.status !== 'ASSIGNED') {
      throw new Error(
        `Cannot record decision for item in status: ${item.status}. Must be PENDING or ASSIGNED.`
      );
    }

    const now = new Date().toISOString();

    // Map review decision to item status
    const statusMap: Record<ReviewDecision, ReviewItemStatus> = {
      APPROVE: 'APPROVED',
      REJECT: 'REJECTED',
      MODIFY: 'MODIFIED',
    };

    const outcome: ReviewOutcome = {
      decision: request.decision,
      reviewerId: request.reviewerId,
      decidedAt: now,
      rationale: request.rationale,
      modifiedDecision: request.modifiedDecision,
      notes: request.notes,
    };

    item.status = statusMap[request.decision];
    item.reviewOutcome = outcome;
    item.assignedTo = request.reviewerId;
    item.assignedAt = item.assignedAt ?? now;

    await this.store.update(item);

    return item;
  }

  /**
   * Check if a high-impact action has received human approval (Requirement 15.2).
   *
   * Returns true only if the review item has been explicitly approved by a human.
   * This is the HITL gate — no high-impact action can proceed without it.
   *
   * @param reviewId - The review item ID
   * @returns true if the action has been approved by a human
   */
  async isApproved(reviewId: string): Promise<boolean> {
    const item = await this.store.getById(reviewId);
    if (!item) {
      return false;
    }
    return item.status === 'APPROVED';
  }

  /**
   * Check if a high-impact action can be executed (Requirement 15.2).
   *
   * High-impact actions CANNOT transition to "executed" state without
   * a recorded human approval event.
   *
   * @param reviewId - The review item ID
   * @returns true if execution is permitted
   */
  async canExecute(reviewId: string): Promise<boolean> {
    const item = await this.store.getById(reviewId);
    if (!item) {
      return false;
    }

    // High-impact actions require explicit approval
    if (item.isHighImpact) {
      return item.status === 'APPROVED' || item.status === 'MODIFIED';
    }

    // Non-high-impact items can execute if approved/modified or if not requiring strict HITL
    return item.status === 'APPROVED' || item.status === 'MODIFIED';
  }

  /**
   * Generate feedback for model improvement (Requirement 15.4).
   *
   * Produces an anonymised feedback record from a completed review.
   * Feedback must be ingested into the model pipeline within 24 hours
   * and must NOT contain PII.
   *
   * @param reviewId - The review item ID to generate feedback from
   * @param anonymisedFeatures - Pre-anonymised features (caller ensures no PII)
   * @returns The created feedback record
   */
  async generateFeedback(
    reviewId: string,
    anonymisedFeatures: Record<string, unknown>
  ): Promise<ReviewFeedback> {
    const item = await this.store.getById(reviewId);
    if (!item) {
      throw new Error(`Review item not found: ${reviewId}`);
    }

    if (!item.reviewOutcome) {
      throw new Error(`Review item ${reviewId} has not been reviewed yet`);
    }

    // Validate no PII in anonymised features
    this.validateNoPII(anonymisedFeatures);

    const now = new Date();
    const ingestBy = new Date(now.getTime() + FEEDBACK_INGESTION_HOURS * 60 * 60 * 1000);

    const finalDecision =
      item.reviewOutcome.decision === 'MODIFY'
        ? item.reviewOutcome.modifiedDecision ?? item.aiDecision
        : item.reviewOutcome.decision === 'APPROVE'
          ? item.aiDecision
          : `REJECTED:${item.aiDecision}`;

    const feedback: ReviewFeedback = {
      feedbackId: this.generateFeedbackId(),
      reviewId,
      useCase: item.useCase,
      originalAiDecision: item.aiDecision,
      humanDecision: item.reviewOutcome.decision,
      finalDecision,
      modelVersion: item.decisionChain.modelVersion,
      anonymisedFeatures,
      createdAt: now.toISOString(),
      ingestBy: ingestBy.toISOString(),
      ingested: false,
    };

    await this.store.saveFeedback(feedback);

    return feedback;
  }

  /**
   * Mark feedback as ingested into the model improvement pipeline (Requirement 15.4).
   *
   * @param feedbackId - The feedback record ID
   */
  async markFeedbackIngested(feedbackId: string): Promise<void> {
    const pendingFeedback = await this.store.getPendingFeedback();
    const feedback = pendingFeedback.find((f) => f.feedbackId === feedbackId);
    if (!feedback) {
      throw new Error(`Feedback not found or already ingested: ${feedbackId}`);
    }

    feedback.ingested = true;
    feedback.ingestedAt = new Date().toISOString();
    await this.store.updateFeedback(feedback);
  }

  /**
   * Get pending feedback that needs to be ingested (Requirement 15.4).
   *
   * Returns feedback records that have not yet been ingested.
   * Callers should process these within the 24-hour window.
   */
  async getPendingFeedback(): Promise<ReviewFeedback[]> {
    return this.store.getPendingFeedback();
  }

  /**
   * Get or set the confidence threshold for a use case (Requirement 15.5).
   */
  getThresholdConfig(useCase: ReviewUseCase): ConfidenceThresholdConfig | undefined {
    return this.thresholds.get(useCase);
  }

  /**
   * Update the confidence threshold for a use case (Requirement 15.5).
   */
  setThresholdConfig(config: ConfidenceThresholdConfig): void {
    if (config.threshold < 0 || config.threshold > 1) {
      throw new Error('Threshold must be between 0.00 and 1.00');
    }
    this.thresholds.set(config.useCase, config);
  }

  /**
   * Get the effective threshold for a use case considering jurisdiction overrides.
   */
  getEffectiveThreshold(useCase: ReviewUseCase, jurisdiction: Jurisdiction): number {
    const config = this.thresholds.get(useCase);
    if (!config) {
      // Default threshold if not configured
      return 0.75;
    }

    // Check for jurisdiction-specific override
    if (config.jurisdictionOverrides?.[jurisdiction] !== undefined) {
      return config.jurisdictionOverrides[jurisdiction]!;
    }

    return config.threshold;
  }

  /**
   * Get a review item by ID.
   */
  async getReviewItem(reviewId: string): Promise<ReviewItem | null> {
    return this.store.getById(reviewId);
  }

  /**
   * Get pending review items for a use case within a jurisdiction.
   */
  async getPendingItems(useCase: ReviewUseCase, jurisdiction: Jurisdiction): Promise<ReviewItem[]> {
    return this.store.getPendingByUseCase(useCase, jurisdiction);
  }

  /**
   * Validate routing time compliance (Requirement 15.1).
   *
   * Returns true if the item was routed within the 30-second requirement.
   */
  isRoutingTimeCompliant(item: ReviewItem): boolean {
    const queuedTime = new Date(item.queuedAt).getTime();
    const routedTime = new Date(item.routedAt).getTime();
    return routedTime - queuedTime <= MAX_ROUTING_TIME_MS;
  }

  /**
   * Validate notification time compliance (Requirement 15.6).
   *
   * Returns true if the customer was notified within 60 seconds of the hold decision.
   */
  isNotificationTimeCompliant(item: ReviewItem): boolean {
    if (!item.customerNotification?.sentAt) {
      return false;
    }
    const queuedTime = new Date(item.queuedAt).getTime();
    const notifiedTime = new Date(item.customerNotification.sentAt).getTime();
    return notifiedTime - queuedTime <= MAX_NOTIFICATION_TIME_MS;
  }

  /**
   * Check if feedback ingestion is within the 24-hour window (Requirement 15.4).
   */
  isFeedbackIngestionCompliant(feedback: ReviewFeedback): boolean {
    if (!feedback.ingested || !feedback.ingestedAt) {
      return false;
    }
    const ingestedTime = new Date(feedback.ingestedAt).getTime();
    const deadlineTime = new Date(feedback.ingestBy).getTime();
    return ingestedTime <= deadlineTime;
  }

  // ─── Private Methods ───────────────────────────────────────────────────

  private validateSubmission(request: SubmitForReviewRequest): void {
    if (!request.useCase) {
      throw new Error('useCase is required');
    }
    if (!request.jurisdiction) {
      throw new Error('jurisdiction is required');
    }
    if (request.confidenceScore < 0 || request.confidenceScore > 1) {
      throw new Error('confidenceScore must be between 0.00 and 1.00');
    }
    if (!request.aiDecision || request.aiDecision.trim() === '') {
      throw new Error('aiDecision is required');
    }
    if (!request.decisionChain) {
      throw new Error('decisionChain is required');
    }
    if (!request.decisionChain.modelVersion) {
      throw new Error('decisionChain.modelVersion is required');
    }
    if (!request.decisionChain.sourceServiceId) {
      throw new Error('decisionChain.sourceServiceId is required');
    }
    if (!request.decisionChain.entityId) {
      throw new Error('decisionChain.entityId is required');
    }
    if (request.isHighImpact && !request.highImpactActionType) {
      throw new Error('highImpactActionType is required when isHighImpact is true');
    }
    if (
      request.highImpactActionType &&
      !HIGH_IMPACT_ACTIONS.includes(request.highImpactActionType)
    ) {
      throw new Error(`Invalid highImpactActionType: ${request.highImpactActionType}`);
    }
  }

  private validateDecisionRequest(request: RecordReviewDecisionRequest): void {
    if (!request.reviewId || request.reviewId.trim() === '') {
      throw new Error('reviewId is required');
    }
    if (!request.reviewerId || request.reviewerId.trim() === '') {
      throw new Error('reviewerId is required');
    }
    if (!request.decision) {
      throw new Error('decision is required');
    }
    if (!request.rationale || request.rationale.trim() === '') {
      throw new Error('rationale is required');
    }
    if (request.decision === 'MODIFY' && !request.modifiedDecision) {
      throw new Error('modifiedDecision is required when decision is MODIFY');
    }
  }

  /**
   * Basic PII pattern detection for feedback validation (Requirement 15.4).
   * Checks for common PII patterns that should not appear in training data.
   */
  private validateNoPII(features: Record<string, unknown>): void {
    const piiPatterns = [
      /\b\d{12}\b/, // Aadhaar-like (12 digits)
      /\b[A-Z]{5}\d{4}[A-Z]\b/, // PAN card
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // Email
      /\b\d{10,}\b/, // Phone number (10+ digits)
    ];

    const checkValue = (value: unknown): void => {
      if (typeof value === 'string') {
        for (const pattern of piiPatterns) {
          if (pattern.test(value)) {
            throw new Error('PII detected in anonymised features. Remove all PII before feedback generation.');
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        for (const v of Object.values(value)) {
          checkValue(v);
        }
      }
    };

    for (const value of Object.values(features)) {
      checkValue(value);
    }
  }

  private sendCustomerNotification(
    customerId: string,
    jurisdiction: Jurisdiction,
    item: ReviewItem
  ): Promise<CustomerNotification> {
    const expectedResolution = '2 hours'; // Default expected resolution
    return this.notificationService
      .sendHoldNotification(customerId, jurisdiction, expectedResolution)
      .then((result) => ({
        customerId,
        sent: result.sent,
        sentAt: result.sentAt,
        expectedResolutionTime: expectedResolution,
        channel: result.channel,
      }));
  }

  private generateReviewId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `rev-${timestamp}-${random}`;
  }

  private generateFeedbackId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `fb-${timestamp}-${random}`;
  }
}
