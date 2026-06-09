import { describe, it, expect, beforeEach } from 'vitest';
import { DoraResilienceService, getRtoForTier, getRpoForTier } from './dora-resilience-service.js';
import type {
  IctRiskRegisterEntry,
  ExitStrategy,
  RecoveryRunbook,
  CriticalityTier,
} from './types.js';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createRiskEntry(overrides: Partial<IctRiskRegisterEntry> = {}): IctRiskRegisterEntry {
  return {
    entryId: 'risk-001',
    serviceId: 'fraud-inference-service',
    serviceName: 'Fraud Inference Service',
    criticalityTier: 'CRITICAL',
    status: 'OPERATIONAL',
    jurisdictions: ['UK', 'EU'],
    impactAssessment: {
      businessImpact: 'SEVERE',
      affectedCustomersEstimate: 41_000_000,
      revenueImpactPerHourUsd: 500_000,
      regulatoryImpact: 'FCA/PRA enforcement action possible',
      downstreamDependencies: ['audit-service', 'streaming-backbone'],
    },
    vendorDependencies: [
      {
        vendorName: 'AWS',
        category: 'CLOUD_PROVIDER',
        isSinglePointOfFailure: false,
      },
      {
        vendorName: 'GCP',
        category: 'CLOUD_PROVIDER',
        isSinglePointOfFailure: false,
      },
    ],
    recoveryPriority: 1,
    rtoMinutes: 5,
    rpoMinutes: 1,
    runbookId: 'runbook-fraud-001',
    lastReviewDate: '2024-01-15T00:00:00Z',
    nextReviewDate: '2024-04-15T00:00:00Z',
    reviewFrequency: 'QUARTERLY',
    mitigations: ['Multi-region active-active deployment', 'Fallback to rules engine'],
    residualRiskNotes: 'Minimal residual risk with multi-vendor cloud strategy',
    ...overrides,
  };
}

function createExitStrategy(overrides: Partial<ExitStrategy> = {}): ExitStrategy {
  return {
    strategyId: 'exit-cloud-001',
    vendorName: 'AWS',
    category: 'CLOUD_PROVIDER',
    targetVendors: ['GCP', 'Azure'],
    affectedServices: ['fraud-inference-service', 'aml-triage-service'],
    maxExecutionDays: 75,
    steps: [
      {
        stepNumber: 1,
        description: 'Provision target infrastructure on GCP',
        estimatedDurationDays: 14,
        responsibleTeam: 'Platform Engineering',
        dependencies: [],
        tested: true,
      },
      {
        stepNumber: 2,
        description: 'Migrate stateless services',
        estimatedDurationDays: 21,
        responsibleTeam: 'Service Teams',
        dependencies: [1],
        tested: true,
      },
      {
        stepNumber: 3,
        description: 'Migrate data stores and verify integrity',
        estimatedDurationDays: 30,
        responsibleTeam: 'Data Engineering',
        dependencies: [1],
        tested: false,
      },
      {
        stepNumber: 4,
        description: 'Traffic cutover and validation',
        estimatedDurationDays: 7,
        responsibleTeam: 'SRE',
        dependencies: [2, 3],
        tested: false,
      },
    ],
    estimatedCostUsd: 2_500_000,
    exitRisks: ['Data migration may exceed RPO during cutover'],
    status: 'TESTED',
    lastTestDate: '2024-03-01T00:00:00Z',
    nextTestDate: '2025-03-01T00:00:00Z',
    executableWithin90Days: true,
    createdDate: '2023-06-01T00:00:00Z',
    lastUpdatedDate: '2024-03-01T00:00:00Z',
    ...overrides,
  };
}

function createRunbook(overrides: Partial<RecoveryRunbook> = {}): RecoveryRunbook {
  return {
    runbookId: 'runbook-fraud-001',
    serviceId: 'fraud-inference-service',
    serviceName: 'Fraud Inference Service',
    criticalityTier: 'CRITICAL',
    rtoMinutes: 5,
    rpoMinutes: 1,
    steps: [
      {
        stepNumber: 1,
        title: 'Detect failure via health checks',
        instructions: 'Automated: Health check failure triggers alert',
        expectedDurationMinutes: 1,
        executionType: 'AUTOMATED',
        verificationCriteria: 'Alert received by on-call SRE',
        rollbackInstructions: 'N/A - detection step',
      },
      {
        stepNumber: 2,
        title: 'Failover to secondary region',
        instructions: 'Automated: Traffic routing switches to DR region',
        expectedDurationMinutes: 2,
        executionType: 'AUTOMATED',
        verificationCriteria: 'Traffic flowing to DR region, latency within SLA',
        rollbackInstructions: 'Revert DNS/routing to primary',
      },
      {
        stepNumber: 3,
        title: 'Verify service health in DR',
        instructions: 'Manual: Verify inference responses within 100ms p99',
        expectedDurationMinutes: 2,
        executionType: 'MANUAL',
        verificationCriteria: 'p99 < 100ms, error rate < 0.1%',
        rollbackInstructions: 'Escalate to Tier 2 if DR unhealthy',
      },
    ],
    estimatedRecoveryMinutes: 5,
    prerequisites: ['DR region warm and receiving replication', 'Health checks configured'],
    escalationContacts: [
      { role: 'On-Call SRE', contactId: 'sre-oncall', escalationLevel: 1 },
      { role: 'Service Owner', contactId: 'fraud-team-lead', escalationLevel: 2 },
    ],
    lastTestDate: '2024-02-15T00:00:00Z',
    lastTestStatus: 'PASSED',
    testFrequency: 'SEMI_ANNUALLY',
    nextTestDate: '2024-08-15T00:00:00Z',
    version: '2.1',
    lastUpdatedDate: '2024-02-15T00:00:00Z',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DoraResilienceService', () => {
  let service: DoraResilienceService;

  beforeEach(() => {
    service = new DoraResilienceService();
  });

  // ── Risk Register (Req 30.1) ────────────────────────────────────────────

  describe('ICT Risk Register (Req 30.1)', () => {
    it('should add and retrieve risk register entries', () => {
      const entry = createRiskEntry();
      service.addRiskEntry(entry);

      const retrieved = service.getRiskEntry('risk-001');
      expect(retrieved).toEqual(entry);
    });

    it('should return all risk register entries', () => {
      service.addRiskEntry(createRiskEntry({ entryId: 'risk-001', serviceId: 'svc-1' }));
      service.addRiskEntry(createRiskEntry({ entryId: 'risk-002', serviceId: 'svc-2' }));
      service.addRiskEntry(createRiskEntry({ entryId: 'risk-003', serviceId: 'svc-3' }));

      expect(service.getAllRiskEntries()).toHaveLength(3);
    });

    it('should filter entries by jurisdiction', () => {
      service.addRiskEntry(createRiskEntry({ entryId: 'risk-uk', jurisdictions: ['UK'] }));
      service.addRiskEntry(createRiskEntry({ entryId: 'risk-eu', jurisdictions: ['EU'] }));
      service.addRiskEntry(createRiskEntry({ entryId: 'risk-both', jurisdictions: ['UK', 'EU'] }));

      const ukEntries = service.getRiskEntriesByJurisdiction('UK');
      expect(ukEntries).toHaveLength(2);
      expect(ukEntries.map((e) => e.entryId)).toContain('risk-uk');
      expect(ukEntries.map((e) => e.entryId)).toContain('risk-both');
    });

    it('should filter entries by criticality tier', () => {
      service.addRiskEntry(createRiskEntry({ entryId: 'risk-crit', criticalityTier: 'CRITICAL' }));
      service.addRiskEntry(createRiskEntry({ entryId: 'risk-high', criticalityTier: 'HIGH' }));
      service.addRiskEntry(createRiskEntry({ entryId: 'risk-med', criticalityTier: 'MEDIUM' }));

      const criticalEntries = service.getRiskEntriesByTier('CRITICAL');
      expect(criticalEntries).toHaveLength(1);
      expect(criticalEntries[0].entryId).toBe('risk-crit');
    });

    it('should detect overdue reviews', () => {
      const entry = createRiskEntry({ nextReviewDate: '2024-04-15T00:00:00Z' });
      service.addRiskEntry(entry);

      // 8 days after next review (7 day grace period exceeded)
      expect(service.isReviewOverdue(entry, '2024-04-23T00:00:00Z')).toBe(true);
      // Exactly on next review date (not overdue)
      expect(service.isReviewOverdue(entry, '2024-04-15T00:00:00Z')).toBe(false);
      // Within grace period
      expect(service.isReviewOverdue(entry, '2024-04-20T00:00:00Z')).toBe(false);
    });

    it('should return entries with overdue reviews', () => {
      service.addRiskEntry(createRiskEntry({
        entryId: 'risk-overdue',
        nextReviewDate: '2024-01-01T00:00:00Z',
      }));
      service.addRiskEntry(createRiskEntry({
        entryId: 'risk-current',
        nextReviewDate: '2024-12-01T00:00:00Z',
      }));

      const overdue = service.getOverdueReviews('2024-06-01T00:00:00Z');
      expect(overdue).toHaveLength(1);
      expect(overdue[0].entryId).toBe('risk-overdue');
    });
  });

  // ── Exit Strategy (Req 30.2, 30.3) ─────────────────────────────────────

  describe('Exit Strategy (Req 30.2, 30.3)', () => {
    it('should add and retrieve exit strategies', () => {
      const strategy = createExitStrategy();
      service.addExitStrategy(strategy);

      const retrieved = service.getExitStrategy('exit-cloud-001');
      expect(retrieved).toEqual(strategy);
    });

    it('should validate exit strategy is executable within 90 days', () => {
      const strategy = createExitStrategy({ maxExecutionDays: 75 });
      service.addExitStrategy(strategy);

      const result = service.validateExitStrategy(strategy);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should reject exit strategy exceeding 90 days', () => {
      const strategy = createExitStrategy({ maxExecutionDays: 120 });

      const result = service.validateExitStrategy(strategy);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain(
        'Exit strategy exceeds 90-day limit: 120 days'
      );
    });

    it('should reject exit strategy with critical path exceeding 90 days', () => {
      const strategy = createExitStrategy({
        maxExecutionDays: 85,
        steps: [
          {
            stepNumber: 1,
            description: 'Phase 1',
            estimatedDurationDays: 50,
            responsibleTeam: 'Team A',
            dependencies: [],
            tested: false,
          },
          {
            stepNumber: 2,
            description: 'Phase 2',
            estimatedDurationDays: 50,
            responsibleTeam: 'Team B',
            dependencies: [1],
            tested: false,
          },
        ],
      });

      const result = service.validateExitStrategy(strategy);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('Critical path duration'))).toBe(true);
    });

    it('should calculate critical path correctly with parallel steps', () => {
      const strategy = createExitStrategy({
        steps: [
          { stepNumber: 1, description: 'Setup', estimatedDurationDays: 10, responsibleTeam: 'A', dependencies: [], tested: true },
          { stepNumber: 2, description: 'Parallel A', estimatedDurationDays: 20, responsibleTeam: 'B', dependencies: [1], tested: true },
          { stepNumber: 3, description: 'Parallel B', estimatedDurationDays: 30, responsibleTeam: 'C', dependencies: [1], tested: true },
          { stepNumber: 4, description: 'Merge', estimatedDurationDays: 5, responsibleTeam: 'D', dependencies: [2, 3], tested: true },
        ],
      });

      // Critical path: 1 (10) → 3 (30) → 4 (5) = 45 days
      const criticalPath = service.calculateCriticalPath(strategy);
      expect(criticalPath).toBe(45);
    });

    it('should flag exit strategy with missing responsible teams', () => {
      const strategy = createExitStrategy({
        steps: [
          { stepNumber: 1, description: 'Step', estimatedDurationDays: 5, responsibleTeam: '', dependencies: [], tested: false },
        ],
      });

      const result = service.validateExitStrategy(strategy);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('missing responsible team'))).toBe(true);
    });

    it('should flag exit strategy with no target vendors', () => {
      const strategy = createExitStrategy({ targetVendors: [] });

      const result = service.validateExitStrategy(strategy);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('No target vendors'))).toBe(true);
    });

    it('should flag exit strategy with no affected services', () => {
      const strategy = createExitStrategy({ affectedServices: [] });

      const result = service.validateExitStrategy(strategy);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('No affected services'))).toBe(true);
    });
  });

  // ── Recovery Runbooks (Req 30.4) ───────────────────────────────────────

  describe('Recovery Runbooks (Req 30.4)', () => {
    it('should add and retrieve runbooks', () => {
      const runbook = createRunbook();
      service.addRunbook(runbook);

      const retrieved = service.getRunbook('runbook-fraud-001');
      expect(retrieved).toEqual(runbook);
    });

    it('should filter runbooks by criticality tier', () => {
      service.addRunbook(createRunbook({ runbookId: 'rb-1', criticalityTier: 'CRITICAL' }));
      service.addRunbook(createRunbook({ runbookId: 'rb-2', criticalityTier: 'HIGH' }));
      service.addRunbook(createRunbook({ runbookId: 'rb-3', criticalityTier: 'CRITICAL' }));

      const critical = service.getRunbooksByTier('CRITICAL');
      expect(critical).toHaveLength(2);
    });

    it('should validate runbook RTO compliance for CRITICAL tier', () => {
      const runbook = createRunbook({
        criticalityTier: 'CRITICAL',
        estimatedRecoveryMinutes: 5,
      });

      const result = service.validateRunbookRto(runbook);
      expect(result.valid).toBe(true);
      expect(result.targetRtoMinutes).toBe(5);
    });

    it('should detect runbook RTO violation', () => {
      const runbook = createRunbook({
        criticalityTier: 'CRITICAL',
        estimatedRecoveryMinutes: 10, // exceeds CRITICAL RTO of 5min
      });

      const result = service.validateRunbookRto(runbook);
      expect(result.valid).toBe(false);
      expect(result.targetRtoMinutes).toBe(5);
      expect(result.estimatedMinutes).toBe(10);
    });

    it('should validate RTO for all tiers', () => {
      const tiers: Array<{ tier: CriticalityTier; rto: number }> = [
        { tier: 'CRITICAL', rto: 5 },
        { tier: 'HIGH', rto: 30 },
        { tier: 'MEDIUM', rto: 120 },
        { tier: 'LOW', rto: 480 },
      ];

      for (const { tier, rto } of tiers) {
        const runbook = createRunbook({
          runbookId: `rb-${tier}`,
          criticalityTier: tier,
          estimatedRecoveryMinutes: rto,
        });
        const result = service.validateRunbookRto(runbook);
        expect(result.valid).toBe(true);
        expect(result.targetRtoMinutes).toBe(rto);
      }
    });

    it('should detect overdue runbook tests', () => {
      service.addRunbook(createRunbook({
        runbookId: 'rb-overdue',
        nextTestDate: '2024-01-01T00:00:00Z',
      }));
      service.addRunbook(createRunbook({
        runbookId: 'rb-current',
        nextTestDate: '2024-12-01T00:00:00Z',
      }));

      const overdue = service.getOverdueRunbookTests('2024-06-01T00:00:00Z');
      expect(overdue).toHaveLength(1);
      expect(overdue[0].runbookId).toBe('rb-overdue');
    });

    it('should flag runbook with no test date as overdue', () => {
      const runbook = createRunbook({ nextTestDate: undefined });
      expect(service.isRunbookTestOverdue(runbook, '2024-06-01T00:00:00Z')).toBe(true);
    });
  });

  // ── Concentration Risk (Req 30.2) ─────────────────────────────────────

  describe('Concentration Risk Assessment (Req 30.2)', () => {
    it('should identify no concentration risk when multiple vendors exist', () => {
      service.addRiskEntry(createRiskEntry({
        entryId: 'risk-001',
        vendorDependencies: [
          { vendorName: 'AWS', category: 'CLOUD_PROVIDER', isSinglePointOfFailure: false },
          { vendorName: 'GCP', category: 'CLOUD_PROVIDER', isSinglePointOfFailure: false },
        ],
      }));

      const assessments = service.assessConcentrationRisk();
      expect(assessments).toHaveLength(1);
      expect(assessments[0].hasSinglePointOfFailure).toBe(false);
      expect(assessments[0].compliant).toBe(true);
    });

    it('should identify concentration risk with single vendor SPOF', () => {
      service.addRiskEntry(createRiskEntry({
        entryId: 'risk-001',
        vendorDependencies: [
          { vendorName: 'Pinecone', category: 'VECTOR_DB', isSinglePointOfFailure: true },
        ],
      }));

      const assessments = service.assessConcentrationRisk();
      const vectorAssessment = assessments.find((a) => a.category === 'VECTOR_DB');
      expect(vectorAssessment).toBeDefined();
      expect(vectorAssessment!.hasSinglePointOfFailure).toBe(true);
      expect(vectorAssessment!.compliant).toBe(false);
    });

    it('should mark SPOF as compliant when exit strategy is tested', () => {
      service.addRiskEntry(createRiskEntry({
        entryId: 'risk-001',
        vendorDependencies: [
          { vendorName: 'Pinecone', category: 'VECTOR_DB', isSinglePointOfFailure: true, exitStrategyId: 'exit-vec-001' },
        ],
      }));
      service.addExitStrategy(createExitStrategy({
        strategyId: 'exit-vec-001',
        vendorName: 'Pinecone',
        category: 'VECTOR_DB',
        status: 'TESTED',
      }));

      const assessments = service.assessConcentrationRisk();
      const vectorAssessment = assessments.find((a) => a.category === 'VECTOR_DB');
      expect(vectorAssessment!.compliant).toBe(true);
    });

    it('should mark SPOF as non-compliant when exit strategy exists but is not tested', () => {
      service.addRiskEntry(createRiskEntry({
        entryId: 'risk-001',
        vendorDependencies: [
          { vendorName: 'Pinecone', category: 'VECTOR_DB', isSinglePointOfFailure: true },
        ],
      }));
      service.addExitStrategy(createExitStrategy({
        strategyId: 'exit-vec-001',
        vendorName: 'Pinecone',
        category: 'VECTOR_DB',
        status: 'DOCUMENTED', // not tested
      }));

      const assessments = service.assessConcentrationRisk();
      const vectorAssessment = assessments.find((a) => a.category === 'VECTOR_DB');
      expect(vectorAssessment!.compliant).toBe(false);
    });
  });

  // ── Full Compliance Validation ────────────────────────────────────────

  describe('DORA Compliance Validation', () => {
    it('should return non-compliant when risk register is empty', () => {
      const result = service.validateCompliance('2024-06-01T00:00:00Z');
      expect(result.compliant).toBe(false);
      expect(result.findings.some((f) => f.description.includes('risk register is empty'))).toBe(true);
    });

    it('should return non-compliant when exit strategies are missing', () => {
      service.addRiskEntry(createRiskEntry());
      service.addRunbook(createRunbook());

      const result = service.validateCompliance('2024-06-01T00:00:00Z');
      expect(result.compliant).toBe(false);
      expect(result.requirements.find((r) => r.requirementId === '30.3')?.compliant).toBe(false);
    });

    it('should return compliant when all requirements are satisfied', () => {
      // Add risk entry with no SPOF
      service.addRiskEntry(createRiskEntry({
        entryId: 'risk-001',
        serviceId: 'fraud-inference-service',
        nextReviewDate: '2024-12-01T00:00:00Z',
        vendorDependencies: [
          { vendorName: 'AWS', category: 'CLOUD_PROVIDER', isSinglePointOfFailure: false },
          { vendorName: 'GCP', category: 'CLOUD_PROVIDER', isSinglePointOfFailure: false },
        ],
      }));

      // Add tested exit strategy
      service.addExitStrategy(createExitStrategy({
        strategyId: 'exit-001',
        status: 'TESTED',
        lastTestDate: '2024-03-01T00:00:00Z',
      }));

      // Add passing runbook
      service.addRunbook(createRunbook({
        runbookId: 'runbook-fraud-001',
        serviceId: 'fraud-inference-service',
        lastTestStatus: 'PASSED',
        nextTestDate: '2024-12-01T00:00:00Z',
      }));

      const result = service.validateCompliance('2024-06-01T00:00:00Z');
      expect(result.compliant).toBe(true);
      expect(result.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')).toHaveLength(0);
    });

    it('should detect services without runbooks', () => {
      service.addRiskEntry(createRiskEntry({
        entryId: 'risk-001',
        serviceId: 'aml-triage-service',
        nextReviewDate: '2024-12-01T00:00:00Z',
      }));
      // No runbook for aml-triage-service
      service.addExitStrategy(createExitStrategy({ status: 'TESTED', lastTestDate: '2024-03-01T00:00:00Z' }));

      const result = service.validateCompliance('2024-06-01T00:00:00Z');
      const req304 = result.requirements.find((r) => r.requirementId === '30.4');
      expect(req304?.compliant).toBe(false);
    });

    it('should detect untested exit strategies', () => {
      service.addRiskEntry(createRiskEntry({ nextReviewDate: '2024-12-01T00:00:00Z' }));
      service.addExitStrategy(createExitStrategy({
        status: 'DOCUMENTED',
        lastTestDate: undefined,
      }));
      service.addRunbook(createRunbook({ lastTestStatus: 'PASSED', nextTestDate: '2024-12-01T00:00:00Z' }));

      const result = service.validateCompliance('2024-06-01T00:00:00Z');
      const req303 = result.requirements.find((r) => r.requirementId === '30.3');
      expect(req303?.compliant).toBe(false);
    });

    it('should detect exit strategies not tested within annual cycle', () => {
      service.addRiskEntry(createRiskEntry({ nextReviewDate: '2024-12-01T00:00:00Z' }));
      service.addExitStrategy(createExitStrategy({
        status: 'TESTED',
        lastTestDate: '2022-01-01T00:00:00Z', // over a year ago
      }));
      service.addRunbook(createRunbook({ lastTestStatus: 'PASSED', nextTestDate: '2024-12-01T00:00:00Z' }));

      const result = service.validateCompliance('2024-06-01T00:00:00Z');
      const req303 = result.requirements.find((r) => r.requirementId === '30.3');
      expect(req303?.compliant).toBe(false);
    });

    it('should include validation timestamp', () => {
      const result = service.validateCompliance('2024-06-15T10:30:00Z');
      expect(result.validatedAt).toBe('2024-06-15T10:30:00Z');
    });

    it('should report all four requirements', () => {
      const result = service.validateCompliance('2024-06-01T00:00:00Z');
      expect(result.requirements).toHaveLength(4);
      expect(result.requirements.map((r) => r.requirementId).sort()).toEqual([
        '30.1', '30.2', '30.3', '30.4',
      ]);
    });
  });

  // ── Helper Functions ──────────────────────────────────────────────────

  describe('Helper Functions', () => {
    it('should return correct RTO for each tier', () => {
      expect(getRtoForTier('CRITICAL')).toBe(5);
      expect(getRtoForTier('HIGH')).toBe(30);
      expect(getRtoForTier('MEDIUM')).toBe(120);
      expect(getRtoForTier('LOW')).toBe(480);
    });

    it('should return correct RPO for each tier', () => {
      expect(getRpoForTier('CRITICAL')).toBe(1);
      expect(getRpoForTier('HIGH')).toBe(15);
      expect(getRpoForTier('MEDIUM')).toBe(60);
      expect(getRpoForTier('LOW')).toBe(240);
    });
  });
});
