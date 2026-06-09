/**
 * OpenTelemetry Observability Service
 *
 * Provides unified observability across all platform services including:
 * - Distributed tracing with W3C Trace Context propagation (Req 25.1)
 * - AI-specific metrics via Prometheus-compatible endpoints (Req 25.2)
 * - LLM-specific observability: tokens, routing, guardrails, cost (Req 25.3)
 * - Alerting within 60 seconds of threshold breach (Req 25.4)
 * - Retention: 90 days operational, 7 years aggregate for audit (Req 25.5)
 *
 * Requirements: 25.1, 25.2, 25.3, 25.4, 25.5
 */

import type {
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
  AlertThreshold,
  ObservabilityAlert,
  AlertSeverity,
  AlertCategory,
  RetentionPolicy,
  RetentionTier,
  SpanStore,
  AIMetricsStore,
  LLMObservationStore,
  AlertNotifier,
  ObservabilityServiceConfig,
} from './types.js';

import { DEFAULT_OBSERVABILITY_CONFIG } from './types.js';

import type { ISO8601, Jurisdiction } from '@afg/shared-types';

// ──────────────────────────────────────────────────────────────────────────────
// Service Implementation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * ObservabilityService provides unified OpenTelemetry-based observability
 * for the AFG AI/ML Banking Platform.
 *
 * Implements distributed tracing across synchronous, asynchronous, and batch
 * processing paths with AI/LLM-specific metrics and alerting.
 */
export class ObservabilityService {
  private readonly config: ObservabilityServiceConfig;
  private readonly spanStore: SpanStore;
  private readonly metricsStore: AIMetricsStore;
  private readonly llmObservationStore: LLMObservationStore;
  private readonly alertNotifier: AlertNotifier;

  constructor(
    spanStore: SpanStore,
    metricsStore: AIMetricsStore,
    llmObservationStore: LLMObservationStore,
    alertNotifier: AlertNotifier,
    config?: Partial<ObservabilityServiceConfig>
  ) {
    const baseConfig = { ...DEFAULT_OBSERVABILITY_CONFIG };
    if (config) {
      Object.assign(baseConfig, config);
    }
    // Always create fresh arrays to prevent cross-instance mutation
    baseConfig.retentionPolicies = config?.retentionPolicies
      ? [...config.retentionPolicies]
      : DEFAULT_OBSERVABILITY_CONFIG.retentionPolicies.map((p) => ({ ...p }));
    baseConfig.alertThresholds = config?.alertThresholds
      ? [...config.alertThresholds]
      : [];

    this.config = baseConfig;
    this.spanStore = spanStore;
    this.metricsStore = metricsStore;
    this.llmObservationStore = llmObservationStore;
    this.alertNotifier = alertNotifier;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Distributed Tracing (Req 25.1)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Create a new trace context for a root span.
   *
   * Generates W3C-compatible trace and span identifiers.
   */
  createTraceContext(): TraceContext {
    return {
      traceId: this.generateTraceId(),
      spanId: this.generateSpanId(),
      parentSpanId: undefined,
      traceFlags: 1, // sampled
    };
  }

  /**
   * Create a child trace context from an existing parent.
   *
   * Propagates trace context through synchronous, async, and batch paths.
   */
  createChildContext(parentContext: TraceContext): TraceContext {
    return {
      traceId: parentContext.traceId,
      spanId: this.generateSpanId(),
      parentSpanId: parentContext.spanId,
      traceFlags: parentContext.traceFlags,
    };
  }

  /**
   * Start a new span for a distributed trace.
   *
   * Supports all three processing paths: SYNCHRONOUS, ASYNCHRONOUS, BATCH.
   */
  startSpan(params: {
    traceContext: TraceContext;
    operationName: string;
    serviceId: string;
    processingPath: ProcessingPath;
    attributes?: Record<string, string | number | boolean>;
    jurisdiction?: Jurisdiction;
  }): Span {
    const now = new Date().toISOString();

    return {
      spanId: params.traceContext.spanId,
      traceId: params.traceContext.traceId,
      parentSpanId: params.traceContext.parentSpanId,
      operationName: params.operationName,
      serviceId: params.serviceId,
      startTime: now,
      endTime: undefined,
      durationMs: undefined,
      processingPath: params.processingPath,
      status: 'UNSET',
      attributes: params.attributes ?? {},
      events: [],
      jurisdiction: params.jurisdiction ?? this.config.defaultJurisdiction,
    };
  }

  /**
   * End a span and persist it.
   *
   * Computes duration and sets the final status.
   */
  async endSpan(span: Span, status: SpanStatus = 'OK'): Promise<Span> {
    const endTime = new Date().toISOString();
    const durationMs = new Date(endTime).getTime() - new Date(span.startTime).getTime();

    const completedSpan: Span = {
      ...span,
      endTime,
      durationMs,
      status,
    };

    await this.spanStore.save(completedSpan);
    return completedSpan;
  }

  /**
   * Add an event (log entry) to an active span.
   */
  addSpanEvent(span: Span, event: SpanEvent): Span {
    return {
      ...span,
      events: [...span.events, event],
    };
  }

  /**
   * Retrieve all spans for a given trace.
   */
  async getTrace(traceId: string): Promise<Span[]> {
    if (!traceId || traceId.trim() === '') {
      throw new Error('traceId is required');
    }
    return this.spanStore.getByTraceId(traceId);
  }

  /**
   * Retrieve spans for a service within a time window.
   */
  async getServiceSpans(serviceId: string, from: ISO8601, to: ISO8601): Promise<Span[]> {
    if (!serviceId || serviceId.trim() === '') {
      throw new Error('serviceId is required');
    }
    return this.spanStore.getByService(serviceId, from, to);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AI-Specific Metrics (Req 25.2)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record an AI-specific metric data point.
   *
   * Supports: model latency, token throughput, inference error rate,
   * groundedness scores, and drift indicators.
   */
  async recordAIMetric(params: {
    metricType: AIMetricType;
    serviceId: string;
    modelId: string;
    modelVersion: string;
    value: number;
    unit: string;
    labels?: Record<string, string>;
    jurisdiction?: Jurisdiction;
  }): Promise<AIMetricDataPoint> {
    this.validateMetricParams(params);

    const dataPoint: AIMetricDataPoint = {
      metricType: params.metricType,
      serviceId: params.serviceId,
      modelId: params.modelId,
      modelVersion: params.modelVersion,
      timestamp: new Date().toISOString(),
      value: params.value,
      unit: params.unit,
      labels: params.labels ?? {},
      jurisdiction: params.jurisdiction ?? this.config.defaultJurisdiction,
    };

    await this.metricsStore.record(dataPoint);

    // Check thresholds for alerting (Req 25.4)
    await this.evaluateThresholds(dataPoint);

    return dataPoint;
  }

  /**
   * Get aggregated metric summary for a service and metric type.
   */
  async getMetricSummary(
    serviceId: string,
    metricType: AIMetricType,
    from: ISO8601,
    to: ISO8601
  ): Promise<AIMetricSummary | null> {
    if (!serviceId || serviceId.trim() === '') {
      throw new Error('serviceId is required');
    }
    return this.metricsStore.getSummary(serviceId, metricType, from, to);
  }

  /**
   * Query raw metric data points.
   */
  async queryMetrics(
    serviceId: string,
    metricType: AIMetricType,
    from: ISO8601,
    to: ISO8601
  ): Promise<AIMetricDataPoint[]> {
    return this.metricsStore.query(serviceId, metricType, from, to);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LLM-Specific Observability (Req 25.3)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record an LLM inference observation.
   *
   * Captures prompt/completion tokens, routing decisions, guardrail triggers,
   * and cost-per-inference for every LLM call.
   */
  async recordLLMObservation(params: {
    observationId: string;
    traceId: string;
    serviceId: string;
    modelId: string;
    modelVersion: string;
    promptTokens: number;
    completionTokens: number;
    routingDecision: RoutingDecision;
    guardrailTriggers: GuardrailTrigger[];
    costPerInference: number;
    latencyMs: number;
    cacheHit: boolean;
    jurisdiction?: Jurisdiction;
  }): Promise<LLMObservation> {
    this.validateLLMObservationParams(params);

    const observation: LLMObservation = {
      observationId: params.observationId,
      traceId: params.traceId,
      serviceId: params.serviceId,
      timestamp: new Date().toISOString(),
      modelId: params.modelId,
      modelVersion: params.modelVersion,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens: params.promptTokens + params.completionTokens,
      routingDecision: params.routingDecision,
      guardrailTriggers: params.guardrailTriggers,
      costPerInference: params.costPerInference,
      latencyMs: params.latencyMs,
      cacheHit: params.cacheHit,
      jurisdiction: params.jurisdiction ?? this.config.defaultJurisdiction,
    };

    await this.llmObservationStore.save(observation);

    // Record related AI metrics automatically
    await this.recordAIMetric({
      metricType: 'MODEL_LATENCY',
      serviceId: params.serviceId,
      modelId: params.modelId,
      modelVersion: params.modelVersion,
      value: params.latencyMs,
      unit: 'ms',
      labels: { cacheHit: String(params.cacheHit) },
      jurisdiction: params.jurisdiction,
    });

    await this.recordAIMetric({
      metricType: 'TOKEN_THROUGHPUT',
      serviceId: params.serviceId,
      modelId: params.modelId,
      modelVersion: params.modelVersion,
      value: params.promptTokens + params.completionTokens,
      unit: 'tokens',
      labels: { promptTokens: String(params.promptTokens), completionTokens: String(params.completionTokens) },
      jurisdiction: params.jurisdiction,
    });

    return observation;
  }

  /**
   * Query LLM observations by service within a time window.
   */
  async getLLMObservations(serviceId: string, from: ISO8601, to: ISO8601): Promise<LLMObservation[]> {
    if (!serviceId || serviceId.trim() === '') {
      throw new Error('serviceId is required');
    }
    return this.llmObservationStore.getByService(serviceId, from, to);
  }

  /**
   * Query LLM observations by trace ID for correlation.
   */
  async getLLMObservationsByTrace(traceId: string): Promise<LLMObservation[]> {
    if (!traceId || traceId.trim() === '') {
      throw new Error('traceId is required');
    }
    return this.llmObservationStore.getByTraceId(traceId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Alerting (Req 25.4)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Register an alert threshold for monitoring.
   */
  registerThreshold(threshold: AlertThreshold): void {
    if (!threshold.thresholdId || threshold.thresholdId.trim() === '') {
      throw new Error('thresholdId is required');
    }
    if (!threshold.serviceId || threshold.serviceId.trim() === '') {
      throw new Error('threshold.serviceId is required');
    }
    if (threshold.evaluationWindowSeconds <= 0) {
      throw new Error('evaluationWindowSeconds must be positive');
    }

    // Replace existing threshold with same ID, or add new one
    const existingIdx = this.config.alertThresholds.findIndex(
      (t) => t.thresholdId === threshold.thresholdId
    );
    if (existingIdx >= 0) {
      this.config.alertThresholds[existingIdx] = threshold;
    } else {
      this.config.alertThresholds.push(threshold);
    }
  }

  /**
   * Remove a registered alert threshold.
   */
  removeThreshold(thresholdId: string): boolean {
    const idx = this.config.alertThresholds.findIndex((t) => t.thresholdId === thresholdId);
    if (idx >= 0) {
      this.config.alertThresholds.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Evaluate a metric data point against all registered thresholds.
   *
   * Emits an alert within 60 seconds of threshold breach (Req 25.4).
   *
   * @returns Array of alerts emitted
   */
  async evaluateThresholds(dataPoint: AIMetricDataPoint): Promise<ObservabilityAlert[]> {
    const alerts: ObservabilityAlert[] = [];
    const breachTime = new Date();

    const matchingThresholds = this.config.alertThresholds.filter(
      (t) => t.serviceId === dataPoint.serviceId &&
        (t.metricType === dataPoint.metricType || t.metricType === '*')
    );

    for (const threshold of matchingThresholds) {
      const breached = this.isThresholdBreached(threshold, dataPoint.value);

      if (breached) {
        const alertLatencyMs = Date.now() - breachTime.getTime();

        const alert: ObservabilityAlert = {
          alertId: `alert-${threshold.thresholdId}-${breachTime.getTime()}`,
          thresholdId: threshold.thresholdId,
          serviceId: dataPoint.serviceId,
          category: threshold.category,
          severity: threshold.severity,
          currentValue: dataPoint.value,
          thresholdValue: threshold.thresholdValue,
          detectedAt: breachTime.toISOString(),
          alertLatencyMs,
          summary: `${threshold.category} threshold breached for ${dataPoint.serviceId}: ` +
            `${dataPoint.metricType} = ${dataPoint.value} (threshold: ${threshold.operator} ${threshold.thresholdValue})`,
          jurisdiction: dataPoint.jurisdiction,
        };

        await this.alertNotifier.notify(alert);
        alerts.push(alert);
      }
    }

    return alerts;
  }

  /**
   * Get all registered alert thresholds.
   */
  getRegisteredThresholds(): AlertThreshold[] {
    return [...this.config.alertThresholds];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Retention Policy (Req 25.5)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get retention policies for the platform.
   *
   * Operational data: 90 days.
   * Aggregate audit data: 7 years (2555 days).
   */
  getRetentionPolicies(): RetentionPolicy[] {
    return [...this.config.retentionPolicies];
  }

  /**
   * Get the retention period in days for a specific data type and tier.
   */
  getRetentionDays(dataType: RetentionPolicy['dataType'], tier: RetentionTier): number {
    const policy = this.config.retentionPolicies.find(
      (p) => p.dataType === dataType && p.tier === tier
    );
    return policy?.retentionDays ?? 0;
  }

  /**
   * Compute the expiry timestamp for data based on retention policy.
   */
  computeExpiryDate(createdAt: ISO8601, dataType: RetentionPolicy['dataType'], tier: RetentionTier): ISO8601 {
    const retentionDays = this.getRetentionDays(dataType, tier);
    const created = new Date(createdAt);
    const expiry = new Date(created.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    return expiry.toISOString();
  }

  /**
   * Determine if a data point should be archived based on its age and retention tier.
   */
  shouldArchive(createdAt: ISO8601, dataType: RetentionPolicy['dataType']): boolean {
    const operationalRetentionDays = this.getRetentionDays(dataType, 'OPERATIONAL');
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    return ageDays > operationalRetentionDays;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Configuration Access
  // ──────────────────────────────────────────────────────────────────────────

  /** Get current service configuration. */
  getConfig(): ObservabilityServiceConfig {
    return { ...this.config };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Generate a W3C-compatible trace ID (32 hex characters).
   */
  private generateTraceId(): string {
    return this.generateHexString(32);
  }

  /**
   * Generate a span ID (16 hex characters).
   */
  private generateSpanId(): string {
    return this.generateHexString(16);
  }

  /**
   * Generate a random hex string of specified length.
   */
  private generateHexString(length: number): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * 16)];
    }
    return result;
  }

  /**
   * Check whether a threshold is breached given a metric value.
   */
  private isThresholdBreached(threshold: AlertThreshold, value: number): boolean {
    switch (threshold.operator) {
      case 'GREATER_THAN':
        return value > threshold.thresholdValue;
      case 'LESS_THAN':
        return value < threshold.thresholdValue;
      case 'EQUALS':
        return value === threshold.thresholdValue;
      default:
        return false;
    }
  }

  private validateMetricParams(params: {
    metricType: AIMetricType;
    serviceId: string;
    modelId: string;
    modelVersion: string;
    value: number;
    unit: string;
  }): void {
    if (!params.serviceId || params.serviceId.trim() === '') {
      throw new Error('serviceId is required');
    }
    if (!params.modelId || params.modelId.trim() === '') {
      throw new Error('modelId is required');
    }
    if (!params.modelVersion || params.modelVersion.trim() === '') {
      throw new Error('modelVersion is required');
    }
    if (!params.unit || params.unit.trim() === '') {
      throw new Error('unit is required');
    }
    if (typeof params.value !== 'number' || isNaN(params.value)) {
      throw new Error('value must be a valid number');
    }
  }

  private validateLLMObservationParams(params: {
    observationId: string;
    traceId: string;
    serviceId: string;
    modelId: string;
    modelVersion: string;
    promptTokens: number;
    completionTokens: number;
    costPerInference: number;
    latencyMs: number;
  }): void {
    if (!params.observationId || params.observationId.trim() === '') {
      throw new Error('observationId is required');
    }
    if (!params.traceId || params.traceId.trim() === '') {
      throw new Error('traceId is required');
    }
    if (!params.serviceId || params.serviceId.trim() === '') {
      throw new Error('serviceId is required');
    }
    if (!params.modelId || params.modelId.trim() === '') {
      throw new Error('modelId is required');
    }
    if (!params.modelVersion || params.modelVersion.trim() === '') {
      throw new Error('modelVersion is required');
    }
    if (params.promptTokens < 0) {
      throw new Error('promptTokens must be non-negative');
    }
    if (params.completionTokens < 0) {
      throw new Error('completionTokens must be non-negative');
    }
    if (params.costPerInference < 0) {
      throw new Error('costPerInference must be non-negative');
    }
    if (params.latencyMs < 0) {
      throw new Error('latencyMs must be non-negative');
    }
  }
}
