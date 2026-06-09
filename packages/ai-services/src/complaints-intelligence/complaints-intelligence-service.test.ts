/**
 * Unit Tests: Complaints Intelligence Service
 *
 * Tests complaint classification, routing, structured summary generation,
 * audit trail emission, low-confidence escalation, and fallback handling.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComplaintsIntelligenceService } from './complaints-intelligence-service.js';
import type {
  ComplaintClassificationRequest,
  ComplaintClassificationModelAdapter,
  ComplaintClassificationResult,
  ComplaintAuditEmitter,
  ComplaintAuditRecord,
  ComplaintsIntelligenceConfig,
} from './types.js';
import { DEFAULT_COMPLAINTS_INTELLIGENCE_CONFIG, DEFAULT_CATEGORY_TEAM_MAP } from './types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ──────────────────────────────────────────────────────────────────────────────

function createMockRequest(overrides?: Partial<ComplaintClassificationRequest>): ComplaintClassificationRequest {
  return {
    complaintId: 'CMP-2024-001',
    customerId: 'CUST-123456',
    complaintText: 'I was charged an incorrect EMI amount on my home loan this month.',
    channel: 'MOBILE_APP',
    receivedAt: '2024-06-15T10:30:00.000Z',
    jurisdiction: 'IN',
    ...overrides,
  };
}

function createMockClassificationResult(
  overrides?: Partial<ComplaintClassificationResult>
): ComplaintClassificationResult {
  return {
    category: 'LOANS_AND_ADVANCES',
    subcategory: 'EMI_ISSUES',
    confidence: 0.92,
    reasoningFactors: ['EMI keyword detected', 'Loan product reference', 'Amount discrepancy pattern'],
    customerIssueSummary: 'Customer reports incorrect EMI charge on home loan.',
    ...overrides,
  };
}

function createMockModelAdapter(
  result?: ComplaintClassificationResult,
  shouldThrow?: boolean,
  delay?: number
): ComplaintClassificationModelAdapter {
  return {
    classify: vi.fn().mockImplementation(async () => {
      if (delay) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (shouldThrow) {
        throw new Error('Model unavailable');
      }
      return result ?? createMockClassificationResult();
    }),
  };
}

function createMockAuditEmitter(): ComplaintAuditEmitter & { lastRecord?: Omit<ComplaintAuditRecord, 'artefactId'> } {
  const emitter: ComplaintAuditEmitter & { lastRecord?: Omit<ComplaintAuditRecord, 'artefactId'> } = {
    emit: vi.fn().mockImplementation(async (record) => {
      emitter.lastRecord = record;
      return `AUDIT-${Date.now()}`;
    }),
  };
  return emitter;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('ComplaintsIntelligenceService', () => {
  let modelAdapter: ComplaintClassificationModelAdapter;
  let auditEmitter: ReturnType<typeof createMockAuditEmitter>;
  let service: ComplaintsIntelligenceService;

  beforeEach(() => {
    modelAdapter = createMockModelAdapter();
    auditEmitter = createMockAuditEmitter();
    service = new ComplaintsIntelligenceService(modelAdapter, auditEmitter);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Req 10.1: Classification and routing within 30 seconds
  // ──────────────────────────────────────────────────────────────────────────

  describe('Classification and Routing (Req 10.1)', () => {
    it('should classify a complaint and route to the mapped resolution team', async () => {
      const request = createMockRequest();
      const response = await service.classifyAndRoute(request);

      expect(response.complaintId).toBe('CMP-2024-001');
      expect(response.category).toBe('LOANS_AND_ADVANCES');
      expect(response.subcategory).toBe('EMI_ISSUES');
      expect(response.routedToTeam).toBe('LOAN_SERVICING');
      expect(response.confidence).toBe(0.92);
      expect(response.escalatedToSeniorOfficer).toBe(false);
      expect(response.fallbackTriggered).toBe(false);
    });

    it('should route CREDIT_CARDS complaints to CARD_OPERATIONS', async () => {
      const adapter = createMockModelAdapter(
        createMockClassificationResult({
          category: 'CREDIT_CARDS',
          subcategory: 'BILLING_DISPUTE',
          confidence: 0.88,
        })
      );
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.routedToTeam).toBe('CARD_OPERATIONS');
    });

    it('should route INTERNET_BANKING complaints to DIGITAL_BANKING', async () => {
      const adapter = createMockModelAdapter(
        createMockClassificationResult({
          category: 'INTERNET_BANKING',
          subcategory: 'LOGIN_ISSUES',
          confidence: 0.95,
        })
      );
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.routedToTeam).toBe('DIGITAL_BANKING');
    });

    it('should route ATM_DEBIT_CARDS complaints to ATM_OPERATIONS', async () => {
      const adapter = createMockModelAdapter(
        createMockClassificationResult({
          category: 'ATM_DEBIT_CARDS',
          subcategory: 'ATM_CASH_NOT_DISPENSED',
          confidence: 0.91,
        })
      );
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.routedToTeam).toBe('ATM_OPERATIONS');
    });

    it('should deterministically map all categories to their configured teams', () => {
      for (const [category, expectedTeam] of Object.entries(DEFAULT_CATEGORY_TEAM_MAP)) {
        const team = service.getTeamForCategory(category as any);
        expect(team).toBe(expectedTeam);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Req 10.3: Structured summary (RBI CMS schema)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Structured Summary Generation (Req 10.3)', () => {
    it('should generate a structured summary conforming to RBI CMS schema', async () => {
      const request = createMockRequest();
      const response = await service.classifyAndRoute(request);
      const summary = response.structuredSummary;

      expect(summary.complaintReferenceNumber).toBe('CMP-2024-001');
      expect(summary.category).toBe('LOANS_AND_ADVANCES');
      expect(summary.subcategory).toBe('EMI_ISSUES');
      expect(summary.customerIssue).toContain('incorrect EMI amount');
      expect(summary.resolutionTeam).toBe('LOAN_SERVICING');
      expect(summary.classificationConfidence).toBe(0.92);
      expect(summary.classifiedAt).toBeDefined();
      expect(summary.escalated).toBe(false);
      expect(summary.escalationReason).toBeUndefined();
    });

    it('should truncate long complaint text to 500 chars in customerIssue', async () => {
      const longText = 'A'.repeat(600);
      const adapter = createMockModelAdapter();
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);
      const request = createMockRequest({ complaintText: longText });

      const response = await svc.classifyAndRoute(request);
      expect(response.structuredSummary.customerIssue.length).toBeLessThanOrEqual(500);
    });

    it('should include escalation reason in summary when escalated', async () => {
      const adapter = createMockModelAdapter(
        createMockClassificationResult({ confidence: 0.5 })
      );
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.structuredSummary.escalated).toBe(true);
      expect(response.structuredSummary.escalationReason).toContain('below threshold');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Req 10.4: Audit trail with 7-year retention
  // ──────────────────────────────────────────────────────────────────────────

  describe('Audit Trail (Req 10.4)', () => {
    it('should emit an audit record for every classification', async () => {
      const request = createMockRequest();
      await service.classifyAndRoute(request);

      expect(auditEmitter.emit).toHaveBeenCalledOnce();
      const record = auditEmitter.lastRecord!;
      expect(record.complaintId).toBe('CMP-2024-001');
      expect(record.categoryAssigned).toBe('LOANS_AND_ADVANCES');
      expect(record.subcategoryAssigned).toBe('EMI_ISSUES');
      expect(record.confidenceScore).toBe(0.92);
      expect(record.classificationReasoning).toHaveLength(3);
      expect(record.routingDecision).toBe('LOAN_SERVICING');
      expect(record.escalated).toBe(false);
      expect(record.jurisdiction).toBe('IN');
      expect(record.serviceVersion).toBe('1.0.0');
      expect(record.fallbackTriggered).toBe(false);
    });

    it('should set retention expiry to 7 years from classification', async () => {
      await service.classifyAndRoute(createMockRequest());
      const record = auditEmitter.lastRecord!;
      const expiry = new Date(record.retentionExpiry);
      const now = new Date();
      const diffYears = expiry.getFullYear() - now.getFullYear();
      expect(diffYears).toBe(7);
    });

    it('should return the audit artefact ID in the response', async () => {
      const response = await service.classifyAndRoute(createMockRequest());
      expect(response.auditArtefactId).toMatch(/^AUDIT-/);
    });

    it('should record failure event in audit when fallback triggered', async () => {
      const adapter = createMockModelAdapter(undefined, true);
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      await svc.classifyAndRoute(createMockRequest());
      const record = auditEmitter.lastRecord!;
      expect(record.fallbackTriggered).toBe(true);
      expect(record.failureEvent).toBe('Model unavailable');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Req 10.5: Low-confidence escalation to senior officer
  // ──────────────────────────────────────────────────────────────────────────

  describe('Low-Confidence Escalation (Req 10.5)', () => {
    it('should escalate to senior officer when confidence below threshold', async () => {
      const adapter = createMockModelAdapter(
        createMockClassificationResult({ confidence: 0.60 })
      );
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.escalatedToSeniorOfficer).toBe(true);
      expect(response.routedToTeam).toBe('SENIOR_OFFICER');
      expect(response.confidence).toBe(0.60);
    });

    it('should not escalate when confidence equals the threshold', async () => {
      const adapter = createMockModelAdapter(
        createMockClassificationResult({ confidence: 0.75 })
      );
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.escalatedToSeniorOfficer).toBe(false);
      expect(response.routedToTeam).toBe('LOAN_SERVICING');
    });

    it('should not escalate when confidence above the threshold', async () => {
      const adapter = createMockModelAdapter(
        createMockClassificationResult({ confidence: 0.85 })
      );
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.escalatedToSeniorOfficer).toBe(false);
    });

    it('should use custom confidence threshold from config', async () => {
      const adapter = createMockModelAdapter(
        createMockClassificationResult({ confidence: 0.85 })
      );
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter, {
        confidenceThreshold: 0.90,
      });

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.escalatedToSeniorOfficer).toBe(true);
      expect(response.routedToTeam).toBe('SENIOR_OFFICER');
    });

    it('should record escalation reason in audit trail', async () => {
      const adapter = createMockModelAdapter(
        createMockClassificationResult({ confidence: 0.50 })
      );
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      await svc.classifyAndRoute(createMockRequest());
      const record = auditEmitter.lastRecord!;
      expect(record.escalated).toBe(true);
      expect(record.escalationReason).toContain('0.50');
      expect(record.escalationReason).toContain('threshold');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Req 10.6: Fallback to manual classification
  // ──────────────────────────────────────────────────────────────────────────

  describe('Fallback to Manual Classification (Req 10.6)', () => {
    it('should fallback to senior officer when model throws an error', async () => {
      const adapter = createMockModelAdapter(undefined, true);
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.fallbackTriggered).toBe(true);
      expect(response.routedToTeam).toBe('SENIOR_OFFICER');
      expect(response.escalatedToSeniorOfficer).toBe(true);
      expect(response.category).toBe('OTHERS');
      expect(response.confidence).toBe(0);
    });

    it('should fallback when classification exceeds timeout', async () => {
      // Set a very short timeout for testing
      const adapter = createMockModelAdapter(undefined, false, 100);
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter, {
        classificationTimeoutMs: 50,
      });

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.fallbackTriggered).toBe(true);
      expect(response.routedToTeam).toBe('SENIOR_OFFICER');
      expect(response.escalatedToSeniorOfficer).toBe(true);
    });

    it('should still emit audit record when fallback is triggered', async () => {
      const adapter = createMockModelAdapter(undefined, true);
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(auditEmitter.emit).toHaveBeenCalledOnce();
      expect(response.auditArtefactId).toMatch(/^AUDIT-/);
    });

    it('should generate structured summary even when fallback triggered', async () => {
      const adapter = createMockModelAdapter(undefined, true);
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter);

      const response = await svc.classifyAndRoute(createMockRequest());
      const summary = response.structuredSummary;
      expect(summary.category).toBe('OTHERS');
      expect(summary.subcategory).toBe('MISCELLANEOUS');
      expect(summary.resolutionTeam).toBe('SENIOR_OFFICER');
      expect(summary.escalated).toBe(true);
      expect(summary.escalationReason).toContain('manual classification');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Validation
  // ──────────────────────────────────────────────────────────────────────────

  describe('Request Validation', () => {
    it('should reject request with missing complaintId', async () => {
      const request = createMockRequest({ complaintId: '' });
      await expect(service.classifyAndRoute(request)).rejects.toThrow('complaintId is required');
    });

    it('should reject request with missing customerId', async () => {
      const request = createMockRequest({ customerId: '' });
      await expect(service.classifyAndRoute(request)).rejects.toThrow('customerId is required');
    });

    it('should reject request with missing complaintText', async () => {
      const request = createMockRequest({ complaintText: '' });
      await expect(service.classifyAndRoute(request)).rejects.toThrow('complaintText is required');
    });

    it('should reject request with missing jurisdiction', async () => {
      const request = createMockRequest({ jurisdiction: '' as any });
      await expect(service.classifyAndRoute(request)).rejects.toThrow('jurisdiction is required');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Configuration
  // ──────────────────────────────────────────────────────────────────────────

  describe('Configuration', () => {
    it('should use default config when no overrides provided', () => {
      const config = service.getConfig();
      expect(config.serviceId).toBe('complaints-intelligence-service');
      expect(config.confidenceThreshold).toBe(0.75);
      expect(config.classificationTimeoutMs).toBe(30_000);
      expect(config.retentionYears).toBe(7);
    });

    it('should merge custom config with defaults', () => {
      const customService = new ComplaintsIntelligenceService(modelAdapter, auditEmitter, {
        serviceVersion: '2.0.0',
        confidenceThreshold: 0.80,
      });
      const config = customService.getConfig();
      expect(config.serviceVersion).toBe('2.0.0');
      expect(config.confidenceThreshold).toBe(0.80);
      expect(config.classificationTimeoutMs).toBe(30_000); // Default preserved
    });

    it('should allow custom category-team mapping', async () => {
      const customMap = {
        ...DEFAULT_CATEGORY_TEAM_MAP,
        CREDIT_CARDS: 'GENERAL_CUSTOMER_SERVICE' as const,
      };
      const adapter = createMockModelAdapter(
        createMockClassificationResult({
          category: 'CREDIT_CARDS',
          subcategory: 'BILLING_DISPUTE',
          confidence: 0.90,
        })
      );
      const svc = new ComplaintsIntelligenceService(adapter, auditEmitter, {
        categoryTeamMap: customMap,
      });

      const response = await svc.classifyAndRoute(createMockRequest());
      expect(response.routedToTeam).toBe('GENERAL_CUSTOMER_SERVICE');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Processing Time
  // ──────────────────────────────────────────────────────────────────────────

  describe('Processing Time', () => {
    it('should report processing time in the response', async () => {
      const response = await service.classifyAndRoute(createMockRequest());
      expect(response.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof response.processingTimeMs).toBe('number');
    });
  });
});
