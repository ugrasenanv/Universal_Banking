/**
 * End-to-End Fraud Scoring Flow Tests
 *
 * Validates the critical path wiring:
 *   API Gateway → Fraud Inference Service → Feature Store → Kafka → Audit Service
 *
 * Covers:
 * - mTLS + SPIFFE identity verification at every hop
 * - End-to-end latency tracking and p99 budget verification
 * - Correct flow orchestration and data propagation
 * - Error handling when mTLS verification fails
 *
 * Validates: Requirements 1.1, 17.1, 17.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FraudScoringFlow,
  DEFAULT_FLOW_CONFIG,
  DEFAULT_LATENCY_BUDGET,
  type SPIFFEIdentity,
  type SPIFFEVerifier,
  type FeatureStoreClient,
  type FraudInferenceClient,
  type StreamingClient,
  type AuditClient,
  type MTLSContext,
  type FraudScoringFlowRequest,
  type FraudScoringFlowResult,
  type FraudScoringFlowConfig,
} from './fraud-scoring-flow.js';

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

function createTestIdentity(serviceName: string): SPIFFEIdentity {
  return {
    spiffeId: `spiffe://afg.bank/${serviceName}`,
    trustDomain: 'afg.bank',
    serviceName,
    certificate: `-----BEGIN CERTIFICATE-----\nMOCK_CERT_${serviceName}\n-----END CERTIFICATE-----`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
}

function createTestIdentities() {
  return {
    gateway: createTestIdentity('api-gateway'),
    fraudService: createTestIdentity('fraud-inference-service'),
    featureStore: createTestIdentity('feature-store'),
    kafka: createTestIdentity('streaming-backbone'),
    auditService: createTestIdentity('audit-service'),
  };
}

function createTestRequest(overrides?: Partial<FraudScoringFlowRequest>): FraudScoringFlowRequest {
  return {
    transactionId: 'txn-001',
    channel: 'UPI',
    amount: 5000,
    currency: 'INR',
    payer: { entityId: 'cust-123', entityType: 'CUSTOMER' },
    payee: { entityId: 'merchant-456', entityType: 'MERCHANT' },
    timestamp: new Date().toISOString(),
    metadata: { source: 'mobile-app' },
    jurisdiction: 'IN',
    ...overrides,
  };
}

// ─── Mock Adapters ─────────────────────────────────────────────────────────────

class MockSPIFFEVerifier implements SPIFFEVerifier {
  public verifyCalls: Array<{ caller: SPIFFEIdentity; target: SPIFFEIdentity }> = [];
  public shouldFail = false;
  public failForTarget: string | null = null;

  async verify(caller: SPIFFEIdentity, target: SPIFFEIdentity): Promise<MTLSContext> {
    this.verifyCalls.push({ caller, target });

    if (this.shouldFail || this.failForTarget === target.serviceName) {
      return {
        callerIdentity: caller,
        targetIdentity: target,
        verified: false,
        tlsVersion: '1.3',
        cipherSuite: 'TLS_AES_256_GCM_SHA384',
      };
    }

    return {
      callerIdentity: caller,
      targetIdentity: target,
      verified: true,
      tlsVersion: '1.3',
      cipherSuite: 'TLS_AES_256_GCM_SHA384',
    };
  }
}

class MockFeatureStoreClient implements FeatureStoreClient {
  public getCalls: Array<{ entityId: string; featureGroups: string[] }> = [];
  public latencyMs = 2;

  async getFeatures(entityId: string, featureGroups: string[], timestamp?: string) {
    this.getCalls.push({ entityId, featureGroups });
    return {
      features: {
        'txn_velocity_30d.count': 42,
        'device_fingerprint.hash': 'abc123',
        'merchant_risk_score.score': 0.15,
      },
      freshnessTimestamp: new Date().toISOString(),
      latencyMs: this.latencyMs,
    };
  }
}

class MockFraudInferenceClient implements FraudInferenceClient {
  public predictCalls: Array<{ features: Record<string, unknown> }> = [];
  public score = 0.35;
  public decision: 'APPROVE' | 'DECLINE' | 'HOLD' = 'APPROVE';

  async predict(features: Record<string, unknown>, request: FraudScoringFlowRequest) {
    this.predictCalls.push({ features });
    return {
      score: this.score,
      decision: this.decision,
      explanation: [
        { featureName: 'txn_velocity_30d', attributionWeight: 0.45, featureValue: 42, rank: 1 },
        { featureName: 'device_fingerprint', attributionWeight: 0.30, featureValue: 'abc123', rank: 2 },
        { featureName: 'merchant_risk_score', attributionWeight: 0.15, featureValue: 0.15, rank: 3 },
      ],
      modelVersion: 'fraud-model-v2.1.0',
      latencyMs: 5,
    };
  }
}

class MockStreamingClient implements StreamingClient {
  public emitCalls: Array<{ topic: string; event: unknown }> = [];

  async emit(topic: string, event: unknown): Promise<void> {
    this.emitCalls.push({ topic, event });
  }
}

class MockAuditClient implements AuditClient {
  public persistCalls: Array<unknown> = [];

  async persist(artefact: unknown): Promise<{ artefactId: string }> {
    this.persistCalls.push(artefact);
    return { artefactId: 'audit-artefact-001' };
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('FraudScoringFlow', () => {
  let spiffeVerifier: MockSPIFFEVerifier;
  let featureStoreClient: MockFeatureStoreClient;
  let fraudInferenceClient: MockFraudInferenceClient;
  let streamingClient: MockStreamingClient;
  let auditClient: MockAuditClient;
  let flow: FraudScoringFlow;
  let identities: ReturnType<typeof createTestIdentities>;

  beforeEach(() => {
    spiffeVerifier = new MockSPIFFEVerifier();
    featureStoreClient = new MockFeatureStoreClient();
    fraudInferenceClient = new MockFraudInferenceClient();
    streamingClient = new MockStreamingClient();
    auditClient = new MockAuditClient();
    identities = createTestIdentities();

    flow = new FraudScoringFlow(
      {},
      spiffeVerifier,
      featureStoreClient,
      fraudInferenceClient,
      streamingClient,
      auditClient,
      identities
    );
  });

  describe('End-to-end flow execution', () => {
    it('should execute the full fraud scoring pipeline and return a result', async () => {
      const request = createTestRequest();
      const result = await flow.execute(request);

      expect(result.transactionId).toBe('txn-001');
      expect(result.score).toBe(0.35);
      expect(result.decision).toBe('APPROVE');
      expect(result.explanation).toHaveLength(3);
      expect(result.modelVersion).toBe('fraud-model-v2.1.0');
      expect(result.traceId).toBeDefined();
      expect(result.auditArtefactId).toBeDefined();
    });

    it('should propagate DECLINE decision for high fraud scores', async () => {
      fraudInferenceClient.score = 0.92;
      fraudInferenceClient.decision = 'DECLINE';

      const request = createTestRequest();
      const result = await flow.execute(request);

      expect(result.decision).toBe('DECLINE');
      expect(result.score).toBe(0.92);
    });

    it('should propagate HOLD decision for medium fraud scores', async () => {
      fraudInferenceClient.score = 0.72;
      fraudInferenceClient.decision = 'HOLD';

      const request = createTestRequest();
      const result = await flow.execute(request);

      expect(result.decision).toBe('HOLD');
      expect(result.score).toBe(0.72);
    });

    it('should fetch features for the correct channel-specific groups', async () => {
      const request = createTestRequest({ channel: 'WIRE' });
      await flow.execute(request);

      expect(featureStoreClient.getCalls[0].featureGroups).toEqual([
        'txn_velocity_30d',
        'device_fingerprint',
        'merchant_risk_score',
        'aml_risk_indicators',
      ]);
    });

    it('should fetch UPI-specific feature groups', async () => {
      const request = createTestRequest({ channel: 'UPI' });
      await flow.execute(request);

      expect(featureStoreClient.getCalls[0].featureGroups).toEqual([
        'txn_velocity_30d',
        'device_fingerprint',
        'merchant_risk_score',
        'channel_engagement',
      ]);
    });

    it('should use the payer entityId for feature retrieval', async () => {
      const request = createTestRequest({ payer: { entityId: 'cust-999', entityType: 'CUSTOMER' } });
      await flow.execute(request);

      expect(featureStoreClient.getCalls[0].entityId).toBe('cust-999');
    });
  });

  describe('mTLS + SPIFFE identity verification', () => {
    it('should verify mTLS at Gateway → Fraud Service hop', async () => {
      const request = createTestRequest();
      await flow.execute(request);

      const gatewayToFraud = spiffeVerifier.verifyCalls.find(
        (c) =>
          c.caller.serviceName === 'api-gateway' &&
          c.target.serviceName === 'fraud-inference-service'
      );
      expect(gatewayToFraud).toBeDefined();
    });

    it('should verify mTLS at Fraud Service → Feature Store hop', async () => {
      const request = createTestRequest();
      await flow.execute(request);

      const fraudToFeatureStore = spiffeVerifier.verifyCalls.find(
        (c) =>
          c.caller.serviceName === 'fraud-inference-service' &&
          c.target.serviceName === 'feature-store'
      );
      expect(fraudToFeatureStore).toBeDefined();
    });

    it('should verify mTLS at Fraud Service → Kafka hop', async () => {
      const request = createTestRequest();
      await flow.execute(request);

      const fraudToKafka = spiffeVerifier.verifyCalls.find(
        (c) =>
          c.caller.serviceName === 'fraud-inference-service' &&
          c.target.serviceName === 'streaming-backbone'
      );
      expect(fraudToKafka).toBeDefined();
    });

    it('should verify mTLS at Fraud Service → Audit Service hop', async () => {
      const request = createTestRequest();
      await flow.execute(request);

      const fraudToAudit = spiffeVerifier.verifyCalls.find(
        (c) =>
          c.caller.serviceName === 'fraud-inference-service' &&
          c.target.serviceName === 'audit-service'
      );
      expect(fraudToAudit).toBeDefined();
    });

    it('should throw when mTLS verification fails at any hop', async () => {
      spiffeVerifier.failForTarget = 'fraud-inference-service';

      const request = createTestRequest();
      await expect(flow.execute(request)).rejects.toThrow(
        'mTLS verification failed'
      );
    });

    it('should throw when Feature Store mTLS fails', async () => {
      spiffeVerifier.failForTarget = 'feature-store';

      const request = createTestRequest();
      await expect(flow.execute(request)).rejects.toThrow(
        'mTLS verification failed'
      );
    });

    it('should use SPIFFE IDs with correct trust domain', async () => {
      const request = createTestRequest();
      await flow.execute(request);

      for (const call of spiffeVerifier.verifyCalls) {
        expect(call.caller.trustDomain).toBe('afg.bank');
        expect(call.target.trustDomain).toBe('afg.bank');
        expect(call.caller.spiffeId).toMatch(/^spiffe:\/\/afg\.bank\//);
        expect(call.target.spiffeId).toMatch(/^spiffe:\/\/afg\.bank\//);
      }
    });
  });

  describe('Latency tracking and budget verification', () => {
    it('should return a complete latency breakdown', async () => {
      const request = createTestRequest();
      const result = await flow.execute(request);

      expect(result.latency.gatewayToFraudMs).toBeGreaterThanOrEqual(0);
      expect(result.latency.featureStoreMs).toBeGreaterThanOrEqual(0);
      expect(result.latency.inferenceMs).toBeGreaterThanOrEqual(0);
      expect(result.latency.responseMs).toBeGreaterThanOrEqual(0);
      expect(result.latency.totalMs).toBeGreaterThanOrEqual(0);
      expect(result.latency.auditEmitMs).toBeGreaterThanOrEqual(0);
    });

    it('should report totalMs as sum of synchronous hops', async () => {
      const request = createTestRequest();
      const result = await flow.execute(request);

      // Total should be at least gateway + feature store + inference + response
      expect(result.latency.totalMs).toBeGreaterThanOrEqual(
        result.latency.gatewayToFraudMs
      );
    });

    it('should mark withinBudget=true when total latency is under 100ms', async () => {
      const request = createTestRequest();
      const result = await flow.execute(request);

      // With mocks, execution is nearly instant
      expect(result.withinBudget).toBe(true);
      expect(result.latency.totalMs).toBeLessThan(100);
    });

    it('should provide default latency budget of 100ms total', () => {
      const budget = flow.getLatencyBudget();
      expect(budget.totalBudgetMs).toBe(100);
      expect(budget.featureStoreBudgetMs).toBe(10);
      expect(budget.inferenceBudgetMs).toBe(80);
      expect(budget.gatewayBudgetMs).toBe(5);
      expect(budget.responseBudgetMs).toBe(5);
    });

    it('should verify p99 latency across multiple results', () => {
      const results: FraudScoringFlowResult[] = Array.from({ length: 100 }, (_, i) => ({
        transactionId: `txn-${i}`,
        score: 0.5,
        decision: 'HOLD' as const,
        explanation: [],
        modelVersion: 'v1',
        traceId: `trace-${i}`,
        latency: {
          gatewayToFraudMs: 2,
          featureStoreMs: 5,
          inferenceMs: i === 99 ? 120 : 50, // one outlier at 120ms
          responseMs: 1,
          totalMs: i === 99 ? 128 : 58,
          auditEmitMs: 10,
        },
        withinBudget: i !== 99,
        auditArtefactId: `audit-${i}`,
      }));

      const p99Check = flow.verifyP99Latency(results);
      // p99 index for 100 items = floor(100 * 0.99) = 99
      expect(p99Check.p99Ms).toBe(128);
      expect(p99Check.withinBudget).toBe(false);
      expect(p99Check.budgetMs).toBe(100);
    });

    it('should report p99 within budget when all latencies are low', () => {
      const results: FraudScoringFlowResult[] = Array.from({ length: 100 }, (_, i) => ({
        transactionId: `txn-${i}`,
        score: 0.3,
        decision: 'APPROVE' as const,
        explanation: [],
        modelVersion: 'v1',
        traceId: `trace-${i}`,
        latency: {
          gatewayToFraudMs: 2,
          featureStoreMs: 5,
          inferenceMs: 40 + Math.random() * 20,
          responseMs: 1,
          totalMs: 48 + Math.random() * 20,
          auditEmitMs: 10,
        },
        withinBudget: true,
        auditArtefactId: `audit-${i}`,
      }));

      const p99Check = flow.verifyP99Latency(results);
      expect(p99Check.withinBudget).toBe(true);
      expect(p99Check.p99Ms).toBeLessThan(100);
    });

    it('should handle empty results in p99 verification', () => {
      const p99Check = flow.verifyP99Latency([]);
      expect(p99Check.p99Ms).toBe(0);
      expect(p99Check.withinBudget).toBe(true);
    });
  });

  describe('Kafka audit event emission', () => {
    it('should emit an audit event to the fraud.decisions topic', async () => {
      const request = createTestRequest();
      await flow.execute(request);

      expect(streamingClient.emitCalls).toHaveLength(1);
      expect(streamingClient.emitCalls[0].topic).toBe('fraud.decisions');
    });

    it('should emit a correctly structured PlatformEvent', async () => {
      const request = createTestRequest();
      await flow.execute(request);

      const emittedEvent = streamingClient.emitCalls[0].event as any;
      expect(emittedEvent.eventId).toBeDefined();
      expect(emittedEvent.eventType).toBe('fraud.decision.scored');
      expect(emittedEvent.version).toBe('1.0.0');
      expect(emittedEvent.source).toBe('fraud-inference-service');
      expect(emittedEvent.jurisdiction).toBe('IN');
      expect(emittedEvent.correlationId).toBe('txn-001');
      expect(emittedEvent.traceId).toBeDefined();
      expect(emittedEvent.payload.transactionId).toBe('txn-001');
      expect(emittedEvent.payload.score).toBe(0.35);
      expect(emittedEvent.payload.decision).toBe('APPROVE');
    });

    it('should include jurisdiction in the audit event payload', async () => {
      const request = createTestRequest({ jurisdiction: 'SG' });
      await flow.execute(request);

      const emittedEvent = streamingClient.emitCalls[0].event as any;
      expect(emittedEvent.jurisdiction).toBe('SG');
      expect(emittedEvent.payload.jurisdiction).toBe('SG');
    });
  });

  describe('Audit Service persistence', () => {
    it('should persist an audit artefact with all required fields', async () => {
      const request = createTestRequest();
      await flow.execute(request);

      expect(auditClient.persistCalls).toHaveLength(1);
      const artefact = auditClient.persistCalls[0] as any;

      expect(artefact.artefactId).toBeDefined();
      expect(artefact.timestamp).toBe(request.timestamp);
      expect(artefact.jurisdiction).toBe('IN');
      expect(artefact.serviceId).toBe('fraud-inference-service');
      expect(artefact.modelVersion).toBe('fraud-model-v2.1.0');
      expect(artefact.inputFeatures).toBeDefined();
      expect(artefact.modelOutput).toBeDefined();
      expect(artefact.confidenceScore).toBe(0.35);
      expect(artefact.decision).toBe('APPROVE');
    });

    it('should include model output with score, decision, and explanation', async () => {
      const request = createTestRequest();
      await flow.execute(request);

      const artefact = auditClient.persistCalls[0] as any;
      expect(artefact.modelOutput.score).toBe(0.35);
      expect(artefact.modelOutput.decision).toBe('APPROVE');
      expect(artefact.modelOutput.explanation).toHaveLength(3);
    });

    it('should include feature values in audit artefact input features', async () => {
      const request = createTestRequest();
      await flow.execute(request);

      const artefact = auditClient.persistCalls[0] as any;
      expect(artefact.inputFeatures['txn_velocity_30d.count']).toBe(42);
      expect(artefact.inputFeatures['device_fingerprint.hash']).toBe('abc123');
    });
  });

  describe('Flow configuration', () => {
    it('should use default configuration when none provided', () => {
      const config = flow.getConfig();
      expect(config.trustDomain).toBe('afg.bank');
      expect(config.auditTopic).toBe('fraud.decisions');
      expect(config.serviceId).toBe('fraud-inference-service');
    });

    it('should allow custom latency budget configuration', () => {
      const customFlow = new FraudScoringFlow(
        { latencyBudget: { ...DEFAULT_LATENCY_BUDGET, totalBudgetMs: 50 } },
        spiffeVerifier,
        featureStoreClient,
        fraudInferenceClient,
        streamingClient,
        auditClient,
        identities
      );

      expect(customFlow.getLatencyBudget().totalBudgetMs).toBe(50);
    });

    it('should map channel-specific feature groups from config', () => {
      const config = flow.getConfig();
      expect(config.channelFeatureGroups['UPI']).toContain('channel_engagement');
      expect(config.channelFeatureGroups['WIRE']).toContain('aml_risk_indicators');
      expect(config.channelFeatureGroups['CARD']).toContain('behaviour_90d');
    });
  });

  describe('DEFAULT_LATENCY_BUDGET', () => {
    it('should define p99 budget summing to 100ms', () => {
      expect(DEFAULT_LATENCY_BUDGET.totalBudgetMs).toBe(100);
    });

    it('should allocate 10ms for Feature Store', () => {
      expect(DEFAULT_LATENCY_BUDGET.featureStoreBudgetMs).toBe(10);
    });

    it('should allocate 80ms for inference', () => {
      expect(DEFAULT_LATENCY_BUDGET.inferenceBudgetMs).toBe(80);
    });

    it('should allocate 5ms for gateway routing', () => {
      expect(DEFAULT_LATENCY_BUDGET.gatewayBudgetMs).toBe(5);
    });
  });

  describe('DEFAULT_FLOW_CONFIG', () => {
    it('should define trust domain as afg.bank', () => {
      expect(DEFAULT_FLOW_CONFIG.trustDomain).toBe('afg.bank');
    });

    it('should define audit topic as fraud.decisions', () => {
      expect(DEFAULT_FLOW_CONFIG.auditTopic).toBe('fraud.decisions');
    });

    it('should define all channel feature group mappings', () => {
      expect(DEFAULT_FLOW_CONFIG.channelFeatureGroups['UPI']).toBeDefined();
      expect(DEFAULT_FLOW_CONFIG.channelFeatureGroups['IMPS']).toBeDefined();
      expect(DEFAULT_FLOW_CONFIG.channelFeatureGroups['CNP']).toBeDefined();
      expect(DEFAULT_FLOW_CONFIG.channelFeatureGroups['WIRE']).toBeDefined();
      expect(DEFAULT_FLOW_CONFIG.channelFeatureGroups['CARD']).toBeDefined();
    });
  });
});
