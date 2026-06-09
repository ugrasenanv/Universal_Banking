/**
 * Unit tests for AMLTriageService.
 *
 * Tests cover:
 * - Alert triage classification (ESCALATE_L2, RECOMMEND_CLOSURE, INVESTIGATE)
 * - Priority scoring (1-100) with reasoning summary
 * - Narrative generation via RAG within 60s timeout
 * - SAR draft preparation with HITL enforcement
 * - Audit artefact emission (prompt, context, output, analyst decision)
 * - Groundedness scoring and low-confidence flagging
 * - Data source unavailability handling
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AMLTriageService } from './aml-triage-service.js';
import type {
  AMLTriageRequest,
  NarrativeGenerationRequest,
  SARFilingRequest,
  AMLClassificationModelAdapter,
  AMLRAGAdapter,
  AMLNarrativeGeneratorAdapter,
  AMLAuditEmitter,
  ClassificationResult,
  RAGCaseHistoryResult,
  NarrativeResult,
  AMLTriageConfig,
} from './types.js';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

function createMockTriageRequest(overrides?: Partial<AMLTriageRequest>): AMLTriageRequest {
  return {
    alertId: 'alert-001',
    alertType: 'TRANSACTION_MONITORING',
    entityId: 'entity-001',
    alertData: {
      amount: 150000,
      currency: 'INR',
      alertTimestamp: '2024-06-15T10:00:00Z',
      sourceSystem: 'tm-engine',
      triggerRule: 'RULE_LARGE_CASH',
      riskIndicators: ['large_cash_deposit', 'new_account'],
      relatedTransactions: ['txn-001', 'txn-002'],
      metadata: {},
    },
    jurisdiction: 'IN',
    ...overrides,
  };
}

function createMockNarrativeRequest(
  overrides?: Partial<NarrativeGenerationRequest>
): NarrativeGenerationRequest {
  return {
    caseId: 'case-001',
    analystId: 'analyst-001',
    scope: 'INVESTIGATION_NARRATIVE',
    jurisdiction: 'IN',
    ...overrides,
  };
}

function createMockSARRequest(overrides?: Partial<SARFilingRequest>): SARFilingRequest {
  return {
    caseId: 'case-001',
    analystId: 'analyst-001',
    narrativeId: 'narrative-001',
    analystApproval: true,
    jurisdiction: 'IN',
    ...overrides,
  };
}

function createMockClassificationModel(
  overrides?: Partial<ClassificationResult>
): AMLClassificationModelAdapter {
  return {
    classify: vi.fn().mockResolvedValue({
      disposition: 'ESCALATE_L2',
      priorityScore: 85,
      confidence: 0.92,
      reasoningFactors: ['Large cash deposit', 'New account', 'High-risk jurisdiction'],
      ...overrides,
    }),
  };
}

function createMockRAGAdapter(overrides?: Partial<RAGCaseHistoryResult>): AMLRAGAdapter {
  return {
    retrieveCaseHistory: vi.fn().mockResolvedValue({
      success: true,
      chunks: [
        {
          chunkId: 'chunk-001',
          content: 'Customer opened account on 2024-01-15. Multiple large deposits observed.',
          source: {
            documentName: 'Case History Report',
            section: 'Account Activity',
            publicationDate: '2024-06-01T00:00:00Z',
          },
          relevanceScore: 0.95,
        },
        {
          chunkId: 'chunk-002',
          content: 'KYC review identified address mismatch on 2024-02-10.',
          source: {
            documentName: 'KYC Records',
            section: 'Verification',
            publicationDate: '2024-02-10T00:00:00Z',
          },
          relevanceScore: 0.88,
        },
      ],
      unavailableSources: [],
      retrievalLatencyMs: 150,
      ...overrides,
    }),
  };
}

function createMockNarrativeGenerator(
  overrides?: Partial<NarrativeResult>
): AMLNarrativeGeneratorAdapter {
  return {
    generateNarrative: vi.fn().mockResolvedValue({
      narrative:
        'The subject entity opened an account on 2024-01-15 and proceeded to make multiple large cash deposits totalling INR 1,500,000 within the first 30 days. KYC verification revealed an address mismatch on 2024-02-10.',
      groundednessScore: 0.85,
      ...overrides,
    }),
  };
}

function createMockAuditEmitter(): AMLAuditEmitter {
  return {
    emit: vi.fn().mockResolvedValue('audit-artefact-001'),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AMLTriageService', () => {
  let classificationModel: AMLClassificationModelAdapter;
  let ragAdapter: AMLRAGAdapter;
  let narrativeGenerator: AMLNarrativeGeneratorAdapter;
  let auditEmitter: AMLAuditEmitter;
  let service: AMLTriageService;

  beforeEach(() => {
    classificationModel = createMockClassificationModel();
    ragAdapter = createMockRAGAdapter();
    narrativeGenerator = createMockNarrativeGenerator();
    auditEmitter = createMockAuditEmitter();
    service = new AMLTriageService(
      classificationModel,
      ragAdapter,
      narrativeGenerator,
      auditEmitter
    );
  });

  // ─── Alert Triage (Requirement 3.1) ─────────────────────────────────────

  describe('triageAlert', () => {
    it('should classify alert as ESCALATE_L2 with priority and reasoning', async () => {
      const request = createMockTriageRequest();
      const response = await service.triageAlert(request);

      expect(response.alertId).toBe('alert-001');
      expect(response.disposition).toBe('ESCALATE_L2');
      expect(response.priorityScore).toBe(85);
      expect(response.confidence).toBe(0.92);
      expect(response.reasoningSummary).toContain('ESCALATE_L2');
      expect(response.reasoningSummary).toContain('85/100');
      expect(response.auditArtefactId).toBe('audit-artefact-001');
    });

    it('should classify alert as RECOMMEND_CLOSURE', async () => {
      classificationModel = createMockClassificationModel({
        disposition: 'RECOMMEND_CLOSURE',
        priorityScore: 15,
        confidence: 0.88,
        reasoningFactors: ['Low risk indicators', 'Known customer'],
      });
      service = new AMLTriageService(
        classificationModel,
        ragAdapter,
        narrativeGenerator,
        auditEmitter
      );

      const response = await service.triageAlert(createMockTriageRequest());

      expect(response.disposition).toBe('RECOMMEND_CLOSURE');
      expect(response.priorityScore).toBe(15);
    });

    it('should classify alert as INVESTIGATE', async () => {
      classificationModel = createMockClassificationModel({
        disposition: 'INVESTIGATE',
        priorityScore: 55,
        confidence: 0.72,
        reasoningFactors: ['Mixed signals', 'Needs further review'],
      });
      service = new AMLTriageService(
        classificationModel,
        ragAdapter,
        narrativeGenerator,
        auditEmitter
      );

      const response = await service.triageAlert(createMockTriageRequest());

      expect(response.disposition).toBe('INVESTIGATE');
      expect(response.priorityScore).toBe(55);
    });

    it('should clamp priority score to [1, 100]', async () => {
      classificationModel = createMockClassificationModel({ priorityScore: 150 });
      service = new AMLTriageService(
        classificationModel,
        ragAdapter,
        narrativeGenerator,
        auditEmitter
      );

      const response = await service.triageAlert(createMockTriageRequest());
      expect(response.priorityScore).toBe(100);
    });

    it('should clamp priority score minimum to 1', async () => {
      classificationModel = createMockClassificationModel({ priorityScore: -5 });
      service = new AMLTriageService(
        classificationModel,
        ragAdapter,
        narrativeGenerator,
        auditEmitter
      );

      const response = await service.triageAlert(createMockTriageRequest());
      expect(response.priorityScore).toBe(1);
    });

    it('should clamp confidence to [0.00, 1.00]', async () => {
      classificationModel = createMockClassificationModel({ confidence: 1.5 });
      service = new AMLTriageService(
        classificationModel,
        ragAdapter,
        narrativeGenerator,
        auditEmitter
      );

      const response = await service.triageAlert(createMockTriageRequest());
      expect(response.confidence).toBe(1.0);
    });

    it('should generate reasoning summary from factors', async () => {
      const response = await service.triageAlert(createMockTriageRequest());

      expect(response.reasoningSummary).toContain('Large cash deposit');
      expect(response.reasoningSummary).toContain('New account');
      expect(response.reasoningSummary).toContain('High-risk jurisdiction');
    });

    it('should emit audit artefact with all required fields', async () => {
      await service.triageAlert(createMockTriageRequest());

      expect(auditEmitter.emit).toHaveBeenCalledTimes(1);
      const artefact = (auditEmitter.emit as any).mock.calls[0][0];

      expect(artefact.serviceId).toBe('aml-triage-service');
      expect(artefact.timestamp).toBeDefined();
      expect(artefact.jurisdiction).toBe('IN');
      expect(artefact.modelVersion).toBe('1.0.0');
      expect(artefact.inputFeatures).toHaveProperty('alertId', 'alert-001');
      expect(artefact.inputFeatures).toHaveProperty('alertType', 'TRANSACTION_MONITORING');
      expect(artefact.inputFeatures).toHaveProperty('entityId', 'entity-001');
      expect(artefact.modelOutput).toHaveProperty('disposition', 'ESCALATE_L2');
      expect(artefact.modelOutput).toHaveProperty('priorityScore', 85);
      expect(artefact.confidenceScore).toBe(0.92);
      expect(artefact.decision).toBe('ESCALATE_L2');
    });

    it('should throw error for missing alertId', async () => {
      await expect(
        service.triageAlert(createMockTriageRequest({ alertId: '' }))
      ).rejects.toThrow('alertId is required');
    });

    it('should throw error for missing entityId', async () => {
      await expect(
        service.triageAlert(createMockTriageRequest({ entityId: '' }))
      ).rejects.toThrow('entityId is required');
    });

    it('should throw error for missing jurisdiction', async () => {
      await expect(
        service.triageAlert(createMockTriageRequest({ jurisdiction: '' as any }))
      ).rejects.toThrow('jurisdiction is required');
    });
  });

  // ─── Narrative Generation (Requirements 3.2, 3.7, 3.8, 3.9) ────────────

  describe('generateNarrative', () => {
    it('should generate investigation narrative using RAG over case history', async () => {
      const response = await service.generateNarrative(createMockNarrativeRequest());

      expect(response.caseId).toBe('case-001');
      expect(response.narrative).toContain('2024-01-15');
      expect(response.groundednessScore).toBe(0.85);
      expect(response.auditArtefactId).toBe('audit-artefact-001');
    });

    it('should provide source citations from RAG chunks (Requirement 3.7)', async () => {
      const response = await service.generateNarrative(createMockNarrativeRequest());

      expect(response.citations).toHaveLength(2);
      expect(response.citations[0]).toEqual({
        documentName: 'Case History Report',
        section: 'Account Activity',
        publicationDate: '2024-06-01T00:00:00Z',
        relevanceScore: 0.95,
        chunkId: 'chunk-001',
      });
      expect(response.citations[1]).toEqual({
        documentName: 'KYC Records',
        section: 'Verification',
        publicationDate: '2024-02-10T00:00:00Z',
        relevanceScore: 0.88,
        chunkId: 'chunk-002',
      });
    });

    it('should flag low-confidence content when groundedness is below threshold (Requirement 3.8)', async () => {
      narrativeGenerator = createMockNarrativeGenerator({ groundednessScore: 0.55 });
      service = new AMLTriageService(
        classificationModel,
        ragAdapter,
        narrativeGenerator,
        auditEmitter
      );

      const response = await service.generateNarrative(createMockNarrativeRequest());

      expect(response.lowConfidenceFlag).toBe(true);
      expect(response.requiresHumanApproval).toBe(true);
    });

    it('should not flag when groundedness is above threshold', async () => {
      const response = await service.generateNarrative(createMockNarrativeRequest());

      expect(response.lowConfidenceFlag).toBe(false);
    });

    it('should always require human approval for SAR drafts (Requirement 3.5)', async () => {
      narrativeGenerator = createMockNarrativeGenerator({ groundednessScore: 0.99 });
      service = new AMLTriageService(
        classificationModel,
        ragAdapter,
        narrativeGenerator,
        auditEmitter
      );

      const response = await service.generateNarrative(
        createMockNarrativeRequest({ scope: 'SAR_DRAFT' })
      );

      expect(response.requiresHumanApproval).toBe(true);
    });

    it('should report data source status when sources are unavailable (Requirement 3.9)', async () => {
      ragAdapter = createMockRAGAdapter({
        success: true,
        unavailableSources: ['KYC System', 'Transaction Archive'],
      });
      service = new AMLTriageService(
        classificationModel,
        ragAdapter,
        narrativeGenerator,
        auditEmitter
      );

      const response = await service.generateNarrative(createMockNarrativeRequest());

      expect(response.dataSourceStatus.allSourcesAvailable).toBe(false);
      expect(response.dataSourceStatus.unavailableSources).toEqual([
        'KYC System',
        'Transaction Archive',
      ]);
    });

    it('should report all sources available when no issues', async () => {
      const response = await service.generateNarrative(createMockNarrativeRequest());

      expect(response.dataSourceStatus.allSourcesAvailable).toBe(true);
      expect(response.dataSourceStatus.unavailableSources).toHaveLength(0);
    });

    it('should emit audit artefact with full prompt and context (Requirement 3.6)', async () => {
      await service.generateNarrative(createMockNarrativeRequest());

      expect(auditEmitter.emit).toHaveBeenCalledTimes(1);
      const artefact = (auditEmitter.emit as any).mock.calls[0][0];

      expect(artefact.serviceId).toBe('aml-triage-service');
      expect(artefact.jurisdiction).toBe('IN');
      expect(artefact.prompt).toBeDefined();
      expect(artefact.prompt).toContain('case-001');
      expect(artefact.retrievedContext).toHaveLength(2);
      expect(artefact.retrievedContext[0].chunkId).toBe('chunk-001');
      expect(artefact.modelOutput).toHaveProperty('narrative');
      expect(artefact.modelOutput).toHaveProperty('groundednessScore', 0.85);
      expect(artefact.contextPayload).toHaveProperty('dataSourceStatus');
      expect(artefact.contextPayload).toHaveProperty('generationTimeMs');
    });

    it('should call RAG adapter with correct tenant and jurisdiction', async () => {
      await service.generateNarrative(createMockNarrativeRequest());

      expect(ragAdapter.retrieveCaseHistory).toHaveBeenCalledWith(
        'case-001',
        'aml-default',
        'IN'
      );
    });

    it('should throw error when narrative generation exceeds timeout', async () => {
      const slowNarrativeGenerator: AMLNarrativeGeneratorAdapter = {
        generateNarrative: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ narrative: 'late', groundednessScore: 0.9 }), 200))
        ),
      };
      service = new AMLTriageService(
        classificationModel,
        ragAdapter,
        slowNarrativeGenerator,
        auditEmitter,
        { narrativeTimeoutMs: 50 } // Very short timeout
      );

      // The timeout check happens after awaiting, so it depends on implementation
      // This tests the timeout mechanism is present
      await expect(
        service.generateNarrative(createMockNarrativeRequest())
      ).rejects.toThrow(/timed out/);
    });

    it('should throw error for missing caseId', async () => {
      await expect(
        service.generateNarrative(createMockNarrativeRequest({ caseId: '' }))
      ).rejects.toThrow('caseId is required');
    });

    it('should throw error for missing analystId', async () => {
      await expect(
        service.generateNarrative(createMockNarrativeRequest({ analystId: '' }))
      ).rejects.toThrow('analystId is required');
    });
  });

  // ─── SAR Filing with HITL Enforcement (Requirements 3.3, 3.5, 3.6) ─────

  describe('fileSAR', () => {
    it('should file SAR when analyst approval is granted (Requirement 3.5)', async () => {
      const response = await service.fileSAR(createMockSARRequest());

      expect(response.caseId).toBe('case-001');
      expect(response.filed).toBe(true);
      expect(response.filingTimestamp).toBeDefined();
      expect(response.auditArtefactId).toBe('audit-artefact-001');
      expect(response.rejectionReason).toBeUndefined();
    });

    it('should REJECT SAR when analyst approval is NOT granted (HITL enforcement)', async () => {
      const response = await service.fileSAR(
        createMockSARRequest({ analystApproval: false })
      );

      expect(response.caseId).toBe('case-001');
      expect(response.filed).toBe(false);
      expect(response.rejectionReason).toContain('explicit analyst approval');
      expect(response.filingTimestamp).toBeUndefined();
      expect(response.auditArtefactId).toBe('audit-artefact-001');
    });

    it('should emit audit artefact with analyst decision for approved SAR', async () => {
      await service.fileSAR(createMockSARRequest());

      expect(auditEmitter.emit).toHaveBeenCalledTimes(1);
      const artefact = (auditEmitter.emit as any).mock.calls[0][0];

      expect(artefact.decision).toBe('SAR_FILED');
      expect(artefact.analystDecision).toBe('APPROVED');
      expect(artefact.inputFeatures.caseId).toBe('case-001');
      expect(artefact.inputFeatures.analystId).toBe('analyst-001');
      expect(artefact.contextPayload.analystApproval).toBe(true);
    });

    it('should emit audit artefact for rejected SAR (no approval)', async () => {
      await service.fileSAR(createMockSARRequest({ analystApproval: false }));

      expect(auditEmitter.emit).toHaveBeenCalledTimes(1);
      const artefact = (auditEmitter.emit as any).mock.calls[0][0];

      expect(artefact.decision).toBe('REJECTED_NO_APPROVAL');
      expect(artefact.analystDecision).toBe('NOT_APPROVED');
    });

    it('should include data gap acknowledgement in audit artefact', async () => {
      await service.fileSAR(
        createMockSARRequest({ dataGapAcknowledgement: true })
      );

      const artefact = (auditEmitter.emit as any).mock.calls[0][0];
      expect(artefact.inputFeatures.dataGapAcknowledgement).toBe(true);
      expect(artefact.contextPayload.dataGapAcknowledgement).toBe(true);
    });

    it('should throw error for missing caseId', async () => {
      await expect(
        service.fileSAR(createMockSARRequest({ caseId: '' }))
      ).rejects.toThrow('caseId is required');
    });

    it('should throw error for missing analystId', async () => {
      await expect(
        service.fileSAR(createMockSARRequest({ analystId: '' }))
      ).rejects.toThrow('analystId is required');
    });

    it('should throw error for missing narrativeId', async () => {
      await expect(
        service.fileSAR(createMockSARRequest({ narrativeId: '' }))
      ).rejects.toThrow('narrativeId is required');
    });
  });

  // ─── Configuration ──────────────────────────────────────────────────────

  describe('configuration', () => {
    it('should use default config when none provided', () => {
      const config = service.getConfig();

      expect(config.serviceId).toBe('aml-triage-service');
      expect(config.modelVersion).toBe('1.0.0');
      expect(config.groundednessThreshold).toBe(0.70);
      expect(config.narrativeTimeoutMs).toBe(60_000);
      expect(config.tenantId).toBe('aml-default');
    });

    it('should merge custom config with defaults', () => {
      const customService = new AMLTriageService(
        classificationModel,
        ragAdapter,
        narrativeGenerator,
        auditEmitter,
        { serviceId: 'custom-aml-service', groundednessThreshold: 0.80 }
      );

      const config = customService.getConfig();
      expect(config.serviceId).toBe('custom-aml-service');
      expect(config.groundednessThreshold).toBe(0.80);
      expect(config.modelVersion).toBe('1.0.0'); // Default preserved
    });
  });
});
