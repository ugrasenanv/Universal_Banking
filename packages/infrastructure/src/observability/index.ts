/**
 * Observability module exports.
 *
 * OpenTelemetry-based unified observability stack for the AFG AI/ML Banking Platform.
 * Provides distributed tracing, AI/LLM metrics, alerting, and retention management.
 *
 * Requirements: 25.1, 25.2, 25.3, 25.4, 25.5
 */

export { ObservabilityService } from './observability-service.js';

export type {
  TraceContext,
  ProcessingPath,
  Span,
  SpanStatus,
  SpanEvent,
  AIMetricType,
  AIMetricDataPoint,
  AIMetricSummary,
  LLMObservation,
  RoutingDecision,
  GuardrailTrigger,
  AlertSeverity,
  AlertCategory,
  AlertThreshold,
  ObservabilityAlert,
  RetentionTier,
  RetentionPolicy,
  SpanStore,
  AIMetricsStore,
  LLMObservationStore,
  AlertNotifier,
  ObservabilityServiceConfig,
} from './types.js';

export {
  DEFAULT_RETENTION_POLICIES,
  DEFAULT_OBSERVABILITY_CONFIG,
} from './types.js';
