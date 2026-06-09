/**
 * Model Registry and Governance Framework module.
 *
 * Exports the ModelRegistry service, InMemoryModelStore for testing,
 * and all related types.
 */

export { ModelRegistry } from './model-registry-service.js';
export type { RegisterModelInput } from './model-registry-service.js';
export { InMemoryModelStore } from './in-memory-store.js';
export type {
  RiskTier,
  ValidationStatus,
  ModelDomain,
  ModelRecord,
  ModelProvenance,
  TrainingDataSource,
  EvaluationResult,
  ApprovalRecord,
  ValidationIndependencePolicy,
  ValidationIndependenceResult,
  DriftMetric,
  DriftAlert,
  DriftDetectionConfig,
  DriftThresholdConfig,
  ChallengerPairing,
  ChallengerReport,
  ModelStore,
  ModelListFilters,
} from './types.js';
