/**
 * OpenTelemetry Observability Stack Types
 *
 * Defines all interfaces for distributed tracing, AI-specific metrics,
 * LLM-specific observability, alerting, and retention policies.
 *
 * Requirements: 25.1, 25.2, 25.3, 25.4, 25.5
 */

import type { ISO8601, Jurisdiction } from '@afg/shared-types';

// ──────────────────────────────────────────────────────────────────────────────
// Distributed Tracing Types (Req 25.1)
// ──────────────────────────────────────────────────────────────────────────────

/** W3C Trace Context propagation header fields. */
export interface TraceContext {
  /** W3C traceparent header value (version-traceId-spanId-traceFlags). */
  traceId: string;
  /** Current span identifier. */
  spanId: string;
  /** Parent span identifier (undefined for root spans). */
  parentSpanId?: string;
  /** Trace flags (e.g., sampled). */
  traceFlags: number;
}

/** Processing path type for trace context propagation. */
export type ProcessingPath = 'SYNCHRONOUS' | 'ASYNCHRONOUS' | 'BATCH';

/** A single span within a distributed trace. */
export interface Span {
  /** Unique span identifier. */
  spanId: string;
  /** Trace this span belongs to. */
  traceId: string;
  /** Parent span ID (undefined for root spans). */
  parentSpanId?: string;
  /** Human-readable operation name. */
  operationName: string;
  /** Service that generated this span. */
  serviceId: string;
  /** Start timestamp. */
  startTime: ISO8601;
  /** End timestamp (undefined if still active). */
  endTime?: ISO8601;
  /** Duration in milliseconds. */
  durationMs?: number;
  /** Processing path type. */
  processingPath: ProcessingPath;
  /** Span status. */
  status: SpanStatus;
  /** Key-value attributes for this span. */
  attributes: Record<string, string | number | boolean>;
  /** Events (logs) attached to this span. */
  events: SpanEvent[];
  /** Jurisdiction where this span was generated. */
  jurisdiction: Jurisdiction;
}

/** Span completion status. */
export type SpanStatus = 'OK' | 'ERROR' | 'UNSET';

/** An event (log entry) attached to a span. */
export interface SpanEvent {
  /** Event name. */
  name: string;
  /** Timestamp of the event. */
  timestamp: ISO8601;
  /** Event attributes. */
  attributes: Record<string, string | number | boolean>;
}

// ──────────────────────────────────────────────────────────────────────────────
// AI-Specific Metrics Types (Req 25.2)
// ──────────────────────────────────────────────────────────────────────────────

/** AI model metric types exposed via Prometheus-compatible endpoints. */
export type AIMetricType =
  | 'MODEL_LATENCY'
  | 'TOKEN_THROUGHPUT'
  | 'INFERENCE_ERROR_RATE'
  | 'GROUNDEDNESS_SCORE'
  | 'DRIFT_INDICATOR';

/** A single AI metric data point. */
export interface AIMetricDataPoint {
  /** Metric type. */
  metricType: AIMetricType;
  /** Service producing the metric. */
  serviceId: string;
  /** Model identifier. */
  modelId: string;
  /** Model version. */
  modelVersion: string;
  /** Timestamp of measurement. */
  timestamp: ISO8601;
  /** Metric value. */
  value: number;
  /** Unit of measurement. */
  unit: string;
  /** Labels for Prometheus compatibility. */
  labels: Record<string, string>;
  /** Jurisdiction where metric was collected. */
  jurisdiction: Jurisdiction;
}

/** Aggregated AI metric summary for a time window. */
export interface AIMetricSummary {
  /** Metric type. */
  metricType: AIMetricType;
  /** Service identifier. */
  serviceId: string;
  /** Model identifier. */
  modelId: string;
  /** Time window. */
  windowStart: ISO8601;
  windowEnd: ISO8601;
  /** Statistical aggregates. */
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// LLM-Specific Observability Types (Req 25.3)
// ──────────────────────────────────────────────────────────────────────────────

/** LLM inference observation record. */
export interface LLMObservation {
  /** Unique observation identifier. */
  observationId: string;
  /** Trace ID for correlation. */
  traceId: string;
  /** Service initiating the request. */
  serviceId: string;
  /** Timestamp of inference request. */
  timestamp: ISO8601;
  /** Model used for inference. */
  modelId: string;
  /** Model version. */
  modelVersion: string;
  /** Prompt token count. */
  promptTokens: number;
  /** Completion token count. */
  completionTokens: number;
  /** Total tokens (prompt + completion). */
  totalTokens: number;
  /** Model routing decision details. */
  routingDecision: RoutingDecision;
  /** Guardrail check results. */
  guardrailTriggers: GuardrailTrigger[];
  /** Cost in normalised cost units. */
  costPerInference: number;
  /** Inference latency in milliseconds. */
  latencyMs: number;
  /** Whether the response was served from cache. */
  cacheHit: boolean;
  /** Jurisdiction. */
  jurisdiction: Jurisdiction;
}

/** Model routing decision details. */
export interface RoutingDecision {
  /** Requested quality tier. */
  requestedQuality: string;
  /** Requested cost ceiling. */
  requestedCostCeiling: string;
  /** Model selected by the router. */
  selectedModel: string;
  /** Reason for selection. */
  selectionReason: string;
  /** Whether jurisdictional constraints affected routing. */
  jurisdictionConstrained: boolean;
}

/** Guardrail trigger record. */
export interface GuardrailTrigger {
  /** Check type that triggered. */
  checkType: string;
  /** Direction (INPUT or OUTPUT). */
  direction: 'INPUT' | 'OUTPUT';
  /** Whether the content was blocked. */
  blocked: boolean;
  /** Trigger confidence score. */
  confidence: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Alerting Types (Req 25.4)
// ──────────────────────────────────────────────────────────────────────────────

/** Alert severity levels. */
export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Alert category. */
export type AlertCategory = 'LATENCY' | 'ERROR_RATE' | 'SATURATION' | 'DRIFT' | 'COST' | 'AVAILABILITY';

/** Threshold definition for alerting. */
export interface AlertThreshold {
  /** Unique threshold identifier. */
  thresholdId: string;
  /** Service this threshold applies to. */
  serviceId: string;
  /** Metric being monitored. */
  metricType: AIMetricType | string;
  /** Alert category. */
  category: AlertCategory;
  /** Threshold value. */
  thresholdValue: number;
  /** Comparison operator. */
  operator: 'GREATER_THAN' | 'LESS_THAN' | 'EQUALS';
  /** Severity when breached. */
  severity: AlertSeverity;
  /** Window size in seconds for evaluation. */
  evaluationWindowSeconds: number;
  /** Description of the threshold. */
  description: string;
}

/** An emitted alert when a threshold is breached. */
export interface ObservabilityAlert {
  /** Unique alert identifier. */
  alertId: string;
  /** Threshold that was breached. */
  thresholdId: string;
  /** Service that breached the threshold. */
  serviceId: string;
  /** Alert category. */
  category: AlertCategory;
  /** Severity level. */
  severity: AlertSeverity;
  /** Current metric value that caused the breach. */
  currentValue: number;
  /** Threshold value that was breached. */
  thresholdValue: number;
  /** Timestamp of detection. */
  detectedAt: ISO8601;
  /** Time elapsed from breach to alert emission (ms). */
  alertLatencyMs: number;
  /** Human-readable summary. */
  summary: string;
  /** Jurisdiction where the breach was detected. */
  jurisdiction: Jurisdiction;
}

// ──────────────────────────────────────────────────────────────────────────────
// Retention Policy Types (Req 25.5)
// ──────────────────────────────────────────────────────────────────────────────

/** Retention tier for observability data. */
export type RetentionTier = 'OPERATIONAL' | 'AGGREGATE_AUDIT';

/** Retention policy configuration. */
export interface RetentionPolicy {
  /** Retention tier. */
  tier: RetentionTier;
  /** Data type (traces, metrics, logs). */
  dataType: 'TRACES' | 'METRICS' | 'LOGS' | 'LLM_OBSERVATIONS';
  /** Retention duration in days. */
  retentionDays: number;
  /** Whether data is aggregated before archival. */
  aggregateBeforeArchival: boolean;
  /** Archival storage format. */
  archivalFormat: 'PARQUET' | 'ICEBERG' | 'RAW';
}

/** Default retention policies per requirement 25.5. */
export const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  { tier: 'OPERATIONAL', dataType: 'TRACES', retentionDays: 90, aggregateBeforeArchival: false, archivalFormat: 'RAW' },
  { tier: 'OPERATIONAL', dataType: 'METRICS', retentionDays: 90, aggregateBeforeArchival: false, archivalFormat: 'RAW' },
  { tier: 'OPERATIONAL', dataType: 'LOGS', retentionDays: 90, aggregateBeforeArchival: false, archivalFormat: 'RAW' },
  { tier: 'OPERATIONAL', dataType: 'LLM_OBSERVATIONS', retentionDays: 90, aggregateBeforeArchival: false, archivalFormat: 'RAW' },
  { tier: 'AGGREGATE_AUDIT', dataType: 'TRACES', retentionDays: 2555, aggregateBeforeArchival: true, archivalFormat: 'ICEBERG' },
  { tier: 'AGGREGATE_AUDIT', dataType: 'METRICS', retentionDays: 2555, aggregateBeforeArchival: true, archivalFormat: 'ICEBERG' },
  { tier: 'AGGREGATE_AUDIT', dataType: 'LOGS', retentionDays: 2555, aggregateBeforeArchival: true, archivalFormat: 'PARQUET' },
  { tier: 'AGGREGATE_AUDIT', dataType: 'LLM_OBSERVATIONS', retentionDays: 2555, aggregateBeforeArchival: true, archivalFormat: 'ICEBERG' },
];

// ──────────────────────────────────────────────────────────────────────────────
// Adapter Interfaces (Dependency Injection)
// ──────────────────────────────────────────────────────────────────────────────

/** Adapter for persisting spans. */
export interface SpanStore {
  /** Persist a completed span. */
  save(span: Span): Promise<void>;
  /** Query spans by trace ID. */
  getByTraceId(traceId: string): Promise<Span[]>;
  /** Query spans by service within a time window. */
  getByService(serviceId: string, from: ISO8601, to: ISO8601): Promise<Span[]>;
}

/** Adapter for persisting AI metrics. */
export interface AIMetricsStore {
  /** Record a metric data point. */
  record(dataPoint: AIMetricDataPoint): Promise<void>;
  /** Query metrics for a service and metric type in a time window. */
  query(serviceId: string, metricType: AIMetricType, from: ISO8601, to: ISO8601): Promise<AIMetricDataPoint[]>;
  /** Get aggregated summary for a time window. */
  getSummary(serviceId: string, metricType: AIMetricType, from: ISO8601, to: ISO8601): Promise<AIMetricSummary | null>;
}

/** Adapter for persisting LLM observations. */
export interface LLMObservationStore {
  /** Persist an LLM observation. */
  save(observation: LLMObservation): Promise<void>;
  /** Query observations by service in a time window. */
  getByService(serviceId: string, from: ISO8601, to: ISO8601): Promise<LLMObservation[]>;
  /** Query observations by trace ID. */
  getByTraceId(traceId: string): Promise<LLMObservation[]>;
}

/** Adapter for emitting alerts to on-call teams. */
export interface AlertNotifier {
  /** Emit an alert to the on-call team. */
  notify(alert: ObservabilityAlert): Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Service Configuration
// ──────────────────────────────────────────────────────────────────────────────

/** Configuration for the Observability Service. */
export interface ObservabilityServiceConfig {
  /** Service identifier. */
  serviceId: string;
  /** Service version. */
  serviceVersion: string;
  /** Default jurisdiction for this service instance. */
  defaultJurisdiction: Jurisdiction;
  /** Maximum alert latency target in milliseconds (Req 25.4: 60 seconds). */
  maxAlertLatencyMs: number;
  /** Evaluation interval for threshold checks in milliseconds. */
  evaluationIntervalMs: number;
  /** Retention policies. */
  retentionPolicies: RetentionPolicy[];
  /** Alert thresholds. */
  alertThresholds: AlertThreshold[];
}

/** Default observability service configuration. */
export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityServiceConfig = {
  serviceId: 'observability-service',
  serviceVersion: '1.0.0',
  defaultJurisdiction: 'IN',
  maxAlertLatencyMs: 60_000, // 60 seconds per Req 25.4
  evaluationIntervalMs: 10_000, // Evaluate every 10 seconds
  retentionPolicies: DEFAULT_RETENTION_POLICIES,
  alertThresholds: [],
};
