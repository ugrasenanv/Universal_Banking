/**
 * In-memory implementation of ReviewQueueStore for testing.
 *
 * Provides a simple, synchronous backing store for unit tests
 * without requiring external infrastructure.
 */

import type { Jurisdiction } from '@afg/shared-types';
import type {
  ReviewFeedback,
  ReviewItem,
  ReviewQueueStore,
  ReviewUseCase,
} from './types.js';

/**
 * In-memory store for the Human Review Queue.
 * Suitable for unit tests and local development.
 */
export class InMemoryReviewQueueStore implements ReviewQueueStore {
  private items: Map<string, ReviewItem> = new Map();
  private feedbackRecords: Map<string, ReviewFeedback> = new Map();

  async save(item: ReviewItem): Promise<void> {
    this.items.set(item.reviewId, { ...item });
  }

  async getById(reviewId: string): Promise<ReviewItem | null> {
    const item = this.items.get(reviewId);
    return item ? { ...item } : null;
  }

  async update(item: ReviewItem): Promise<void> {
    if (!this.items.has(item.reviewId)) {
      throw new Error(`Review item not found: ${item.reviewId}`);
    }
    this.items.set(item.reviewId, { ...item });
  }

  async getPendingByUseCase(
    useCase: ReviewUseCase,
    jurisdiction: Jurisdiction
  ): Promise<ReviewItem[]> {
    const results: ReviewItem[] = [];
    for (const item of this.items.values()) {
      if (
        item.useCase === useCase &&
        item.jurisdiction === jurisdiction &&
        (item.status === 'PENDING' || item.status === 'ASSIGNED')
      ) {
        results.push({ ...item });
      }
    }
    return results;
  }

  async getByEntityId(entityId: string): Promise<ReviewItem[]> {
    const results: ReviewItem[] = [];
    for (const item of this.items.values()) {
      if (item.decisionChain.entityId === entityId) {
        results.push({ ...item });
      }
    }
    return results;
  }

  async saveFeedback(feedback: ReviewFeedback): Promise<void> {
    this.feedbackRecords.set(feedback.feedbackId, { ...feedback });
  }

  async getPendingFeedback(): Promise<ReviewFeedback[]> {
    const results: ReviewFeedback[] = [];
    for (const feedback of this.feedbackRecords.values()) {
      if (!feedback.ingested) {
        results.push({ ...feedback });
      }
    }
    return results;
  }

  async updateFeedback(feedback: ReviewFeedback): Promise<void> {
    if (!this.feedbackRecords.has(feedback.feedbackId)) {
      throw new Error(`Feedback not found: ${feedback.feedbackId}`);
    }
    this.feedbackRecords.set(feedback.feedbackId, { ...feedback });
  }

  /** Test helper: get all items in the store. */
  getAllItems(): ReviewItem[] {
    return [...this.items.values()];
  }

  /** Test helper: get all feedback records. */
  getAllFeedback(): ReviewFeedback[] {
    return [...this.feedbackRecords.values()];
  }

  /** Test helper: clear the store. */
  clear(): void {
    this.items.clear();
    this.feedbackRecords.clear();
  }
}
