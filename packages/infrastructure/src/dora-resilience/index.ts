/**
 * DORA-Aligned Operational Resilience module.
 *
 * Provides:
 * - ICT risk register management for critical AI/ML services (Req 30.1)
 * - Third-party concentration risk assessment and mitigation (Req 30.2)
 * - Exit strategy documentation with 90-day executability validation (Req 30.3)
 * - Service criticality classification and recovery runbooks (Req 30.4)
 */

export type {
  CriticalityTier,
  DoraJurisdiction,
  ServiceStatus,
  ReviewFrequency,
  ExitStrategyStatus,
  RunbookTestStatus,
  VendorCategory,
  VendorDependency,
  ImpactAssessment,
  IctRiskRegisterEntry,
  ConcentrationRiskAssessment,
  ExitStep,
  ExitStrategy,
  RunbookStep,
  RecoveryRunbook,
  EscalationContact,
  DoraComplianceResult,
  DoraRequirementResult,
  ComplianceFinding,
} from './types.js';

export {
  DoraResilienceService,
  getRtoForTier,
  getRpoForTier,
} from './dora-resilience-service.js';
