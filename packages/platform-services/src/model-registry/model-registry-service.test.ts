/**
 * Unit tests for the Model Registry and Governance Framework.
 *
 * Validates:
 * - Requirement 18.1: Centralised model inventory
 * - Requirement 18.2: Challenger-model requirements for credit and fraud models
 * - Requirement 18.3: Validation independence enforcement
 * - Requirement 18.4: Drift detection with automated alerting
 * - Requirement 18.6: Model archival for 7-year retention
 * - Requirement 18.7: Model provenance tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelRegistry } from './model-registry-service.js';
import { InMemoryModelStore } from './in-memory-store.js';
import type { RegisterModelInput } from './model-registry-service.js';
import type {
  DriftDetectionConfig,
  DriftMetric,
  ModelProvenance,
  ValidationIndependencePolicy,
} from './types.js';

/** Helper to create a valid model registration input. */
function createTestInput(overrides?: Partial<RegisterModelInput>): RegisterModelInput {
  return {
    modelId: 'model-001',
    modelName: 'Fraud Scoring v2',
    purpose: 'Real-time payment fraud detection for UPI/IMPS transactions',
    owner: 'fraud-ml-team',
    riskTier: 'HIGH',
    domain: 'FRAUD',
    provenance: {
      trainingDataLineage: [
        {
          datasetId: 'ds-txn-2024q1',
          version: '1.0.0',
          timeRange: { from: '2024-01-01T00:00:00.000Z', to: '2024-03-31T23:59:59.999Z' },
          recordCount: 50_000_000,
        },
      ],
      hyperparameters: {
        learningRate: 0.001,
        epochs: 50,
        batchSize: 256,
        architecture: 'XGBoost',
      },
      evaluationResults: [
        {
          metric: 'AUC',
          value: 0.97,
          evaluationDatasetId: 'ds-eval-2024q1',
          evaluatedAt: '2024-04-01T10:00:00.000Z',
        },
        {
          metric: 'precision',
          value: 0.94,
          evaluationDatasetId: 'ds-eval-2024q1',
          evaluatedAt: '2024-04-01T10:00:00.000Z',
        },
      ],
      approvalChain: [],
    },
    ...overrides,
  };
}

describe('ModelRegistry', () => {
  let registry: ModelRegistry;
  let store: InMemoryModelStore;

  beforeEach(() => {
    store = new InMemoryModelStore();
    registry = new ModelRegistry(store);
  });

  // ─── Requirement 18.1: Centralised Model Inventory ─────────────────────

  describe('Requirement 18.1: Centralised model inventory', () => {
    it('should register a new model with all required fields', async () => {
      const input = createTestInput();
      const model = await registry.register(input);

      expect(model.modelId).toBe('model-001');
      expect(model.modelName).toBe('Fraud Scoring v2');
      expect(model.purpose).toBe('Real-time payment fraud detection for UPI/IMPS transactions');
      expect(model.owner).toBe('fraud-ml-team');
      expect(model.riskTier).toBe('HIGH');
      expect(model.domain).toBe('FRAUD');
      expect(model.validationStatus).toBe('DRAFT');
      expect(model.deployedAt).toBeNull();
      expect(model.registeredAt).toBeDefined();
      expect(model.isArchived).toBe(false);
    });

    it('should reject registration with empty modelId', async () => {
      await expect(
        registry.register(createTestInput({ modelId: '' }))
      ).rejects.toThrow('modelId is required');
    });

    it('should reject registration with empty modelName', async () => {
      await expect(
        registry.register(createTestInput({ modelName: '' }))
      ).rejects.toThrow('modelName is required');
    });

    it('should reject registration with empty purpose', async () => {
      await expect(
        registry.register(createTestInput({ purpose: '' }))
      ).rejects.toThrow('purpose is required');
    });

    it('should reject registration with empty owner', async () => {
      await expect(
        registry.register(createTestInput({ owner: '' }))
      ).rejects.toThrow('owner is required');
    });

    it('should reject duplicate model registration', async () => {
      await registry.register(createTestInput());
      await expect(
        registry.register(createTestInput())
      ).rejects.toThrow('Model already registered: model-001');
    });

    it('should retrieve a registered model by ID', async () => {
      await registry.register(createTestInput());
      const model = await registry.getModel('model-001');

      expect(model).not.toBeNull();
      expect(model!.modelId).toBe('model-001');
    });

    it('should return null for non-existent model', async () => {
      const model = await registry.getModel('non-existent');
      expect(model).toBeNull();
    });

    it('should list models with filters', async () => {
      await registry.register(createTestInput({ modelId: 'fraud-1', domain: 'FRAUD', riskTier: 'HIGH' }));
      await registry.register(createTestInput({ modelId: 'credit-1', domain: 'CREDIT', riskTier: 'HIGH' }));
      await registry.register(createTestInput({ modelId: 'nba-1', domain: 'NBA', riskTier: 'LOW' }));

      const highRisk = await registry.listModels({ riskTier: 'HIGH' });
      expect(highRisk).toHaveLength(2);

      const fraudModels = await registry.listModels({ domain: 'FRAUD' });
      expect(fraudModels).toHaveLength(1);
      expect(fraudModels[0].modelId).toBe('fraud-1');
    });

    it('should track validation status through lifecycle transitions', async () => {
      await registry.register(createTestInput());

      let model = await registry.updateValidationStatus('model-001', 'IN_VALIDATION');
      expect(model.validationStatus).toBe('IN_VALIDATION');

      model = await registry.updateValidationStatus('model-001', 'VALIDATED');
      expect(model.validationStatus).toBe('VALIDATED');

      model = await registry.updateValidationStatus('model-001', 'DEPLOYED');
      expect(model.validationStatus).toBe('DEPLOYED');
      expect(model.deployedAt).toBeDefined();
    });

    it('should reject invalid status transitions', async () => {
      await registry.register(createTestInput());

      await expect(
        registry.updateValidationStatus('model-001', 'DEPLOYED')
      ).rejects.toThrow('Invalid status transition: DRAFT → DEPLOYED');
    });

    it('should reject status update for non-existent model', async () => {
      await expect(
        registry.updateValidationStatus('non-existent', 'IN_VALIDATION')
      ).rejects.toThrow('Model not found: non-existent');
    });
  });

  // ─── Requirement 18.2: Challenger Model Requirements ───────────────────

  describe('Requirement 18.2: Challenger-model requirements', () => {
    it('should require challengers for CREDIT domain models', () => {
      expect(registry.requiresChallenger('CREDIT')).toBe(true);
    });

    it('should require challengers for FRAUD domain models', () => {
      expect(registry.requiresChallenger('FRAUD')).toBe(true);
    });

    it('should not require challengers for other domains', () => {
      expect(registry.requiresChallenger('AML')).toBe(false);
      expect(registry.requiresChallenger('NBA')).toBe(false);
      expect(registry.requiresChallenger('CONVERSATIONAL')).toBe(false);
      expect(registry.requiresChallenger('DOCUMENT')).toBe(false);
      expect(registry.requiresChallenger('OTHER')).toBe(false);
    });

    it('should register a valid challenger pairing', async () => {
      await registry.register(createTestInput({ modelId: 'fraud-champion', domain: 'FRAUD' }));
      await registry.register(createTestInput({ modelId: 'fraud-challenger', domain: 'FRAUD' }));

      const pairing = await registry.registerChallengerPairing('fraud-champion', 'fraud-challenger');

      expect(pairing.championModelId).toBe('fraud-champion');
      expect(pairing.challengerModelId).toBe('fraud-challenger');
      expect(pairing.domain).toBe('FRAUD');
      expect(pairing.startedAt).toBeDefined();
      expect(pairing.comparisonReports).toHaveLength(0);
    });

    it('should reject challenger pairing with domain mismatch', async () => {
      await registry.register(createTestInput({ modelId: 'fraud-model', domain: 'FRAUD' }));
      await registry.register(createTestInput({ modelId: 'credit-model', domain: 'CREDIT' }));

      await expect(
        registry.registerChallengerPairing('fraud-model', 'credit-model')
      ).rejects.toThrow('Domain mismatch');
    });

    it('should reject challenger pairing for non-challenger-required domain', async () => {
      await registry.register(createTestInput({ modelId: 'nba-1', domain: 'NBA' }));
      await registry.register(createTestInput({ modelId: 'nba-2', domain: 'NBA' }));

      await expect(
        registry.registerChallengerPairing('nba-1', 'nba-2')
      ).rejects.toThrow("Domain 'NBA' does not require challenger models");
    });

    it('should validate challenger compliance passes when pairing exists', async () => {
      await registry.register(createTestInput({ modelId: 'fraud-champion', domain: 'FRAUD' }));
      await registry.register(createTestInput({ modelId: 'fraud-challenger', domain: 'FRAUD' }));
      await registry.registerChallengerPairing('fraud-champion', 'fraud-challenger');

      const isCompliant = await registry.validateChallengerCompliance('fraud-champion');
      expect(isCompliant).toBe(true);
    });

    it('should fail challenger compliance when champion has no challenger', async () => {
      const input = createTestInput({ modelId: 'fraud-solo', domain: 'FRAUD' });
      await registry.register(input);

      // Manually mark as champion
      const model = (await registry.getModel('fraud-solo'))!;
      model.isChampion = true;
      await store.save(model);

      await expect(
        registry.validateChallengerCompliance('fraud-solo')
      ).rejects.toThrow('Challenger model required');
    });

    it('should pass challenger compliance for non-champion models', async () => {
      await registry.register(createTestInput({ modelId: 'fraud-non-champion', domain: 'FRAUD' }));

      const isCompliant = await registry.validateChallengerCompliance('fraud-non-champion');
      expect(isCompliant).toBe(true);
    });

    it('should add monthly comparison reports to challenger pairing', async () => {
      await registry.register(createTestInput({ modelId: 'champ', domain: 'CREDIT' }));
      await registry.register(createTestInput({ modelId: 'chall', domain: 'CREDIT' }));
      await registry.registerChallengerPairing('champ', 'chall');

      const report = {
        period: { from: '2024-04-01T00:00:00.000Z', to: '2024-04-30T23:59:59.999Z' },
        championMetrics: { accuracy: 0.95, approvalRate: 0.72, defaultRate: 0.03 },
        challengerMetrics: { accuracy: 0.96, approvalRate: 0.74, defaultRate: 0.025 },
        generatedAt: '2024-05-01T10:00:00.000Z',
      };

      const pairing = await registry.addChallengerReport('champ', report);
      expect(pairing.comparisonReports).toHaveLength(1);
      expect(pairing.comparisonReports[0].championMetrics.accuracy).toBe(0.95);
    });
  });

  // ─── Requirement 18.3: Validation Independence ─────────────────────────

  describe('Requirement 18.3: Validation independence enforcement', () => {
    it('should pass when development and validation teams are different', () => {
      const policy: ValidationIndependencePolicy = {
        developmentTeam: 'fraud-ml-dev',
        validationTeam: 'model-validation-team',
      };

      const result = registry.enforceValidationIndependence(policy);
      expect(result.independent).toBe(true);
    });

    it('should fail when development and validation teams are the same', () => {
      const policy: ValidationIndependencePolicy = {
        developmentTeam: 'fraud-ml-team',
        validationTeam: 'fraud-ml-team',
      };

      const result = registry.enforceValidationIndependence(policy);
      expect(result.independent).toBe(false);
      expect(result.reason).toContain('Validation independence violated');
    });

    it('should perform case-insensitive team comparison', () => {
      const policy: ValidationIndependencePolicy = {
        developmentTeam: 'Fraud-ML-Team',
        validationTeam: 'fraud-ml-team',
      };

      const result = registry.enforceValidationIndependence(policy);
      expect(result.independent).toBe(false);
    });

    it('should fail when development team is empty', () => {
      const policy: ValidationIndependencePolicy = {
        developmentTeam: '',
        validationTeam: 'validation-team',
      };

      const result = registry.enforceValidationIndependence(policy);
      expect(result.independent).toBe(false);
      expect(result.reason).toContain('Development team not specified');
    });

    it('should fail when validation team is empty', () => {
      const policy: ValidationIndependencePolicy = {
        developmentTeam: 'dev-team',
        validationTeam: '',
      };

      const result = registry.enforceValidationIndependence(policy);
      expect(result.independent).toBe(false);
      expect(result.reason).toContain('Validation team not specified');
    });

    it('should validate approval chain independence across dev and validation stages', async () => {
      const provenance: ModelProvenance = {
        trainingDataLineage: [],
        hyperparameters: {},
        evaluationResults: [],
        approvalChain: [
          { approver: 'dev-lead', approverTeam: 'fraud-dev', stage: 'DEVELOPMENT', approvedAt: '2024-01-01T00:00:00.000Z' },
          { approver: 'val-lead', approverTeam: 'model-risk', stage: 'VALIDATION', approvedAt: '2024-02-01T00:00:00.000Z' },
        ],
      };

      await registry.register(createTestInput({ modelId: 'ind-model', provenance }));
      const result = await registry.validateApprovalChainIndependence('ind-model');

      expect(result.independent).toBe(true);
    });

    it('should detect approval chain violation when same team approves dev and validation', async () => {
      const provenance: ModelProvenance = {
        trainingDataLineage: [],
        hyperparameters: {},
        evaluationResults: [],
        approvalChain: [
          { approver: 'alice', approverTeam: 'ml-team', stage: 'DEVELOPMENT', approvedAt: '2024-01-01T00:00:00.000Z' },
          { approver: 'bob', approverTeam: 'ml-team', stage: 'VALIDATION', approvedAt: '2024-02-01T00:00:00.000Z' },
        ],
      };

      await registry.register(createTestInput({ modelId: 'conflict-model', provenance }));
      const result = await registry.validateApprovalChainIndependence('conflict-model');

      expect(result.independent).toBe(false);
      expect(result.reason).toContain('ml-team');
    });

    it('should report missing development approvals', async () => {
      const provenance: ModelProvenance = {
        trainingDataLineage: [],
        hyperparameters: {},
        evaluationResults: [],
        approvalChain: [
          { approver: 'val-lead', approverTeam: 'model-risk', stage: 'VALIDATION', approvedAt: '2024-02-01T00:00:00.000Z' },
        ],
      };

      await registry.register(createTestInput({ modelId: 'no-dev-approval', provenance }));
      const result = await registry.validateApprovalChainIndependence('no-dev-approval');

      expect(result.independent).toBe(false);
      expect(result.reason).toContain('No development approvals found');
    });
  });

  // ─── Requirement 18.4: Drift Detection ─────────────────────────────────

  describe('Requirement 18.4: Drift detection with automated alerting', () => {
    const driftConfig: DriftDetectionConfig = {
      modelId: 'model-001',
      metrics: [
        { metricName: 'accuracy', threshold: 0.05, direction: 'DECREASE' },
        { metricName: 'fairness_ratio', threshold: 0.10, direction: 'DECREASE' },
        { metricName: 'stability_index', threshold: 0.15, direction: 'BOTH' },
      ],
      maxAlertDelayMs: 3_600_000, // 1 hour
    };

    beforeEach(async () => {
      await registry.register(createTestInput());
      registry.configureDriftDetection(driftConfig);
    });

    it('should detect drift when accuracy decreases beyond threshold', async () => {
      const metric: DriftMetric = {
        metricName: 'accuracy',
        currentValue: 0.82,
        baselineValue: 0.95,
        threshold: 0.05,
        measuredAt: '2024-06-01T12:00:00.000Z',
      };

      const alert = await registry.evaluateDrift('model-001', metric);

      expect(alert).not.toBeNull();
      expect(alert!.modelId).toBe('model-001');
      expect(alert!.metric.metricName).toBe('accuracy');
      expect(alert!.severity).toBe('CRITICAL'); // 0.13 > 0.05 * 2 = 0.10
      expect(alert!.recalibrationInitiated).toBe(true);
      expect(alert!.alertedAt).toBeDefined();
    });

    it('should not alert when metric is within threshold', async () => {
      const metric: DriftMetric = {
        metricName: 'accuracy',
        currentValue: 0.93,
        baselineValue: 0.95,
        threshold: 0.05,
        measuredAt: '2024-06-01T12:00:00.000Z',
      };

      const alert = await registry.evaluateDrift('model-001', metric);
      expect(alert).toBeNull();
    });

    it('should respect direction constraint — DECREASE only', async () => {
      // Accuracy increase should not trigger alert (direction: DECREASE)
      const metric: DriftMetric = {
        metricName: 'accuracy',
        currentValue: 0.99,
        baselineValue: 0.95,
        threshold: 0.05,
        measuredAt: '2024-06-01T12:00:00.000Z',
      };

      const alert = await registry.evaluateDrift('model-001', metric);
      expect(alert).toBeNull();
    });

    it('should detect drift in both directions when configured', async () => {
      // Stability increase beyond threshold
      const metric: DriftMetric = {
        metricName: 'stability_index',
        currentValue: 0.80,
        baselineValue: 0.50,
        threshold: 0.15,
        measuredAt: '2024-06-01T12:00:00.000Z',
      };

      const alert = await registry.evaluateDrift('model-001', metric);
      expect(alert).not.toBeNull();
      expect(alert!.metric.metricName).toBe('stability_index');
    });

    it('should notify alert listeners on drift detection', async () => {
      const listener = vi.fn();
      registry.onDriftAlert(listener);

      const metric: DriftMetric = {
        metricName: 'fairness_ratio',
        currentValue: 0.65,
        baselineValue: 0.85,
        threshold: 0.10,
        measuredAt: '2024-06-01T12:00:00.000Z',
      };

      await registry.evaluateDrift('model-001', metric);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].modelId).toBe('model-001');
    });

    it('should persist drift alerts for retrieval', async () => {
      const metric: DriftMetric = {
        metricName: 'accuracy',
        currentValue: 0.80,
        baselineValue: 0.95,
        threshold: 0.05,
        measuredAt: '2024-06-01T12:00:00.000Z',
      };

      await registry.evaluateDrift('model-001', metric);

      const alerts = await registry.getDriftAlerts('model-001');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].metric.metricName).toBe('accuracy');
    });

    it('should reject drift config with maxAlertDelayMs exceeding 1 hour', () => {
      const invalidConfig: DriftDetectionConfig = {
        modelId: 'model-001',
        metrics: [{ metricName: 'accuracy', threshold: 0.05, direction: 'DECREASE' }],
        maxAlertDelayMs: 3_600_001, // 1 hour + 1ms
      };

      expect(() => registry.configureDriftDetection(invalidConfig)).toThrow(
        'maxAlertDelayMs cannot exceed 1 hour'
      );
    });

    it('should throw when evaluating drift for model without config', async () => {
      await registry.register(createTestInput({ modelId: 'unconfigured' }));

      const metric: DriftMetric = {
        metricName: 'accuracy',
        currentValue: 0.80,
        baselineValue: 0.95,
        threshold: 0.05,
        measuredAt: '2024-06-01T12:00:00.000Z',
      };

      await expect(
        registry.evaluateDrift('unconfigured', metric)
      ).rejects.toThrow('No drift detection configured');
    });

    it('should return null for unmonitored metrics', async () => {
      const metric: DriftMetric = {
        metricName: 'unmonitored_metric',
        currentValue: 0.50,
        baselineValue: 0.90,
        threshold: 0.05,
        measuredAt: '2024-06-01T12:00:00.000Z',
      };

      const alert = await registry.evaluateDrift('model-001', metric);
      expect(alert).toBeNull();
    });

    it('should classify severity as WARNING for small drift', async () => {
      const metric: DriftMetric = {
        metricName: 'accuracy',
        currentValue: 0.89,
        baselineValue: 0.95,
        threshold: 0.05,
        measuredAt: '2024-06-01T12:00:00.000Z',
      };

      const alert = await registry.evaluateDrift('model-001', metric);
      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe('WARNING'); // 0.06 < 0.05 * 2
    });
  });

  // ─── Requirement 18.7: Model Provenance Tracking ───────────────────────

  describe('Requirement 18.7: Model provenance tracking', () => {
    it('should track training data lineage on registration', async () => {
      const model = await registry.register(createTestInput());

      expect(model.provenance.trainingDataLineage).toHaveLength(1);
      expect(model.provenance.trainingDataLineage[0].datasetId).toBe('ds-txn-2024q1');
      expect(model.provenance.trainingDataLineage[0].recordCount).toBe(50_000_000);
    });

    it('should track hyperparameters on registration', async () => {
      const model = await registry.register(createTestInput());

      expect(model.provenance.hyperparameters).toEqual({
        learningRate: 0.001,
        epochs: 50,
        batchSize: 256,
        architecture: 'XGBoost',
      });
    });

    it('should track evaluation results on registration', async () => {
      const model = await registry.register(createTestInput());

      expect(model.provenance.evaluationResults).toHaveLength(2);
      expect(model.provenance.evaluationResults[0].metric).toBe('AUC');
      expect(model.provenance.evaluationResults[0].value).toBe(0.97);
    });

    it('should update provenance with new training data lineage', async () => {
      await registry.register(createTestInput());

      const updatedModel = await registry.updateProvenance('model-001', {
        trainingDataLineage: [
          {
            datasetId: 'ds-txn-2024q2',
            version: '2.0.0',
            timeRange: { from: '2024-04-01T00:00:00.000Z', to: '2024-06-30T23:59:59.999Z' },
            recordCount: 75_000_000,
          },
        ],
      });

      expect(updatedModel.provenance.trainingDataLineage).toHaveLength(1);
      expect(updatedModel.provenance.trainingDataLineage[0].datasetId).toBe('ds-txn-2024q2');
    });

    it('should add approval records to the provenance chain', async () => {
      await registry.register(createTestInput());

      let model = await registry.addApproval(
        'model-001', 'alice', 'fraud-dev', 'DEVELOPMENT', 'Initial development complete'
      );
      expect(model.provenance.approvalChain).toHaveLength(1);

      model = await registry.addApproval(
        'model-001', 'bob', 'model-risk', 'VALIDATION', 'Validated against requirements'
      );
      expect(model.provenance.approvalChain).toHaveLength(2);
      expect(model.provenance.approvalChain[1].approver).toBe('bob');
      expect(model.provenance.approvalChain[1].stage).toBe('VALIDATION');
    });

    it('should throw when updating provenance for non-existent model', async () => {
      await expect(
        registry.updateProvenance('non-existent', { hyperparameters: {} })
      ).rejects.toThrow('Model not found: non-existent');
    });

    it('should preserve existing provenance fields when updating partial', async () => {
      await registry.register(createTestInput());

      await registry.updateProvenance('model-001', {
        hyperparameters: { newParam: 'value' },
      });

      const model = await registry.getModel('model-001');
      // Training lineage should be unchanged
      expect(model!.provenance.trainingDataLineage).toHaveLength(1);
      // Hyperparameters should be updated
      expect(model!.provenance.hyperparameters).toEqual({ newParam: 'value' });
    });
  });

  // ─── Requirement 18.6: Model Archival ──────────────────────────────────

  describe('Requirement 18.6: Model archival for 7-year retention', () => {
    it('should archive a model with 7-year retention expiry', async () => {
      await registry.register(createTestInput());
      await registry.updateValidationStatus('model-001', 'IN_VALIDATION');
      await registry.updateValidationStatus('model-001', 'VALIDATED');
      await registry.updateValidationStatus('model-001', 'DEPLOYED');
      await registry.updateValidationStatus('model-001', 'DEPRECATED');

      const archived = await registry.archiveModel('model-001');

      expect(archived.isArchived).toBe(true);
      expect(archived.archivedAt).toBeDefined();
      expect(archived.retentionExpiryDate).toBeDefined();
      expect(archived.validationStatus).toBe('ARCHIVED');

      // Verify 7-year retention
      const archivedDate = new Date(archived.archivedAt!);
      const expiryDate = new Date(archived.retentionExpiryDate!);
      expect(expiryDate.getFullYear()).toBe(archivedDate.getFullYear() + 7);
    });

    it('should reject archiving a model that is already archived', async () => {
      await registry.register(createTestInput());
      await registry.updateValidationStatus('model-001', 'IN_VALIDATION');
      await registry.updateValidationStatus('model-001', 'VALIDATED');
      await registry.updateValidationStatus('model-001', 'DEPLOYED');
      await registry.updateValidationStatus('model-001', 'DEPRECATED');
      await registry.archiveModel('model-001');

      await expect(
        registry.archiveModel('model-001')
      ).rejects.toThrow('Model already archived: model-001');
    });

    it('should reject archiving a non-existent model', async () => {
      await expect(
        registry.archiveModel('non-existent')
      ).rejects.toThrow('Model not found: non-existent');
    });

    it('should retrieve archived model for retrospective explanation', async () => {
      await registry.register(createTestInput());
      await registry.updateValidationStatus('model-001', 'IN_VALIDATION');
      await registry.updateValidationStatus('model-001', 'VALIDATED');
      await registry.updateValidationStatus('model-001', 'DEPLOYED');
      await registry.updateValidationStatus('model-001', 'DEPRECATED');
      await registry.archiveModel('model-001');

      const archived = await registry.retrieveArchivedModel('model-001');

      expect(archived.isArchived).toBe(true);
      expect(archived.provenance).toBeDefined();
      expect(archived.provenance.hyperparameters).toBeDefined();
      expect(archived.provenance.evaluationResults).toBeDefined();
    });

    it('should throw when retrieving non-archived model as archived', async () => {
      await registry.register(createTestInput());

      await expect(
        registry.retrieveArchivedModel('model-001')
      ).rejects.toThrow("Model 'model-001' is not archived");
    });

    it('should correctly identify expired vs non-expired archived models', async () => {
      await registry.register(createTestInput());
      await registry.updateValidationStatus('model-001', 'IN_VALIDATION');
      await registry.updateValidationStatus('model-001', 'VALIDATED');
      await registry.updateValidationStatus('model-001', 'DEPLOYED');
      await registry.updateValidationStatus('model-001', 'DEPRECATED');
      const archived = await registry.archiveModel('model-001');

      // Not expired yet (checking against today)
      expect(registry.isRetentionExpired(archived)).toBe(false);

      // Expired if we check 8 years from now
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 8);
      expect(registry.isRetentionExpired(archived, futureDate.toISOString())).toBe(true);
    });

    it('should return false for non-archived models in retention check', async () => {
      const model = await registry.register(createTestInput());
      expect(registry.isRetentionExpired(model)).toBe(false);
    });

    it('should list only archived models when filtering by isArchived', async () => {
      await registry.register(createTestInput({ modelId: 'active-1' }));
      await registry.register(createTestInput({ modelId: 'to-archive' }));
      await registry.updateValidationStatus('to-archive', 'IN_VALIDATION');
      await registry.updateValidationStatus('to-archive', 'VALIDATED');
      await registry.updateValidationStatus('to-archive', 'DEPLOYED');
      await registry.updateValidationStatus('to-archive', 'DEPRECATED');
      await registry.archiveModel('to-archive');

      const archivedModels = await registry.listModels({ isArchived: true });
      expect(archivedModels).toHaveLength(1);
      expect(archivedModels[0].modelId).toBe('to-archive');

      const activeModels = await registry.listModels({ isArchived: false });
      expect(activeModels).toHaveLength(1);
      expect(activeModels[0].modelId).toBe('active-1');
    });
  });
});
