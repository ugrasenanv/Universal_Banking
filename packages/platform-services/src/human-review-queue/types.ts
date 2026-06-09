/**
 * Human Review Queue types and interfaces.
 *
 * Defines the review item lifecycle, decision chain capture,
 * feedback ingestion, and confidence threshold configuration.
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import type { ISO8601, Jurisdiction } from '@afg/shared-types';

/**
 * High-impact action types that require mandatory HITL approval
 * before execution (Requirement 15.2).
 */
export type HighImpactActionType =
  | 'SAR_FILING'
  | 'TRANSACTION_HOLD_GT_1H'
  | 'CREDIT_DECLINE'
  | 'CREDIT_LINE_REDUCTION';

/**
 * Use cases that can be routed to human review.
 */
export type ReviewUseCase =
  | 'FRAUD_DETECTION'
  | 'AML_TRIAGE'
  | 'CREDIT_UNDERWRITING'
  | 'SANCTIONS_SCREENING'
  | 'DOCUMENT_EXTRACTION'
  | 'COMPLAINTS_CLASSIFICATION'
  | 'BEHAVIOURAL_CREDIT_LINE';

/**
 * Status of a review item in the queue.
 */
export type ReviewItemStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'APPROVED'
  | 'REJECTED'
  | 'MODIFIED'
  | 'EXPIRED';

/**
 * Human reviewer decision on a queued item.
 */
export type ReviewDecision = 'APPROVE' | 'REJECT' | 'MODIFY';

/**
 * A review item submitted to the Human Review Queue.
 * Captures the complete AI decision context for human evaluation.
 */
export interface ReviewItem {
  /** Unique identifier for this review item. */
  reviewId: string;

  /** Timestamp when the item was queued. */
  queuedAt: ISO8601;

  /** Timestamp when routing completed (must be within 30s of decision). */
  routedAt: ISO8601;

  /** Current status of the review item. */
  status: ReviewItemStatus;

  /** Jurisdiction for data residency enforcement. */
  jurisdiction: Jurisdiction;

  /** Use case that triggered the review. */
  useCase: ReviewUseCase;

  /** Whether this is a high-impact action requiring mandatory approval. */
  isHighImpact: boolean;

  /** Specific high-impact action type (if applicable). */
  highImpactActionType?: HighImpactActionType;

  /** The confidence score of the AI decision that triggered routing. */
  confidenceScore: number;

  /** The configured threshold for this use case at time of routing. */
  thresholdAtRouting: number;

  /** The AI-produced decision that requires review. */
  aiDecision: string;

  /** The complete decision chain context (Requirement 15.3). */
  decisionChain: DecisionChain;

  /** Assigned reviewer (if any). */
  assignedTo?: string;

  /** Timestamp when assigned to reviewer. */
  assignedAt?: ISO8601;

  /** Human review outcome (populated after review). */
  reviewOutcome?: ReviewOutcome;

  /** Customer notification status (Requirement 15.6). */
  customerNotification?: CustomerNotification;
}

/**
 * Complete decision chain captured for audit trail (Requirement 15.3).
 * Contains the full context of the AI decision for the human reviewer.
 */
export interface DecisionChain {
  /** The prompt sent to the model (if LLM-based). */
  prompt?: string;

  /** Context retrieved via RAG or feature store. */
  context: Record<string, unknown>;

  /** Raw model output. */
  modelOutput: unknown;

  /** Model version that produced the decision. */
  modelVersion: string;

  /** Service that produced the decision. */
  sourceServiceId: string;

  /** Original request/entity identifiers. */
  entityId: string;

  /** Additional metadata for the decision. */
  metadata?: Record<string, unknown>;
}

/**
 * The outcome of a human review.
 */
export interface ReviewOutcome {
  /** The human decision. */
  decision: ReviewDecision;

  /** Who made the decision. */
  reviewerId: string;

  /** When the decision was made. */
  decidedAt: ISO8601;

  /** Rationale for the decision (mandatory). */
  rationale: string;

  /** Modified decision value (if decision is MODIFY). */
  modifiedDecision?: string;

  /** Additional notes from the reviewer. */
  notes?: string;
}

/**
 * Customer notification for held transactions (Requirement 15.6).
 */
export interface CustomerNotification {
  /** Customer identifier. */
  customerId: string;

  /** Whether notification was sent. */
  sent: boolean;

  /** Timestamp notification was sent. */
  sentAt?: ISO8601;

  /** Expected resolution time communicated to customer. */
  expectedResolutionTime?: string;

  /** Channel used for notification. */
  channel?: 'SMS' | 'PUSH' | 'EMAIL' | 'IN_APP';
}

/**
 * Feedback from human review for model improvement (Requirement 15.4).
 * Must not contain PII.
 */
export interface ReviewFeedback {
  /** Unique feedback identifier. */
  feedbackId: string;

  /** Review item this feedback relates to. */
  reviewId: string;

  /** Use case for routing to correct improvement pipeline. */
  useCase: ReviewUseCase;

  /** The original AI decision. */
  originalAiDecision: string;

  /** The human decision. */
  humanDecision: ReviewDecision;

  /** Final decision after human review. */
  finalDecision: string;

  /** Model version that produced the original decision. */
  modelVersion: string;

  /** Anonymised features (no PII). */
  anonymisedFeatures: Record<string, unknown>;

  /** Timestamp feedback was created. */
  createdAt: ISO8601;

  /** Timestamp feedback must be ingested by (within 24h). */
  ingestBy: ISO8601;

  /** Whether feedback has been ingested into the model pipeline. */
  ingested: boolean;

  /** Timestamp feedback was ingested. */
  ingestedAt?: ISO8601;
}

/**
 * Configurable confidence threshold per use case (Requirement 15.5).
 */
export interface ConfidenceThresholdConfig {
  /** Use case this threshold applies to. */
  useCase: ReviewUseCase;

  /** Confidence score below which decisions are routed to human review. */
  threshold: number;

  /** Optional jurisdiction-specific override. */
  jurisdictionOverrides?: Partial<Record<Jurisdiction, number>>;

  /** When this configuration was last updated. */
  updatedAt: ISO8601;

  /** Who last updated this configuration. */
  updatedBy: string;
}

/**
 * Request to submit a decision for human review.
 */
export interface SubmitForReviewRequest {
  /** Use case triggering the review. */
  useCase: ReviewUseCase;

  /** Jurisdiction for data residency. */
  jurisdiction: Jurisdiction;

  /** Whether this is a high-impact action. */
  isHighImpact: boolean;

  /** Specific high-impact action type. */
  highImpactActionType?: HighImpactActionType;

  /** Confidence score of the AI decision. */
  confidenceScore: number;

  /** The AI decision to be reviewed. */
  aiDecision: string;

  /** Complete decision chain for context. */
  decisionChain: DecisionChain;

  /** Customer ID for notification (if applicable). */
  customerId?: string;
}

/**
 * Request to record a human reviewer's decision.
 */
export interface RecordReviewDecisionRequest {
  /** ID of the review item. */
  reviewId: string;

  /** Reviewer's identity. */
  reviewerId: string;

  /** The decision made. */
  decision: ReviewDecision;

  /** Rationale for the decision. */
  rationale: string;

  /** Modified decision (required if decision is MODIFY). */
  modifiedDecision?: string;

  /** Additional notes. */
  notes?: string;
}

/**
 * Storage abstraction for the Human Review Queue.
 */
export interface ReviewQueueStore {
  /** Save a new review item. */
  save(item: ReviewItem): Promise<void>;

  /** Get a review item by ID. */
  getById(reviewId: string): Promise<ReviewItem | null>;

  /** Update an existing review item. */
  update(item: ReviewItem): Promise<void>;

  /** Get pending items for a use case. */
  getPendingByUseCase(useCase: ReviewUseCase, jurisdiction: Jurisdiction): Promise<ReviewItem[]>;

  /** Get all items for an entity. */
  getByEntityId(entityId: string): Promise<ReviewItem[]>;

  /** Save feedback record. */
  saveFeedback(feedback: ReviewFeedback): Promise<void>;

  /** Get pending feedback (not yet ingested). */
  getPendingFeedback(): Promise<ReviewFeedback[]>;

  /** Update feedback record. */
  updateFeedback(feedback: ReviewFeedback): Promise<void>;
}

/**
 * Notification service abstraction for customer notifications.
 */
export interface NotificationService {
  /** Send hold notification to customer. */
  sendHoldNotification(
    customerId: string,
    jurisdiction: Jurisdiction,
    expectedResolutionTime: string
  ): Promise<{ sent: boolean; sentAt: ISO8601; channel: 'SMS' | 'PUSH' | 'EMAIL' | 'IN_APP' }>;
}
