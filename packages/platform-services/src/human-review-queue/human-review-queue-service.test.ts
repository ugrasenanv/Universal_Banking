/**
 * Unit tests for the Human Review Queue Service.
 *
 * Validates:
 * - Requirement 15.1: Route low-confidence decisions within 30 seconds
 * - Requirement 15.2: HITL gate for high-impact actions
 * - Requirement 15.3: Complete decision chain capture
 * - Requirement 15.4: Feedback ingestion (within 24h, no PII)
 * - Requirement 15.5: Configurable confidence thresholds per use case
 * - Requirement 15.6: Customer hold notification within 60 seconds
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HumanReviewQueue } from './human-review-queue-service.js';
import { InMemoryReviewQueueStore } from './in-memory-store.js';
import type {
  ConfidenceThresholdConfig,
  NotificationService,
  SubmitForReviewRequest,
  DecisionChain,
  ReviewUseCase,
} from './types.js';
import type { Jurisdiction } from '@afg/shared-types';

/** Create a mock notification service. */
function createMockNotificationService(): NotificationService {
  return {
    sendHoldNotification: vi.fn().mockResolvedValue({
      sent: true,
      sentAt: new Date().toISOString(),
      channel: 'PUSH' as const,
    }),
  };
}

/** Helper to create a valid decision chain. */
function createDecisionChain(overrides?: Partial<DecisionChain>): DecisionChain {
  return {
    context: { transactionAmount: 50000, channel: 'UPI' },
    modelOutput: { score: 0.45, decision: 'HOLD' },
    modelVersion: 'fraud-v2.3.1',
    sourceServiceId: 'fraud-inference',
    entityId: 'txn-12345',
    ...overrides,
  };
}

/** Helper to create a valid submit request. */
function createSubmitRequest(overrides?: Partial<SubmitForReviewRequest>): SubmitForReviewRequest {
  return {
    useCase: 'FRAUD_DETECTION',
    jurisdiction: 'IN' as Jurisdiction,
    isHighImpact: false,
    confidenceScore: 0.45,
    aiDecision: 'HOLD',
    decisionChain: createDecisionChain(),
    ...overrides,
  };
}

/** Default threshold configs for testing. */
function createDefaultThresholds(): ConfidenceThresholdConfig[] {
  return [
    {
      useCase: 'FRAUD_DETECTION',
      threshold: 0.75,
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'system',
    },
    {
      useCase: 'AML_TRIAGE',
      threshold: 0.80,
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'system',
    },
    {
      useCase: 'CREDIT_UNDERWRITING',
      threshold: 0.70,
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'system',
      jurisdictionOverrides: { SG: 0.85 },
    },
    {
      useCase: 'SANCTIONS_SCREENING',
      threshold: 0.60,
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'system',
    },
    {
      useCase: 'DOCUMENT_EXTRACTION',
      threshold: 0.85,
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'system',
    },
    {
      useCase: 'COMPLAINTS_CLASSIFICATION',
      threshold: 0.70,
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'system',
    },
    {
      useCase: 'BEHAVIOURAL_CREDIT_LINE',
      threshold: 0.60,
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'system',
    },
  ];
}

describe('HumanReviewQueue', () => {
  let queue: HumanReviewQueue;
  let store: InMemoryReviewQueueStore;
  let notificationService: NotificationService;

  beforeEach(() => {
    store = new InMemoryReviewQueueStore();
    notificationService = createMockNotificationService();
    queue = new HumanReviewQueue(store, notificationService, createDefaultThresholds());
  });

  describe('submitForReview — Requirement 15.1: Routing within 30 seconds', () => {
    it('should create a review item with PENDING status', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      expect(item.status).toBe('PENDING');
      expect(item.reviewId).toBeDefined();
      expect(item.queuedAt).toBeDefined();
      expect(item.routedAt).toBeDefined();
    });

    it('should route the item immediately (routedAt equals queuedAt)', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      // Routed immediately upon submission — within 30 seconds
      const queuedTime = new Date(item.queuedAt).getTime();
      const routedTime = new Date(item.routedAt).getTime();
      expect(routedTime - queuedTime).toBeLessThanOrEqual(30_000);
    });

    it('should pass routing time compliance check', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      expect(queue.isRoutingTimeCompliant(item)).toBe(true);
    });

    it('should preserve the use case and jurisdiction', async () => {
      const request = createSubmitRequest({
        useCase: 'AML_TRIAGE',
        jurisdiction: 'SG',
      });
      const item = await queue.submitForReview(request);

      expect(item.useCase).toBe('AML_TRIAGE');
      expect(item.jurisdiction).toBe('SG');
    });

    it('should record the confidence score and threshold at routing time', async () => {
      const request = createSubmitRequest({
        useCase: 'FRAUD_DETECTION',
        confidenceScore: 0.45,
        jurisdiction: 'IN',
      });
      const item = await queue.submitForReview(request);

      expect(item.confidenceScore).toBe(0.45);
      expect(item.thresholdAtRouting).toBe(0.75); // From config
    });

    it('should persist the item to the store', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      const retrieved = await store.getById(item.reviewId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.reviewId).toBe(item.reviewId);
    });
  });

  describe('submitForReview — Requirement 15.2: HITL gate for high-impact actions', () => {
    it('should mark SAR filing as high-impact', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'SAR_FILING',
        useCase: 'AML_TRIAGE',
      });
      const item = await queue.submitForReview(request);

      expect(item.isHighImpact).toBe(true);
      expect(item.highImpactActionType).toBe('SAR_FILING');
    });

    it('should mark transaction hold >1h as high-impact', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'TRANSACTION_HOLD_GT_1H',
      });
      const item = await queue.submitForReview(request);

      expect(item.isHighImpact).toBe(true);
      expect(item.highImpactActionType).toBe('TRANSACTION_HOLD_GT_1H');
    });

    it('should mark credit decline as high-impact', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'CREDIT_DECLINE',
        useCase: 'CREDIT_UNDERWRITING',
      });
      const item = await queue.submitForReview(request);

      expect(item.isHighImpact).toBe(true);
      expect(item.highImpactActionType).toBe('CREDIT_DECLINE');
    });

    it('should mark credit-line reduction as high-impact', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'CREDIT_LINE_REDUCTION',
        useCase: 'BEHAVIOURAL_CREDIT_LINE',
      });
      const item = await queue.submitForReview(request);

      expect(item.isHighImpact).toBe(true);
      expect(item.highImpactActionType).toBe('CREDIT_LINE_REDUCTION');
    });

    it('should NOT allow execution of high-impact action without approval', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'SAR_FILING',
        useCase: 'AML_TRIAGE',
      });
      const item = await queue.submitForReview(request);

      const canExecute = await queue.canExecute(item.reviewId);
      expect(canExecute).toBe(false);
    });

    it('should allow execution of high-impact action AFTER approval', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'SAR_FILING',
        useCase: 'AML_TRIAGE',
      });
      const item = await queue.submitForReview(request);

      // Approve the item
      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'SAR evidence is compelling and well-documented.',
      });

      const canExecute = await queue.canExecute(item.reviewId);
      expect(canExecute).toBe(true);
    });

    it('should NOT allow execution when high-impact action is rejected', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'CREDIT_DECLINE',
        useCase: 'CREDIT_UNDERWRITING',
      });
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'underwriter-001',
        decision: 'REJECT',
        rationale: 'Insufficient evidence for decline. Recommend manual review.',
      });

      const canExecute = await queue.canExecute(item.reviewId);
      expect(canExecute).toBe(false);
    });

    it('should require highImpactActionType when isHighImpact is true', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: undefined,
      });

      await expect(queue.submitForReview(request)).rejects.toThrow(
        'highImpactActionType is required when isHighImpact is true'
      );
    });
  });

  describe('recordDecision — Requirement 15.3: Complete decision chain', () => {
    it('should capture the complete decision chain on submission', async () => {
      const decisionChain = createDecisionChain({
        prompt: 'Assess fraud risk for UPI transaction',
        context: { velocity: 12, deviceNew: true, amount: 50000 },
        modelOutput: { score: 0.45, features: ['velocity', 'device'] },
        modelVersion: 'fraud-v2.3.1',
        sourceServiceId: 'fraud-inference',
        entityId: 'txn-99999',
      });

      const request = createSubmitRequest({ decisionChain });
      const item = await queue.submitForReview(request);

      expect(item.decisionChain.prompt).toBe('Assess fraud risk for UPI transaction');
      expect(item.decisionChain.context).toEqual({ velocity: 12, deviceNew: true, amount: 50000 });
      expect(item.decisionChain.modelOutput).toEqual({ score: 0.45, features: ['velocity', 'device'] });
      expect(item.decisionChain.modelVersion).toBe('fraud-v2.3.1');
      expect(item.decisionChain.sourceServiceId).toBe('fraud-inference');
      expect(item.decisionChain.entityId).toBe('txn-99999');
    });

    it('should record human decision with rationale', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      const reviewed = await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'Transaction pattern consistent with known legitimate behaviour.',
      });

      expect(reviewed.reviewOutcome).toBeDefined();
      expect(reviewed.reviewOutcome!.decision).toBe('APPROVE');
      expect(reviewed.reviewOutcome!.reviewerId).toBe('analyst-001');
      expect(reviewed.reviewOutcome!.rationale).toBe(
        'Transaction pattern consistent with known legitimate behaviour.'
      );
      expect(reviewed.reviewOutcome!.decidedAt).toBeDefined();
    });

    it('should support MODIFY decision with modified outcome', async () => {
      const request = createSubmitRequest({ aiDecision: 'DECLINE' });
      const item = await queue.submitForReview(request);

      const reviewed = await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-002',
        decision: 'MODIFY',
        rationale: 'Customer has known pattern of large transfers before holidays.',
        modifiedDecision: 'APPROVE_WITH_MONITORING',
      });

      expect(reviewed.status).toBe('MODIFIED');
      expect(reviewed.reviewOutcome!.decision).toBe('MODIFY');
      expect(reviewed.reviewOutcome!.modifiedDecision).toBe('APPROVE_WITH_MONITORING');
    });

    it('should update status to APPROVED on approve', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      const reviewed = await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'Verified.',
      });

      expect(reviewed.status).toBe('APPROVED');
    });

    it('should update status to REJECTED on reject', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      const reviewed = await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'REJECT',
        rationale: 'Insufficient evidence.',
      });

      expect(reviewed.status).toBe('REJECTED');
    });

    it('should throw if item not found', async () => {
      await expect(
        queue.recordDecision({
          reviewId: 'non-existent',
          reviewerId: 'analyst-001',
          decision: 'APPROVE',
          rationale: 'Test',
        })
      ).rejects.toThrow('Review item not found');
    });

    it('should throw if item is already decided', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'First decision.',
      });

      await expect(
        queue.recordDecision({
          reviewId: item.reviewId,
          reviewerId: 'analyst-002',
          decision: 'REJECT',
          rationale: 'Second attempt.',
        })
      ).rejects.toThrow('Cannot record decision for item in status');
    });

    it('should require rationale for decisions', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      await expect(
        queue.recordDecision({
          reviewId: item.reviewId,
          reviewerId: 'analyst-001',
          decision: 'APPROVE',
          rationale: '',
        })
      ).rejects.toThrow('rationale is required');
    });

    it('should require modifiedDecision when decision is MODIFY', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      await expect(
        queue.recordDecision({
          reviewId: item.reviewId,
          reviewerId: 'analyst-001',
          decision: 'MODIFY',
          rationale: 'Need to change.',
        })
      ).rejects.toThrow('modifiedDecision is required when decision is MODIFY');
    });
  });

  describe('generateFeedback — Requirement 15.4: Model improvement pipeline', () => {
    it('should create feedback record from reviewed item', async () => {
      const request = createSubmitRequest({ aiDecision: 'HOLD' });
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'Legitimate transaction.',
      });

      const feedback = await queue.generateFeedback(item.reviewId, {
        velocity_score: 0.8,
        amount_category: 'HIGH',
      });

      expect(feedback.feedbackId).toBeDefined();
      expect(feedback.reviewId).toBe(item.reviewId);
      expect(feedback.useCase).toBe('FRAUD_DETECTION');
      expect(feedback.originalAiDecision).toBe('HOLD');
      expect(feedback.humanDecision).toBe('APPROVE');
      expect(feedback.modelVersion).toBe('fraud-v2.3.1');
      expect(feedback.ingested).toBe(false);
    });

    it('should set ingestBy to 24 hours from creation', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'OK.',
      });

      const feedback = await queue.generateFeedback(item.reviewId, { score: 0.5 });

      const createdTime = new Date(feedback.createdAt).getTime();
      const ingestByTime = new Date(feedback.ingestBy).getTime();
      const diffHours = (ingestByTime - createdTime) / (1000 * 60 * 60);

      expect(diffHours).toBe(24);
    });

    it('should reject feedback with PII (email pattern)', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'OK.',
      });

      await expect(
        queue.generateFeedback(item.reviewId, {
          email: 'john.doe@example.com',
        })
      ).rejects.toThrow('PII detected');
    });

    it('should reject feedback with PII (Aadhaar-like pattern)', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'OK.',
      });

      await expect(
        queue.generateFeedback(item.reviewId, {
          id_number: '123456789012',
        })
      ).rejects.toThrow('PII detected');
    });

    it('should reject feedback with PII (PAN card pattern)', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'OK.',
      });

      await expect(
        queue.generateFeedback(item.reviewId, {
          pan: 'ABCDE1234F',
        })
      ).rejects.toThrow('PII detected');
    });

    it('should allow anonymised features without PII', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'OK.',
      });

      const feedback = await queue.generateFeedback(item.reviewId, {
        amount_bucket: 'HIGH',
        velocity_7d: 15,
        device_age_days: 30,
        is_new_payee: true,
      });

      expect(feedback.anonymisedFeatures).toEqual({
        amount_bucket: 'HIGH',
        velocity_7d: 15,
        device_age_days: 30,
        is_new_payee: true,
      });
    });

    it('should throw if item has not been reviewed', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      await expect(
        queue.generateFeedback(item.reviewId, { score: 0.5 })
      ).rejects.toThrow('has not been reviewed yet');
    });

    it('should mark feedback as ingested', async () => {
      const request = createSubmitRequest();
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'OK.',
      });

      const feedback = await queue.generateFeedback(item.reviewId, { score: 0.5 });
      await queue.markFeedbackIngested(feedback.feedbackId);

      const pending = await queue.getPendingFeedback();
      expect(pending.find((f) => f.feedbackId === feedback.feedbackId)).toBeUndefined();
    });

    it('should track final decision for MODIFY correctly', async () => {
      const request = createSubmitRequest({ aiDecision: 'DECLINE' });
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'MODIFY',
        rationale: 'Override to approve with conditions.',
        modifiedDecision: 'APPROVE_WITH_CONDITIONS',
      });

      const feedback = await queue.generateFeedback(item.reviewId, { score: 0.3 });
      expect(feedback.finalDecision).toBe('APPROVE_WITH_CONDITIONS');
    });

    it('should track final decision for REJECT correctly', async () => {
      const request = createSubmitRequest({ aiDecision: 'APPROVE' });
      const item = await queue.submitForReview(request);

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'REJECT',
        rationale: 'False positive.',
      });

      const feedback = await queue.generateFeedback(item.reviewId, { score: 0.9 });
      expect(feedback.finalDecision).toBe('REJECTED:APPROVE');
    });
  });

  describe('requiresHumanReview — Requirement 15.5: Configurable thresholds', () => {
    it('should require review when confidence is below threshold', () => {
      // Fraud threshold is 0.75
      expect(queue.requiresHumanReview('FRAUD_DETECTION', 0.50, 'IN')).toBe(true);
      expect(queue.requiresHumanReview('FRAUD_DETECTION', 0.74, 'IN')).toBe(true);
    });

    it('should NOT require review when confidence is at or above threshold', () => {
      expect(queue.requiresHumanReview('FRAUD_DETECTION', 0.75, 'IN')).toBe(false);
      expect(queue.requiresHumanReview('FRAUD_DETECTION', 0.90, 'IN')).toBe(false);
    });

    it('should use different thresholds per use case', () => {
      // AML threshold is 0.80
      expect(queue.requiresHumanReview('AML_TRIAGE', 0.79, 'IN')).toBe(true);
      expect(queue.requiresHumanReview('AML_TRIAGE', 0.80, 'IN')).toBe(false);

      // Sanctions threshold is 0.60
      expect(queue.requiresHumanReview('SANCTIONS_SCREENING', 0.59, 'IN')).toBe(true);
      expect(queue.requiresHumanReview('SANCTIONS_SCREENING', 0.60, 'IN')).toBe(false);
    });

    it('should apply jurisdiction-specific overrides', () => {
      // Credit underwriting base threshold is 0.70, SG override is 0.85
      expect(queue.requiresHumanReview('CREDIT_UNDERWRITING', 0.72, 'IN')).toBe(false);
      expect(queue.requiresHumanReview('CREDIT_UNDERWRITING', 0.72, 'SG')).toBe(true);
      expect(queue.requiresHumanReview('CREDIT_UNDERWRITING', 0.85, 'SG')).toBe(false);
    });

    it('should ALWAYS require review for high-impact actions regardless of confidence', () => {
      expect(
        queue.requiresHumanReview('AML_TRIAGE', 0.99, 'IN', 'SAR_FILING')
      ).toBe(true);
      expect(
        queue.requiresHumanReview('FRAUD_DETECTION', 0.99, 'IN', 'TRANSACTION_HOLD_GT_1H')
      ).toBe(true);
      expect(
        queue.requiresHumanReview('CREDIT_UNDERWRITING', 0.99, 'IN', 'CREDIT_DECLINE')
      ).toBe(true);
      expect(
        queue.requiresHumanReview('BEHAVIOURAL_CREDIT_LINE', 0.99, 'IN', 'CREDIT_LINE_REDUCTION')
      ).toBe(true);
    });

    it('should use default threshold (0.75) for unconfigured use cases', () => {
      // Remove all thresholds
      const bareQueue = new HumanReviewQueue(store, notificationService);
      expect(bareQueue.requiresHumanReview('FRAUD_DETECTION', 0.74, 'IN')).toBe(true);
      expect(bareQueue.requiresHumanReview('FRAUD_DETECTION', 0.75, 'IN')).toBe(false);
    });

    it('should allow updating thresholds at runtime', () => {
      queue.setThresholdConfig({
        useCase: 'FRAUD_DETECTION',
        threshold: 0.90,
        updatedAt: '2024-06-01T00:00:00.000Z',
        updatedBy: 'admin',
      });

      expect(queue.requiresHumanReview('FRAUD_DETECTION', 0.80, 'IN')).toBe(true);
      expect(queue.requiresHumanReview('FRAUD_DETECTION', 0.90, 'IN')).toBe(false);
    });

    it('should reject invalid threshold values', () => {
      expect(() =>
        queue.setThresholdConfig({
          useCase: 'FRAUD_DETECTION',
          threshold: 1.5,
          updatedAt: '2024-06-01T00:00:00.000Z',
          updatedBy: 'admin',
        })
      ).toThrow('Threshold must be between 0.00 and 1.00');

      expect(() =>
        queue.setThresholdConfig({
          useCase: 'FRAUD_DETECTION',
          threshold: -0.1,
          updatedAt: '2024-06-01T00:00:00.000Z',
          updatedBy: 'admin',
        })
      ).toThrow('Threshold must be between 0.00 and 1.00');
    });
  });

  describe('Customer notification — Requirement 15.6: Within 60 seconds', () => {
    it('should send notification for high-impact actions with customerId', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'TRANSACTION_HOLD_GT_1H',
        customerId: 'cust-123',
      });

      const item = await queue.submitForReview(request);

      expect(item.customerNotification).toBeDefined();
      expect(item.customerNotification!.sent).toBe(true);
      expect(item.customerNotification!.customerId).toBe('cust-123');
      expect(item.customerNotification!.sentAt).toBeDefined();
    });

    it('should NOT send notification for non-high-impact actions', async () => {
      const request = createSubmitRequest({
        isHighImpact: false,
        customerId: 'cust-123',
      });

      const item = await queue.submitForReview(request);

      expect(item.customerNotification).toBeUndefined();
    });

    it('should NOT send notification when customerId is not provided', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'CREDIT_DECLINE',
      });

      const item = await queue.submitForReview(request);

      expect(item.customerNotification).toBeUndefined();
    });

    it('should pass notification compliance check when sent within 60s', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'TRANSACTION_HOLD_GT_1H',
        customerId: 'cust-456',
      });

      const item = await queue.submitForReview(request);

      expect(queue.isNotificationTimeCompliant(item)).toBe(true);
    });

    it('should include expected resolution time in notification', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'TRANSACTION_HOLD_GT_1H',
        customerId: 'cust-789',
      });

      const item = await queue.submitForReview(request);

      expect(item.customerNotification!.expectedResolutionTime).toBeDefined();
    });

    it('should call the notification service with correct params', async () => {
      const request = createSubmitRequest({
        isHighImpact: true,
        highImpactActionType: 'TRANSACTION_HOLD_GT_1H',
        customerId: 'cust-001',
        jurisdiction: 'SG',
      });

      await queue.submitForReview(request);

      expect(notificationService.sendHoldNotification).toHaveBeenCalledWith(
        'cust-001',
        'SG',
        expect.any(String)
      );
    });
  });

  describe('validation', () => {
    it('should reject submission with missing useCase', async () => {
      const request = createSubmitRequest({ useCase: '' as ReviewUseCase });
      await expect(queue.submitForReview(request)).rejects.toThrow('useCase is required');
    });

    it('should reject submission with missing jurisdiction', async () => {
      const request = createSubmitRequest({ jurisdiction: '' as Jurisdiction });
      await expect(queue.submitForReview(request)).rejects.toThrow('jurisdiction is required');
    });

    it('should reject submission with invalid confidence score', async () => {
      await expect(
        queue.submitForReview(createSubmitRequest({ confidenceScore: 1.5 }))
      ).rejects.toThrow('confidenceScore must be between 0.00 and 1.00');

      await expect(
        queue.submitForReview(createSubmitRequest({ confidenceScore: -0.1 }))
      ).rejects.toThrow('confidenceScore must be between 0.00 and 1.00');
    });

    it('should reject submission with empty aiDecision', async () => {
      const request = createSubmitRequest({ aiDecision: '' });
      await expect(queue.submitForReview(request)).rejects.toThrow('aiDecision is required');
    });

    it('should reject submission with missing decisionChain.modelVersion', async () => {
      const request = createSubmitRequest({
        decisionChain: createDecisionChain({ modelVersion: '' }),
      });
      await expect(queue.submitForReview(request)).rejects.toThrow(
        'decisionChain.modelVersion is required'
      );
    });

    it('should reject submission with missing decisionChain.sourceServiceId', async () => {
      const request = createSubmitRequest({
        decisionChain: createDecisionChain({ sourceServiceId: '' }),
      });
      await expect(queue.submitForReview(request)).rejects.toThrow(
        'decisionChain.sourceServiceId is required'
      );
    });

    it('should reject submission with missing decisionChain.entityId', async () => {
      const request = createSubmitRequest({
        decisionChain: createDecisionChain({ entityId: '' }),
      });
      await expect(queue.submitForReview(request)).rejects.toThrow(
        'decisionChain.entityId is required'
      );
    });

    it('should reject decision recording with empty reviewerId', async () => {
      const item = await queue.submitForReview(createSubmitRequest());

      await expect(
        queue.recordDecision({
          reviewId: item.reviewId,
          reviewerId: '',
          decision: 'APPROVE',
          rationale: 'Test.',
        })
      ).rejects.toThrow('reviewerId is required');
    });
  });

  describe('getReviewItem and getPendingItems', () => {
    it('should retrieve item by ID', async () => {
      const request = createSubmitRequest();
      const submitted = await queue.submitForReview(request);

      const retrieved = await queue.getReviewItem(submitted.reviewId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.reviewId).toBe(submitted.reviewId);
    });

    it('should return null for non-existent item', async () => {
      const retrieved = await queue.getReviewItem('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should list pending items by use case and jurisdiction', async () => {
      await queue.submitForReview(
        createSubmitRequest({ useCase: 'FRAUD_DETECTION', jurisdiction: 'IN' })
      );
      await queue.submitForReview(
        createSubmitRequest({ useCase: 'FRAUD_DETECTION', jurisdiction: 'IN' })
      );
      await queue.submitForReview(
        createSubmitRequest({ useCase: 'AML_TRIAGE', jurisdiction: 'IN' })
      );
      await queue.submitForReview(
        createSubmitRequest({ useCase: 'FRAUD_DETECTION', jurisdiction: 'SG' })
      );

      const fraudIN = await queue.getPendingItems('FRAUD_DETECTION', 'IN');
      expect(fraudIN).toHaveLength(2);

      const amlIN = await queue.getPendingItems('AML_TRIAGE', 'IN');
      expect(amlIN).toHaveLength(1);

      const fraudSG = await queue.getPendingItems('FRAUD_DETECTION', 'SG');
      expect(fraudSG).toHaveLength(1);
    });
  });

  describe('isApproved — HITL gate', () => {
    it('should return false for pending items', async () => {
      const item = await queue.submitForReview(createSubmitRequest());
      expect(await queue.isApproved(item.reviewId)).toBe(false);
    });

    it('should return true only for approved items', async () => {
      const item = await queue.submitForReview(createSubmitRequest());

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'Verified.',
      });

      expect(await queue.isApproved(item.reviewId)).toBe(true);
    });

    it('should return false for rejected items', async () => {
      const item = await queue.submitForReview(createSubmitRequest());

      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'REJECT',
        rationale: 'Not valid.',
      });

      expect(await queue.isApproved(item.reviewId)).toBe(false);
    });

    it('should return false for non-existent items', async () => {
      expect(await queue.isApproved('non-existent')).toBe(false);
    });
  });

  describe('feedback ingestion compliance', () => {
    it('should pass compliance when ingested within deadline', async () => {
      const item = await queue.submitForReview(createSubmitRequest());
      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'OK.',
      });

      const feedback = await queue.generateFeedback(item.reviewId, { score: 0.5 });

      // Simulate ingestion within deadline
      feedback.ingested = true;
      feedback.ingestedAt = new Date(
        new Date(feedback.createdAt).getTime() + 12 * 60 * 60 * 1000 // 12 hours later
      ).toISOString();

      expect(queue.isFeedbackIngestionCompliant(feedback)).toBe(true);
    });

    it('should fail compliance when ingested after deadline', async () => {
      const item = await queue.submitForReview(createSubmitRequest());
      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'OK.',
      });

      const feedback = await queue.generateFeedback(item.reviewId, { score: 0.5 });

      // Simulate late ingestion (25 hours)
      feedback.ingested = true;
      feedback.ingestedAt = new Date(
        new Date(feedback.createdAt).getTime() + 25 * 60 * 60 * 1000
      ).toISOString();

      expect(queue.isFeedbackIngestionCompliant(feedback)).toBe(false);
    });

    it('should fail compliance when not ingested', async () => {
      const item = await queue.submitForReview(createSubmitRequest());
      await queue.recordDecision({
        reviewId: item.reviewId,
        reviewerId: 'analyst-001',
        decision: 'APPROVE',
        rationale: 'OK.',
      });

      const feedback = await queue.generateFeedback(item.reviewId, { score: 0.5 });

      expect(queue.isFeedbackIngestionCompliant(feedback)).toBe(false);
    });
  });
});
