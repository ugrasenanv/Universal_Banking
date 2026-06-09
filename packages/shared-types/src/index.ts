/**
 * @afg/shared-types
 *
 * Shared domain types and interfaces for the AFG Enterprise AI/ML Banking Platform.
 * All types use open-standards-based interfaces (Requirement 22.1).
 */

// Core domain types
export type {
  Jurisdiction,
  CurrencyCode,
  ISO8601,
  EntityRef,
  LanguageCode,
  CostTier,
  QualityTier,
  DateRange,
} from './domain-types.js';

// Platform event schemas
export type { PlatformEvent, DeadLetterEvent } from './events.js';

// Audit artefact types and utilities
export type {
  AuditArtefact,
  FeatureAttribution,
  HumanOverrideRecord,
  RetrievedChunkRef,
} from './audit.js';
export {
  computeIntegrityHash,
  verifyIntegrity,
  computeRetentionExpiry,
} from './audit.js';

// Circuit breaker and degradation hierarchy
export type {
  DegradationTier,
  CircuitBreakerState,
  CircuitBreakerConfig,
  FailureState,
  DegradationPolicy,
  TierConfig,
} from './circuit-breaker.js';
export {
  DEGRADATION_ORDER,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  getNextDegradationTier,
} from './circuit-breaker.js';
