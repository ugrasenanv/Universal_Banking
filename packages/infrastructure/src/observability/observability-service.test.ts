/**
 * Unit tests for the OpenTelemetry Observability Service
 *
 * Tests distributed tracing, AI-specific metrics, LLM-specific observability,
 * alerting, and retention policy enforcement.
 *
 * Requirements: 25.1, 25.2, 25.3, 25.4, 25.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObservabilityService } from './observability-service.js';
import type {
  Span,
  SpanStore,
  AIMetricsStore,
  LLMObservationStore,
  AlertNotifier,
  AIMetricDataPoint,
  AIMetricSummary,
  LLMObservation,
  AlertThreshold,
  ObservabilityServiceConfig,
} from './types.js';
import { DEFAULT_RETENTION_POLICIES } from './types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test Helpers - In-memory adapters
// ──────────────────────────────────────────────────────────────────────────────

function createMockSpanStore(): SpanStore & { spans: Span[] } {
  const spans: Span[] = [];
  return {
    spans,
    save: vi.fn(async (span: Span) => { spans.push(span); }),
    getByTraceId: vi.fn(async (traceId: string) => spans.filter((s) => s.traceId === traceId)),
    getByService: vi.fn(async (serviceId: string, from: string, to: string) =>
      spans.filter(
        (s) =>
          s.serviceId === serviceId &&
          new Date(s.startTime) >= new Date(from) &&
          new Date(s.startTime) <= new Date(to)
      )
    ),
  };
}

function createMockMetricsStore(): AIMetricsStore & { dataPoints: AIMetricDataPoint[] } {
  const dataPoints: AIMetricDataPoint[] = [];
  return {
    dataPoints,
    record: vi.fn(async (dp: AIMetricDataPoint) => { dataPoints.push(dp); }),
    query: vi.fn(async (serviceId: string, metricType: string, from: string, to: string) =>
      dataPoints.filter(
        (dp) =>
          dp.serviceId === serviceId &&
          dp.metricType === metricType &&
          new Date(dp.timestamp) >= new Date(from) &&
          new Date(dp.timestamp) <= new Date(to)
      )
    ),
    getSummary: vi.fn(async (serviceId: string, metricType: string, from: string, to: string) => {
      const matching = dataPoints.filter(
        (dp) =>
          dp.serviceId === serviceId &&
          dp.metricType === metricType &&
          new Date(dp.timestamp) >= new Date(from) &&
          new Date(dp.timestamp) <= new Date(to)
      );
      if (matching.length === 0) return null;
      const values = matching.map((dp) => dp.value).sort((a, b) => a - b);
      const sum = values.reduce((s, v) => s + v, 0);
      return {
        metricType,
        serviceId,
        modelId: matching[0].modelId,
        windowStart: from,
        windowEnd: to,
        count: values.length,
        mean: sum / values.length,
        p50: values[Math.floor(values.length * 0.5)],
        p95: values[Math.floor(values.length * 0.95)],
        p99: values[Math.floor(values.length * 0.99)],
        min: values[0],
        max: values[values.length - 1],
      } as AIMetricSummary;
    }),
  };
}

function createMockLLMStore(): LLMObservationStore & { observations: LLMObservation[] } {
  const observations: LLMObservation[] = [];
  return {
    observations,
    save: vi.fn(async (obs: LLMObservation) => { observations.push(obs); }),
    getByService: vi.fn(async (serviceId: string, from: string, to: string) =>
      observations.filter(
        (o) =>
          o.serviceId === serviceId &&
          new Date(o.timestamp) >= new Date(from) &&
          new Date(o.timestamp) <= new Date(to)
      )
    ),
    getByTraceId: vi.fn(async (traceId: string) => observations.filter((o) => o.traceId === traceId)),
  };
}

function createMockAlertNotifier(): AlertNotifier & { alerts: any[] } {
  const alerts: any[] = [];
  return {
    alerts,
    notify: vi.fn(async (alert) => { alerts.push(alert); }),
  };
}

function createService(configOverrides?: Partial<ObservabilityServiceConfig>) {
  const spanStore = createMockSpanStore();
  const metricsStore = createMockMetricsStore();
  const llmStore = createMockLLMStore();
  const alertNotifier = createMockAlertNotifier();

  const service = new ObservabilityService(
    spanStore,
    metricsStore,
    llmStore,
    alertNotifier,
    configOverrides
  );

  return { service, spanStore, metricsStore, llmStore, alertNotifier };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Distributed Tracing (Req 25.1)
// ──────────────────────────────────────────────────────────────────────────────

describe('ObservabilityService - Distributed Tracing (Req 25.1)', () => {
  it('should create a root trace context with valid W3C identifiers', () => {
    const { service } = createService();

    const ctx = service.createTraceContext();

    expect(ctx.traceId).toHaveLength(32);
    expect(ctx.spanId).toHaveLength(16);
    expect(ctx.parentSpanId).toBeUndefined();
    expect(ctx.traceFlags).toBe(1);
    // W3C trace-id is 32 lowercase hex chars
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should create a child context propagating trace ID', () => {
    const { service } = createService();

    const parent = service.createTraceContext();
    const child = service.createChildContext(parent);

    expect(child.traceId).toBe(parent.traceId);
    expect(child.spanId).toHaveLength(16);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.traceFlags).toBe(parent.traceFlags);
  });

  it('should start a span for synchronous processing path', () => {
    const { service } = createService();

    const ctx = service.createTraceContext();
    const span = service.startSpan({
      traceContext: ctx,
      operationName: 'fraud.score',
      serviceId: 'fraud-inference-service',
      processingPath: 'SYNCHRONOUS',
      attributes: { channel: 'UPI', amount: 5000 },
    });

    expect(span.spanId).toBe(ctx.spanId);
    expect(span.traceId).toBe(ctx.traceId);
    expect(span.operationName).toBe('fraud.score');
    expect(span.serviceId).toBe('fraud-inference-service');
    expect(span.processingPath).toBe('SYNCHRONOUS');
    expect(span.status).toBe('UNSET');
    expect(span.startTime).toBeDefined();
    expect(span.endTime).toBeUndefined();
    expect(span.attributes.channel).toBe('UPI');
  });

  it('should start a span for asynchronous processing path', () => {
    const { service } = createService();

    const ctx = service.createTraceContext();
    const span = service.startSpan({
      traceContext: ctx,
      operationName: 'audit.persist',
      serviceId: 'audit-service',
      processingPath: 'ASYNCHRONOUS',
    });

    expect(span.processingPath).toBe('ASYNCHRONOUS');
  });

  it('should start a span for batch processing path', () => {
    const { service } = createService();

    const ctx = service.createTraceContext();
    const span = service.startSpan({
      traceContext: ctx,
      operationName: 'mainframe.batch-extract',
      serviceId: 'mainframe-facade',
      processingPath: 'BATCH',
    });

    expect(span.processingPath).toBe('BATCH');
  });

  it('should end a span with computed duration and persist it', async () => {
    const { service, spanStore } = createService();

    const ctx = service.createTraceContext();
    const span = service.startSpan({
      traceContext: ctx,
      operationName: 'fraud.score',
      serviceId: 'fraud-inference-service',
      processingPath: 'SYNCHRONOUS',
    });

    const completed = await service.endSpan(span, 'OK');

    expect(completed.endTime).toBeDefined();
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
    expect(completed.status).toBe('OK');
    expect(spanStore.save).toHaveBeenCalledWith(completed);
    expect(spanStore.spans).toHaveLength(1);
  });

  it('should end a span with ERROR status', async () => {
    const { service } = createService();

    const ctx = service.createTraceContext();
    const span = service.startSpan({
      traceContext: ctx,
      operationName: 'credit.score',
      serviceId: 'credit-service',
      processingPath: 'SYNCHRONOUS',
    });

    const completed = await service.endSpan(span, 'ERROR');

    expect(completed.status).toBe('ERROR');
  });

  it('should add events to a span', () => {
    const { service } = createService();

    const ctx = service.createTraceContext();
    let span = service.startSpan({
      traceContext: ctx,
      operationName: 'fraud.score',
      serviceId: 'fraud-inference-service',
      processingPath: 'SYNCHRONOUS',
    });

    span = service.addSpanEvent(span, {
      name: 'feature_store_lookup',
      timestamp: new Date().toISOString(),
      attributes: { featureGroup: 'txn_velocity_30d', latencyMs: 5 },
    });

    expect(span.events).toHaveLength(1);
    expect(span.events[0].name).toBe('feature_store_lookup');
  });

  it('should retrieve spans by trace ID', async () => {
    const { service, spanStore } = createService();

    const ctx = service.createTraceContext();
    const span1 = service.startSpan({
      traceContext: ctx,
      operationName: 'fraud.score',
      serviceId: 'fraud-service',
      processingPath: 'SYNCHRONOUS',
    });
    await service.endSpan(span1);

    const childCtx = service.createChildContext(ctx);
    const span2 = service.startSpan({
      traceContext: childCtx,
      operationName: 'feature.lookup',
      serviceId: 'feature-store',
      processingPath: 'SYNCHRONOUS',
    });
    await service.endSpan(span2);

    const trace = await service.getTrace(ctx.traceId);
    expect(trace).toHaveLength(2);
  });

  it('should throw on empty traceId for getTrace', async () => {
    const { service } = createService();
    await expect(service.getTrace('')).rejects.toThrow('traceId is required');
  });

  it('should use default jurisdiction from config', () => {
    const { service } = createService({ defaultJurisdiction: 'SG' });

    const ctx = service.createTraceContext();
    const span = service.startSpan({
      traceContext: ctx,
      operationName: 'test.op',
      serviceId: 'test-service',
      processingPath: 'SYNCHRONOUS',
    });

    expect(span.jurisdiction).toBe('SG');
  });

  it('should override jurisdiction when explicitly provided', () => {
    const { service } = createService({ defaultJurisdiction: 'IN' });

    const ctx = service.createTraceContext();
    const span = service.startSpan({
      traceContext: ctx,
      operationName: 'test.op',
      serviceId: 'test-service',
      processingPath: 'SYNCHRONOUS',
      jurisdiction: 'GB',
    });

    expect(span.jurisdiction).toBe('GB');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: AI-Specific Metrics (Req 25.2)
// ──────────────────────────────────────────────────────────────────────────────

describe('ObservabilityService - AI-Specific Metrics (Req 25.2)', () => {
  it('should record model latency metric', async () => {
    const { service, metricsStore } = createService();

    const dp = await service.recordAIMetric({
      metricType: 'MODEL_LATENCY',
      serviceId: 'fraud-inference-service',
      modelId: 'fraud-v3',
      modelVersion: '3.1.0',
      value: 45.2,
      unit: 'ms',
    });

    expect(dp.metricType).toBe('MODEL_LATENCY');
    expect(dp.value).toBe(45.2);
    expect(dp.unit).toBe('ms');
    expect(dp.timestamp).toBeDefined();
    expect(metricsStore.record).toHaveBeenCalledTimes(1);
  });

  it('should record token throughput metric', async () => {
    const { service } = createService();

    const dp = await service.recordAIMetric({
      metricType: 'TOKEN_THROUGHPUT',
      serviceId: 'llm-gateway',
      modelId: 'gpt-4',
      modelVersion: '2024-01',
      value: 1250,
      unit: 'tokens',
    });

    expect(dp.metricType).toBe('TOKEN_THROUGHPUT');
    expect(dp.value).toBe(1250);
  });

  it('should record inference error rate metric', async () => {
    const { service } = createService();

    const dp = await service.recordAIMetric({
      metricType: 'INFERENCE_ERROR_RATE',
      serviceId: 'credit-underwriting',
      modelId: 'credit-scorer-v2',
      modelVersion: '2.0.1',
      value: 0.003,
      unit: 'ratio',
    });

    expect(dp.metricType).toBe('INFERENCE_ERROR_RATE');
    expect(dp.value).toBe(0.003);
  });

  it('should record groundedness score metric', async () => {
    const { service } = createService();

    const dp = await service.recordAIMetric({
      metricType: 'GROUNDEDNESS_SCORE',
      serviceId: 'rag-pipeline',
      modelId: 'embedder-v2',
      modelVersion: '1.0.0',
      value: 0.85,
      unit: 'score',
    });

    expect(dp.metricType).toBe('GROUNDEDNESS_SCORE');
    expect(dp.value).toBe(0.85);
  });

  it('should record drift indicator metric', async () => {
    const { service } = createService();

    const dp = await service.recordAIMetric({
      metricType: 'DRIFT_INDICATOR',
      serviceId: 'fraud-inference-service',
      modelId: 'fraud-v3',
      modelVersion: '3.1.0',
      value: 0.12,
      unit: 'psi',
      labels: { featureGroup: 'txn_velocity_30d' },
    });

    expect(dp.metricType).toBe('DRIFT_INDICATOR');
    expect(dp.labels.featureGroup).toBe('txn_velocity_30d');
  });

  it('should attach labels for Prometheus compatibility', async () => {
    const { service } = createService();

    const dp = await service.recordAIMetric({
      metricType: 'MODEL_LATENCY',
      serviceId: 'fraud-service',
      modelId: 'fraud-v3',
      modelVersion: '3.1.0',
      value: 50,
      unit: 'ms',
      labels: { channel: 'UPI', region: 'IN-MUM' },
    });

    expect(dp.labels.channel).toBe('UPI');
    expect(dp.labels.region).toBe('IN-MUM');
  });

  it('should throw on empty serviceId', async () => {
    const { service } = createService();

    await expect(
      service.recordAIMetric({
        metricType: 'MODEL_LATENCY',
        serviceId: '',
        modelId: 'fraud-v3',
        modelVersion: '3.1.0',
        value: 50,
        unit: 'ms',
      })
    ).rejects.toThrow('serviceId is required');
  });

  it('should throw on empty modelId', async () => {
    const { service } = createService();

    await expect(
      service.recordAIMetric({
        metricType: 'MODEL_LATENCY',
        serviceId: 'fraud-service',
        modelId: '',
        modelVersion: '3.1.0',
        value: 50,
        unit: 'ms',
      })
    ).rejects.toThrow('modelId is required');
  });

  it('should throw on NaN value', async () => {
    const { service } = createService();

    await expect(
      service.recordAIMetric({
        metricType: 'MODEL_LATENCY',
        serviceId: 'fraud-service',
        modelId: 'fraud-v3',
        modelVersion: '3.1.0',
        value: NaN,
        unit: 'ms',
      })
    ).rejects.toThrow('value must be a valid number');
  });

  it('should get metric summary for a time window', async () => {
    const { service, metricsStore } = createService();

    // Pre-populate with some data points
    const now = new Date();
    for (let i = 0; i < 10; i++) {
      metricsStore.dataPoints.push({
        metricType: 'MODEL_LATENCY',
        serviceId: 'fraud-service',
        modelId: 'fraud-v3',
        modelVersion: '3.1.0',
        timestamp: new Date(now.getTime() - i * 1000).toISOString(),
        value: 40 + i * 5,
        unit: 'ms',
        labels: {},
        jurisdiction: 'IN',
      });
    }

    const summary = await service.getMetricSummary(
      'fraud-service',
      'MODEL_LATENCY',
      new Date(now.getTime() - 20000).toISOString(),
      now.toISOString()
    );

    expect(summary).not.toBeNull();
    expect(summary!.count).toBe(10);
    expect(summary!.min).toBeLessThanOrEqual(summary!.max);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: LLM-Specific Observability (Req 25.3)
// ──────────────────────────────────────────────────────────────────────────────

describe('ObservabilityService - LLM-Specific Observability (Req 25.3)', () => {
  it('should record an LLM observation with all fields', async () => {
    const { service, llmStore } = createService();

    const obs = await service.recordLLMObservation({
      observationId: 'obs-001',
      traceId: 'trace-001',
      serviceId: 'llm-gateway',
      modelId: 'gpt-4',
      modelVersion: '2024-01',
      promptTokens: 500,
      completionTokens: 200,
      routingDecision: {
        requestedQuality: 'HIGH',
        requestedCostCeiling: 'MEDIUM',
        selectedModel: 'gpt-4',
        selectionReason: 'Quality floor met, lowest cost option',
        jurisdictionConstrained: false,
      },
      guardrailTriggers: [
        { checkType: 'PII_REDACTION', direction: 'INPUT', blocked: false, confidence: 0.95 },
      ],
      costPerInference: 0.045,
      latencyMs: 1200,
      cacheHit: false,
    });

    expect(obs.observationId).toBe('obs-001');
    expect(obs.promptTokens).toBe(500);
    expect(obs.completionTokens).toBe(200);
    expect(obs.totalTokens).toBe(700);
    expect(obs.routingDecision.selectedModel).toBe('gpt-4');
    expect(obs.guardrailTriggers).toHaveLength(1);
    expect(obs.costPerInference).toBe(0.045);
    expect(obs.latencyMs).toBe(1200);
    expect(obs.cacheHit).toBe(false);
    expect(llmStore.save).toHaveBeenCalledTimes(1);
  });

  it('should auto-record MODEL_LATENCY and TOKEN_THROUGHPUT metrics from LLM observation', async () => {
    const { service, metricsStore } = createService();

    await service.recordLLMObservation({
      observationId: 'obs-002',
      traceId: 'trace-002',
      serviceId: 'llm-gateway',
      modelId: 'llama-70b',
      modelVersion: '2.0',
      promptTokens: 300,
      completionTokens: 150,
      routingDecision: {
        requestedQuality: 'MEDIUM',
        requestedCostCeiling: 'LOW',
        selectedModel: 'llama-70b',
        selectionReason: 'Self-hosted, meets quality floor',
        jurisdictionConstrained: true,
      },
      guardrailTriggers: [],
      costPerInference: 0.01,
      latencyMs: 800,
      cacheHit: false,
    });

    // Should record MODEL_LATENCY + TOKEN_THROUGHPUT automatically
    expect(metricsStore.record).toHaveBeenCalledTimes(2);
    const latencyCall = metricsStore.dataPoints.find((dp) => dp.metricType === 'MODEL_LATENCY');
    const throughputCall = metricsStore.dataPoints.find((dp) => dp.metricType === 'TOKEN_THROUGHPUT');

    expect(latencyCall).toBeDefined();
    expect(latencyCall!.value).toBe(800);
    expect(throughputCall).toBeDefined();
    expect(throughputCall!.value).toBe(450); // 300 + 150
  });

  it('should record cache hit observations', async () => {
    const { service } = createService();

    const obs = await service.recordLLMObservation({
      observationId: 'obs-cache',
      traceId: 'trace-cache',
      serviceId: 'llm-gateway',
      modelId: 'gpt-4',
      modelVersion: '2024-01',
      promptTokens: 100,
      completionTokens: 0,
      routingDecision: {
        requestedQuality: 'HIGH',
        requestedCostCeiling: 'HIGH',
        selectedModel: 'gpt-4',
        selectionReason: 'Cache hit - no inference needed',
        jurisdictionConstrained: false,
      },
      guardrailTriggers: [],
      costPerInference: 0,
      latencyMs: 5,
      cacheHit: true,
    });

    expect(obs.cacheHit).toBe(true);
    expect(obs.costPerInference).toBe(0);
  });

  it('should record guardrail triggers', async () => {
    const { service } = createService();

    const obs = await service.recordLLMObservation({
      observationId: 'obs-guard',
      traceId: 'trace-guard',
      serviceId: 'llm-gateway',
      modelId: 'gpt-4',
      modelVersion: '2024-01',
      promptTokens: 200,
      completionTokens: 0,
      routingDecision: {
        requestedQuality: 'HIGH',
        requestedCostCeiling: 'HIGH',
        selectedModel: 'gpt-4',
        selectionReason: 'Blocked by guardrail',
        jurisdictionConstrained: false,
      },
      guardrailTriggers: [
        { checkType: 'PROMPT_INJECTION', direction: 'INPUT', blocked: true, confidence: 0.98 },
        { checkType: 'JAILBREAK', direction: 'INPUT', blocked: true, confidence: 0.92 },
      ],
      costPerInference: 0,
      latencyMs: 15,
      cacheHit: false,
    });

    expect(obs.guardrailTriggers).toHaveLength(2);
    expect(obs.guardrailTriggers[0].blocked).toBe(true);
  });

  it('should throw on negative promptTokens', async () => {
    const { service } = createService();

    await expect(
      service.recordLLMObservation({
        observationId: 'obs-bad',
        traceId: 'trace-bad',
        serviceId: 'llm-gateway',
        modelId: 'gpt-4',
        modelVersion: '2024-01',
        promptTokens: -1,
        completionTokens: 100,
        routingDecision: {
          requestedQuality: 'HIGH',
          requestedCostCeiling: 'HIGH',
          selectedModel: 'gpt-4',
          selectionReason: 'test',
          jurisdictionConstrained: false,
        },
        guardrailTriggers: [],
        costPerInference: 0.01,
        latencyMs: 100,
        cacheHit: false,
      })
    ).rejects.toThrow('promptTokens must be non-negative');
  });

  it('should throw on empty observationId', async () => {
    const { service } = createService();

    await expect(
      service.recordLLMObservation({
        observationId: '',
        traceId: 'trace-001',
        serviceId: 'llm-gateway',
        modelId: 'gpt-4',
        modelVersion: '2024-01',
        promptTokens: 100,
        completionTokens: 50,
        routingDecision: {
          requestedQuality: 'HIGH',
          requestedCostCeiling: 'HIGH',
          selectedModel: 'gpt-4',
          selectionReason: 'test',
          jurisdictionConstrained: false,
        },
        guardrailTriggers: [],
        costPerInference: 0.01,
        latencyMs: 100,
        cacheHit: false,
      })
    ).rejects.toThrow('observationId is required');
  });

  it('should query LLM observations by service', async () => {
    const { service, llmStore } = createService();

    // Add observations directly
    const now = new Date();
    llmStore.observations.push({
      observationId: 'obs-q1',
      traceId: 'trace-q1',
      serviceId: 'llm-gateway',
      timestamp: now.toISOString(),
      modelId: 'gpt-4',
      modelVersion: '2024-01',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      routingDecision: { requestedQuality: 'HIGH', requestedCostCeiling: 'HIGH', selectedModel: 'gpt-4', selectionReason: 'test', jurisdictionConstrained: false },
      guardrailTriggers: [],
      costPerInference: 0.01,
      latencyMs: 100,
      cacheHit: false,
      jurisdiction: 'IN',
    });

    const results = await service.getLLMObservations(
      'llm-gateway',
      new Date(now.getTime() - 10000).toISOString(),
      new Date(now.getTime() + 10000).toISOString()
    );

    expect(results).toHaveLength(1);
    expect(results[0].observationId).toBe('obs-q1');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Alerting (Req 25.4)
// ──────────────────────────────────────────────────────────────────────────────

describe('ObservabilityService - Alerting (Req 25.4)', () => {
  it('should register an alert threshold', () => {
    const { service } = createService();

    const threshold: AlertThreshold = {
      thresholdId: 'thresh-latency-fraud',
      serviceId: 'fraud-inference-service',
      metricType: 'MODEL_LATENCY',
      category: 'LATENCY',
      thresholdValue: 100,
      operator: 'GREATER_THAN',
      severity: 'HIGH',
      evaluationWindowSeconds: 60,
      description: 'Fraud model latency exceeds 100ms',
    };

    service.registerThreshold(threshold);

    const registered = service.getRegisteredThresholds();
    expect(registered).toHaveLength(1);
    expect(registered[0].thresholdId).toBe('thresh-latency-fraud');
  });

  it('should replace threshold with same ID on re-registration', () => {
    const { service } = createService();

    service.registerThreshold({
      thresholdId: 'thresh-1',
      serviceId: 'fraud-service',
      metricType: 'MODEL_LATENCY',
      category: 'LATENCY',
      thresholdValue: 100,
      operator: 'GREATER_THAN',
      severity: 'HIGH',
      evaluationWindowSeconds: 60,
      description: 'Original',
    });

    service.registerThreshold({
      thresholdId: 'thresh-1',
      serviceId: 'fraud-service',
      metricType: 'MODEL_LATENCY',
      category: 'LATENCY',
      thresholdValue: 150,
      operator: 'GREATER_THAN',
      severity: 'CRITICAL',
      evaluationWindowSeconds: 30,
      description: 'Updated',
    });

    const registered = service.getRegisteredThresholds();
    expect(registered).toHaveLength(1);
    expect(registered[0].thresholdValue).toBe(150);
    expect(registered[0].severity).toBe('CRITICAL');
  });

  it('should remove a threshold', () => {
    const { service } = createService();

    service.registerThreshold({
      thresholdId: 'thresh-remove',
      serviceId: 'test-service',
      metricType: 'MODEL_LATENCY',
      category: 'LATENCY',
      thresholdValue: 100,
      operator: 'GREATER_THAN',
      severity: 'HIGH',
      evaluationWindowSeconds: 60,
      description: 'Test',
    });

    const removed = service.removeThreshold('thresh-remove');
    expect(removed).toBe(true);
    expect(service.getRegisteredThresholds()).toHaveLength(0);
  });

  it('should return false when removing non-existent threshold', () => {
    const { service } = createService();
    expect(service.removeThreshold('non-existent')).toBe(false);
  });

  it('should emit alert when GREATER_THAN threshold is breached', async () => {
    const { service, alertNotifier } = createService();

    service.registerThreshold({
      thresholdId: 'thresh-latency',
      serviceId: 'fraud-inference-service',
      metricType: 'MODEL_LATENCY',
      category: 'LATENCY',
      thresholdValue: 100,
      operator: 'GREATER_THAN',
      severity: 'HIGH',
      evaluationWindowSeconds: 60,
      description: 'Latency exceeded',
    });

    // Record a metric that breaches the threshold
    await service.recordAIMetric({
      metricType: 'MODEL_LATENCY',
      serviceId: 'fraud-inference-service',
      modelId: 'fraud-v3',
      modelVersion: '3.1.0',
      value: 150, // exceeds 100ms threshold
      unit: 'ms',
    });

    expect(alertNotifier.notify).toHaveBeenCalledTimes(1);
    expect(alertNotifier.alerts).toHaveLength(1);
    expect(alertNotifier.alerts[0].thresholdId).toBe('thresh-latency');
    expect(alertNotifier.alerts[0].currentValue).toBe(150);
    expect(alertNotifier.alerts[0].severity).toBe('HIGH');
    expect(alertNotifier.alerts[0].category).toBe('LATENCY');
  });

  it('should emit alert when LESS_THAN threshold is breached', async () => {
    const { service, alertNotifier } = createService();

    service.registerThreshold({
      thresholdId: 'thresh-groundedness',
      serviceId: 'rag-pipeline',
      metricType: 'GROUNDEDNESS_SCORE',
      category: 'DRIFT',
      thresholdValue: 0.7,
      operator: 'LESS_THAN',
      severity: 'MEDIUM',
      evaluationWindowSeconds: 60,
      description: 'Groundedness too low',
    });

    await service.recordAIMetric({
      metricType: 'GROUNDEDNESS_SCORE',
      serviceId: 'rag-pipeline',
      modelId: 'embedder-v2',
      modelVersion: '1.0.0',
      value: 0.55, // below 0.7 threshold
      unit: 'score',
    });

    expect(alertNotifier.alerts).toHaveLength(1);
    expect(alertNotifier.alerts[0].currentValue).toBe(0.55);
  });

  it('should NOT emit alert when threshold is not breached', async () => {
    const { service, alertNotifier } = createService();

    service.registerThreshold({
      thresholdId: 'thresh-latency',
      serviceId: 'fraud-inference-service',
      metricType: 'MODEL_LATENCY',
      category: 'LATENCY',
      thresholdValue: 100,
      operator: 'GREATER_THAN',
      severity: 'HIGH',
      evaluationWindowSeconds: 60,
      description: 'Latency exceeded',
    });

    await service.recordAIMetric({
      metricType: 'MODEL_LATENCY',
      serviceId: 'fraud-inference-service',
      modelId: 'fraud-v3',
      modelVersion: '3.1.0',
      value: 80, // below threshold
      unit: 'ms',
    });

    expect(alertNotifier.alerts).toHaveLength(0);
  });

  it('should not alert for a different service', async () => {
    const { service, alertNotifier } = createService();

    service.registerThreshold({
      thresholdId: 'thresh-fraud-latency',
      serviceId: 'fraud-inference-service',
      metricType: 'MODEL_LATENCY',
      category: 'LATENCY',
      thresholdValue: 100,
      operator: 'GREATER_THAN',
      severity: 'HIGH',
      evaluationWindowSeconds: 60,
      description: 'Fraud latency',
    });

    // Record metric for a different service
    await service.recordAIMetric({
      metricType: 'MODEL_LATENCY',
      serviceId: 'credit-service', // different service
      modelId: 'credit-v2',
      modelVersion: '2.0.0',
      value: 500, // would breach if matching
      unit: 'ms',
    });

    expect(alertNotifier.alerts).toHaveLength(0);
  });

  it('should report alert latency within 60 seconds', async () => {
    const { service, alertNotifier } = createService();

    service.registerThreshold({
      thresholdId: 'thresh-test',
      serviceId: 'fraud-service',
      metricType: 'MODEL_LATENCY',
      category: 'LATENCY',
      thresholdValue: 50,
      operator: 'GREATER_THAN',
      severity: 'CRITICAL',
      evaluationWindowSeconds: 60,
      description: 'Test',
    });

    await service.recordAIMetric({
      metricType: 'MODEL_LATENCY',
      serviceId: 'fraud-service',
      modelId: 'fraud-v3',
      modelVersion: '3.1.0',
      value: 200,
      unit: 'ms',
    });

    // Alert latency should be minimal (within same execution)
    expect(alertNotifier.alerts[0].alertLatencyMs).toBeLessThan(60_000);
  });

  it('should throw on invalid threshold registration', () => {
    const { service } = createService();

    expect(() =>
      service.registerThreshold({
        thresholdId: '',
        serviceId: 'test',
        metricType: 'MODEL_LATENCY',
        category: 'LATENCY',
        thresholdValue: 100,
        operator: 'GREATER_THAN',
        severity: 'HIGH',
        evaluationWindowSeconds: 60,
        description: 'Test',
      })
    ).toThrow('thresholdId is required');

    expect(() =>
      service.registerThreshold({
        thresholdId: 'valid-id',
        serviceId: '',
        metricType: 'MODEL_LATENCY',
        category: 'LATENCY',
        thresholdValue: 100,
        operator: 'GREATER_THAN',
        severity: 'HIGH',
        evaluationWindowSeconds: 60,
        description: 'Test',
      })
    ).toThrow('threshold.serviceId is required');

    expect(() =>
      service.registerThreshold({
        thresholdId: 'valid-id',
        serviceId: 'test',
        metricType: 'MODEL_LATENCY',
        category: 'LATENCY',
        thresholdValue: 100,
        operator: 'GREATER_THAN',
        severity: 'HIGH',
        evaluationWindowSeconds: 0,
        description: 'Test',
      })
    ).toThrow('evaluationWindowSeconds must be positive');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Retention Policy (Req 25.5)
// ──────────────────────────────────────────────────────────────────────────────

describe('ObservabilityService - Retention Policy (Req 25.5)', () => {
  it('should return 90-day operational retention for traces', () => {
    const { service } = createService();
    expect(service.getRetentionDays('TRACES', 'OPERATIONAL')).toBe(90);
  });

  it('should return 90-day operational retention for metrics', () => {
    const { service } = createService();
    expect(service.getRetentionDays('METRICS', 'OPERATIONAL')).toBe(90);
  });

  it('should return 90-day operational retention for logs', () => {
    const { service } = createService();
    expect(service.getRetentionDays('LOGS', 'OPERATIONAL')).toBe(90);
  });

  it('should return 90-day operational retention for LLM observations', () => {
    const { service } = createService();
    expect(service.getRetentionDays('LLM_OBSERVATIONS', 'OPERATIONAL')).toBe(90);
  });

  it('should return ~7-year (2555 days) aggregate audit retention for traces', () => {
    const { service } = createService();
    expect(service.getRetentionDays('TRACES', 'AGGREGATE_AUDIT')).toBe(2555);
  });

  it('should return ~7-year (2555 days) aggregate audit retention for metrics', () => {
    const { service } = createService();
    expect(service.getRetentionDays('METRICS', 'AGGREGATE_AUDIT')).toBe(2555);
  });

  it('should compute correct expiry date for operational tier', () => {
    const { service } = createService();

    const createdAt = '2024-01-01T00:00:00.000Z';
    const expiry = service.computeExpiryDate(createdAt, 'TRACES', 'OPERATIONAL');

    const expiryDate = new Date(expiry);
    const expectedExpiry = new Date('2024-01-01T00:00:00.000Z');
    expectedExpiry.setDate(expectedExpiry.getDate() + 90);

    expect(expiryDate.getTime()).toBe(expectedExpiry.getTime());
  });

  it('should compute correct expiry date for audit tier', () => {
    const { service } = createService();

    const createdAt = '2024-01-01T00:00:00.000Z';
    const expiry = service.computeExpiryDate(createdAt, 'METRICS', 'AGGREGATE_AUDIT');

    const expiryDate = new Date(expiry);
    const expectedExpiry = new Date('2024-01-01T00:00:00.000Z');
    expectedExpiry.setDate(expectedExpiry.getDate() + 2555);

    expect(expiryDate.getTime()).toBe(expectedExpiry.getTime());
  });

  it('should determine archive eligibility after operational window', () => {
    const { service } = createService();

    // Data older than 90 days should be archived
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 91);

    expect(service.shouldArchive(oldDate.toISOString(), 'TRACES')).toBe(true);
  });

  it('should not archive data within operational window', () => {
    const { service } = createService();

    // Data from yesterday should NOT be archived
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 1);

    expect(service.shouldArchive(recentDate.toISOString(), 'TRACES')).toBe(false);
  });

  it('should return all retention policies with correct defaults', () => {
    const { service } = createService();

    const policies = service.getRetentionPolicies();
    expect(policies).toHaveLength(DEFAULT_RETENTION_POLICIES.length);

    // All operational policies should be 90 days
    const operational = policies.filter((p) => p.tier === 'OPERATIONAL');
    for (const policy of operational) {
      expect(policy.retentionDays).toBe(90);
      expect(policy.aggregateBeforeArchival).toBe(false);
    }

    // All aggregate audit policies should be 2555 days
    const audit = policies.filter((p) => p.tier === 'AGGREGATE_AUDIT');
    for (const policy of audit) {
      expect(policy.retentionDays).toBe(2555);
      expect(policy.aggregateBeforeArchival).toBe(true);
    }
  });

  it('should use Iceberg format for audit-tier metrics and traces', () => {
    const { service } = createService();
    const policies = service.getRetentionPolicies();

    const auditTraces = policies.find((p) => p.tier === 'AGGREGATE_AUDIT' && p.dataType === 'TRACES');
    const auditMetrics = policies.find((p) => p.tier === 'AGGREGATE_AUDIT' && p.dataType === 'METRICS');

    expect(auditTraces!.archivalFormat).toBe('ICEBERG');
    expect(auditMetrics!.archivalFormat).toBe('ICEBERG');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Configuration
// ──────────────────────────────────────────────────────────────────────────────

describe('ObservabilityService - Configuration', () => {
  it('should use default configuration when none provided', () => {
    const { service } = createService();
    const config = service.getConfig();

    expect(config.serviceId).toBe('observability-service');
    expect(config.maxAlertLatencyMs).toBe(60_000);
    expect(config.defaultJurisdiction).toBe('IN');
  });

  it('should merge custom configuration with defaults', () => {
    const { service } = createService({
      serviceId: 'custom-observability',
      defaultJurisdiction: 'SG',
    });

    const config = service.getConfig();
    expect(config.serviceId).toBe('custom-observability');
    expect(config.defaultJurisdiction).toBe('SG');
    expect(config.maxAlertLatencyMs).toBe(60_000); // default preserved
  });
});
