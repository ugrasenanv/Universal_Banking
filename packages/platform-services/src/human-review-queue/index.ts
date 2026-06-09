/**
 * Human Review Queue module.
 *
 * Provides structured human oversight for high-impact AI decisions
 * with full audit trails, feedback loops, and configurable thresholds.
 */

export { HumanReviewQueue } from './human-review-queue-service.js';
export { InMemoryReviewQueueStore } from './in-memory-store.js';
export type {
  ConfidenceThresholdConfig,
  CustomerNotification,
  DecisionChain,
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
