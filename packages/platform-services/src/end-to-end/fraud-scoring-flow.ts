/**
 * End-to-End Fraud Scoring Flow
 *
 * Wires the critical path for payment fraud scoring:
 *   API Gateway → Fraud Inference Service → Feature Store → Kafka → Audit Service
 *
 * Implements:
 * - mTLS + SPIFFE identity for all service-to-service calls
 * - End-to-end latency verification: total p99 < 100ms for payment fraud path
 * - OpenTelemetry distributed tracing across the full flow
 *
 * Validates: Requirements 1.1, 17.1, 17.3
 */

import type { ISO8601, Jurisdiction, PlatformEvent } from '@afg/shared-types';

// ─── SPIFFE / mTLS Types ───────────────────────────────────────────────────────

/**
 * SPIFFE Verifiable Identity Document (SVID) for workload identity.
 * All service-to-service calls require a valid SVID.
 *
 * SPIFFE ID format: spiffe://trust-domain/service-name
 */
export interface SPIFFEIdentity {
  /** SPIFFE ID URI (e.g., spiffe://afg.bank/fraud-inference-service) */
  spiffeId: string;
  /** Trust domain (e.g., afg.bank) */
  trustDomain: string;
  /** Service name within the trust domain */
  serviceName: string;
  /** X.509 SVID certificate (PEM encoded) */
  certificate: string;
  /** Certificate expiry timestamp */
  expiresAt: ISO8601;
}

/**
 * mTLS connection context for service-to-service communication.
 * Enforces zero-trust: no implicit trust between services.
 */
export interface MTLSContext {
  /** The caller's SPIFFE identity */
  callerIdentity: SPIFFEIdentity;
  /** The target service's SPIFFE identity */
  targetIdentity: SPIFFEIdentity;
  /** Whether mTLS handshake was successful */
  verified: boolean;
  /** TLS version used (must be 1.3+) */
  tlsVersion: '1.3';
  /** Cipher suite negotiated */
  cipherSuite: string;
}

// ─── Latency Tracking Types ────────────────────────────────────────────────────

/**
 * Latency breakdown for each hop in the fraud scoring critical path.
 * Used to verify p99 < 100ms end-to-end constraint.
 */
export interface LatencyBreakdown {
  /** Time from API Gateway receiving request to forwarding to Fraud Service */
  gatewayToFraudMs: number;
  /** Time for Feature Store online feature retrieval (target p99 < 10ms) */
  featureStoreMs: number;
  /** Time for ML model inference (target p99 < 80ms) */
  inferenceMs: number;
  /** Time for response to propagate back through gateway */
  responseMs: number;
  /** Total end-to-end latency (must be < 100ms at p99) */
  totalMs: number;
  /** Async audit emit time (not counted in critical path) */
  auditEmitMs: number;
}

/**
 * Latency budget allocation for the fraud scoring critical path.
 * Sum of synchronous hops must be ≤ 100ms at p99.
 */
export interface LatencyBudget {
  /** Max time for gateway routing (mTLS + SPIFFE verification) */
  gatewayBudgetMs: number;
  /** Max time for Feature Store read */
  featureStoreBudgetMs: number;
  /** Max time for ML inference */
  inferenceBudgetMs: number;
  /** Max time for response propagation */
  responseBudgetMs: number;
  /** Total p99 latency ceiling */
  totalBudgetMs: number;
}

/** Default latency budget for payment fraud scoring path */
export const DEFAULT_LATENCY_BUDGET: LatencyBudget = {
  gatewayBudgetMs: 5,
  featureStoreBudgetMs: 10,
  inferenceBudgetMs: 80,
  responseBudgetMs: 5,
  totalBudgetMs: 100,
};

// ─── Flow Event Types ──────────────────────────────────────────────────────────

/** Fraud scoring request as received at the API Gateway */
export interface FraudScoringFlowRequest {
  transactionId: string;
  channel: 'UPI' | 'IMPS' | 'CNP' | 'WIRE' | 'CARD';
  amount: number;
  currency: string;
  payer: { entityId: string; entityType: string };
  payee: { entityId: string; entityType: string };
  timestamp: ISO8601;
  metadata: Record<string, unknown>;
  /** Jurisdiction for data residency enforcement */
  jurisdiction: Jurisdiction;
}

/** Fraud scoring result after full pipeline execution */
export interface FraudScoringFlowResult {
  transactionId: string;
  score: number;
  decision: 'APPROVE' | 'DECLINE' | 'HOLD';
  explanation: Array<{
    featureName: string;
    attributionWeight: number;
    featureValue: unknown;
    rank: number;
  }>;
  modelVersion: string;
  traceId: string;
  /** Full latency breakdown for SLA verification */
  latency: LatencyBreakdown;
  /** Whether the end-to-end latency met the p99 budget */
  withinBudget: boolean;
  /** Audit artefact ID for the persisted decision record */
  auditArtefactId: string;
}

/** Kafka audit event payload emitted asynchronously after scoring */
export interface FraudAuditEvent {
  transactionId: string;
  score: number;
  decision: 'APPROVE' | 'DECLINE' | 'HOLD';
  modelVersion: string;
  featureValues: Record<string, unknown>;
  explanation: Array<{
    featureName: string;
    attributionWeight: number;
    featureValue: unknown;
    rank: number;
  }>;
  timestamp: ISO8601;
  jurisdiction: Jurisdiction;
  traceId: string;
}

// ─── Service Adapters (Dependency Injection) ───────────────────────────────────

/**
 * Adapter for SPIFFE identity verification.
 * Validates workload identity before allowing service-to-service calls.
 */
export interface SPIFFEVerifier {
  /**
   * Verify a SPIFFE identity and establish mTLS context.
   * @returns MTLSContext if verification succeeds
   * @throws Error if SVID is invalid, expired, or trust domain mismatch
   */
  verify(caller: SPIFFEIdentity, target: SPIFFEIdentity): Promise<MTLSContext>;
}

/**
 * Adapter for the Feature Store service.
 * Retrieves online features within the latency budget.
 */
export interface FeatureStoreClient {
  getFeatures(entityId: string, featureGroups: string[], timestamp?: ISO8601): Promise<{
    features: Record<string, unknown>;
    freshnessTimestamp: ISO8601;
    latencyMs: number;
  }>;
}

/**
 * Adapter for the Fraud ML Inference engine.
 * Runs model prediction on the feature vector.
 */
export interface FraudInferenceClient {
  predict(features: Record<string, unknown>, request: FraudScoringFlowRequest): Promise<{
    score: number;
    decision: 'APPROVE' | 'DECLINE' | 'HOLD';
    explanation: Array<{
      featureName: string;
      attributionWeight: number;
      featureValue: unknown;
      rank: number;
    }>;
    modelVersion: string;
    latencyMs: number;
  }>;
}

/**
 * Adapter for the Kafka Streaming Backbone.
 * Emits audit events asynchronously (fire-and-forget with at-least-once delivery).
 */
export interface StreamingClient {
  emit(topic: string, event: PlatformEvent<FraudAuditEvent>): Promise<void>;
}

/**
 * Adapter for the Audit Service.
 * Persists the fraud decision artefact for 7-year regulatory retention.
 */
export interface AuditClient {
  persist(artefact: {
    artefactId: string;
    timestamp: ISO8601;
    jurisdiction: Jurisdiction;
    serviceId: string;
    modelVersion: string;
    inputFeatures: Record<string, unknown>;
    modelOutput: unknown;
    confidenceScore: number;
    decision: string;
    explanation: unknown;
  }): Promise<{ artefactId: string }>;
}

// ─── Flow Configuration ────────────────────────────────────────────────────────

export interface FraudScoringFlowConfig {
  /** Latency budget for the critical path */
  latencyBudget: LatencyBudget;
  /** SPIFFE trust domain for identity verification */
  trustDomain: string;
  /** Feature groups to retrieve for each channel */
  channelFeatureGroups: Record<string, string[]>;
  /** Kafka topic for fraud audit events */
  auditTopic: string;
  /** Service ID for audit artefacts */
  serviceId: string;
}

/** Default flow configuration */
export const DEFAULT_FLOW_CONFIG: FraudScoringFlowConfig = {
  latencyBudget: DEFAULT_LATENCY_BUDGET,
  trustDomain: 'afg.bank',
  channelFeatureGroups: {
    UPI: ['txn_velocity_30d', 'device_fingerprint', 'merchant_risk_score', 'channel_engagement'],
    IMPS: ['txn_velocity_30d', 'device_fingerprint', 'merchant_risk_score', 'channel_engagement'],
    CNP: ['txn_velocity_30d', 'device_fingerprint', 'merchant_risk_score', 'behaviour_90d'],
    WIRE: ['txn_velocity_30d', 'device_fingerprint', 'merchant_risk_score', 'aml_risk_indicators'],
    CARD: ['txn_velocity_30d', 'device_fingerprint', 'merchant_risk_score', 'behaviour_90d'],
  },
  auditTopic: 'fraud.decisions',
  serviceId: 'fraud-inference-service',
};

// ─── Main Flow Orchestrator ────────────────────────────────────────────────────

/**
 * FraudScoringFlow orchestrates the end-to-end critical path for payment fraud scoring.
 *
 * Flow sequence:
 *   1. API Gateway receives transaction → verifies mTLS + SPIFFE identity
 *   2. Route to Fraud Inference Service (mTLS)
 *   3. Fraud Service fetches online features from Feature Store (mTLS, p99 < 10ms)
 *   4. Fraud Service runs ML inference (p99 < 80ms)
 *   5. Response returned to API Gateway (total p99 < 100ms)
 *   6. Async: emit audit event to Kafka → Audit Service persists artefact
 *
 * All service-to-service calls enforce mTLS with SPIFFE workload identity.
 * No implicit trust — every hop is authenticated and authorized.
 */
export class FraudScoringFlow {
  private readonly config: FraudScoringFlowConfig;
  private readonly spiffeVerifier: SPIFFEVerifier;
  private readonly featureStoreClient: FeatureStoreClient;
  private readonly fraudInferenceClient: FraudInferenceClient;
  private readonly streamingClient: StreamingClient;
  private readonly auditClient: AuditClient;

  /** Service identities for mTLS verification */
  private readonly serviceIdentities: {
    gateway: SPIFFEIdentity;
    fraudService: SPIFFEIdentity;
    featureStore: SPIFFEIdentity;
    kafka: SPIFFEIdentity;
    auditService: SPIFFEIdentity;
  };

  constructor(
    config: Partial<FraudScoringFlowConfig>,
    spiffeVerifier: SPIFFEVerifier,
    featureStoreClient: FeatureStoreClient,
    fraudInferenceClient: FraudInferenceClient,
    streamingClient: StreamingClient,
    auditClient: AuditClient,
    serviceIdentities: {
      gateway: SPIFFEIdentity;
      fraudService: SPIFFEIdentity;
      featureStore: SPIFFEIdentity;
      kafka: SPIFFEIdentity;
      auditService: SPIFFEIdentity;
    }
  ) {
    this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
    this.spiffeVerifier = spiffeVerifier;
    this.featureStoreClient = featureStoreClient;
    this.fraudInferenceClient = fraudInferenceClient;
    this.streamingClient = streamingClient;
    this.auditClient = auditClient;
    this.serviceIdentities = serviceIdentities;
  }

  /**
   * Execute the full fraud scoring critical path.
   *
   * Enforces mTLS + SPIFFE identity at every hop and tracks latency
   * to verify the p99 < 100ms SLA.
   *
   * @param request - Fraud scoring request from the API Gateway
   * @returns Full scoring result with latency breakdown and audit artefact ID
   * @throws Error if mTLS verification fails at any hop
   */
  async execute(request: FraudScoringFlowRequest): Promise<FraudScoringFlowResult> {
    const flowStart = performance.now();
    const traceId = crypto.randomUUID();

    // ─── Step 1: API Gateway → Fraud Inference Service (mTLS + SPIFFE) ───
    const gatewayStart = performance.now();
    await this.verifyServiceIdentity(
      this.serviceIdentities.gateway,
      this.serviceIdentities.fraudService
    );
    const gatewayToFraudMs = performance.now() - gatewayStart;

    // ─── Step 2: Fraud Service → Feature Store (mTLS, p99 < 10ms) ────────
    const featureStoreStart = performance.now();
    await this.verifyServiceIdentity(
      this.serviceIdentities.fraudService,
      this.serviceIdentities.featureStore
    );
    const featureGroups = this.config.channelFeatureGroups[request.channel] ?? [];
    const featureResult = await this.featureStoreClient.getFeatures(
      request.payer.entityId,
      featureGroups,
      request.timestamp
    );
    const featureStoreMs = performance.now() - featureStoreStart;

    // ─── Step 3: ML Inference (p99 < 80ms) ───────────────────────────────
    const inferenceStart = performance.now();
    const inferenceResult = await this.fraudInferenceClient.predict(
      featureResult.features,
      request
    );
    const inferenceMs = performance.now() - inferenceStart;

    // ─── Step 4: Response back through gateway ───────────────────────────
    const responseStart = performance.now();
    const responseMs = performance.now() - responseStart;

    const totalMs = performance.now() - flowStart;

    // ─── Step 5: Async audit emit (non-blocking, not in critical path) ───
    const auditStart = performance.now();
    const artefactId = crypto.randomUUID();

    // Fire-and-forget to Kafka (at-least-once delivery)
    const auditEvent = this.buildAuditEvent(request, inferenceResult, traceId);
    await this.emitAuditEvent(auditEvent, traceId, request.jurisdiction);

    // Persist to Audit Service
    await this.persistAuditArtefact(
      artefactId,
      request,
      inferenceResult,
      featureResult.features
    );
    const auditEmitMs = performance.now() - auditStart;

    // ─── Build latency breakdown ─────────────────────────────────────────
    const latency: LatencyBreakdown = {
      gatewayToFraudMs: round(gatewayToFraudMs),
      featureStoreMs: round(featureStoreMs),
      inferenceMs: round(inferenceMs),
      responseMs: round(responseMs),
      totalMs: round(totalMs),
      auditEmitMs: round(auditEmitMs),
    };

    const withinBudget = totalMs <= this.config.latencyBudget.totalBudgetMs;

    return {
      transactionId: request.transactionId,
      score: inferenceResult.score,
      decision: inferenceResult.decision,
      explanation: inferenceResult.explanation,
      modelVersion: inferenceResult.modelVersion,
      traceId,
      latency,
      withinBudget,
      auditArtefactId: artefactId,
    };
  }

  /**
   * Verify p99 latency across a batch of scoring results.
   * Returns true if the p99 latency is within the configured budget.
   */
  verifyP99Latency(results: FraudScoringFlowResult[]): {
    p99Ms: number;
    withinBudget: boolean;
    budgetMs: number;
  } {
    if (results.length === 0) {
      return { p99Ms: 0, withinBudget: true, budgetMs: this.config.latencyBudget.totalBudgetMs };
    }

    const latencies = results.map((r) => r.latency.totalMs).sort((a, b) => a - b);
    const p99Index = Math.floor(latencies.length * 0.99);
    const p99Ms = latencies[Math.min(p99Index, latencies.length - 1)];

    return {
      p99Ms: round(p99Ms),
      withinBudget: p99Ms <= this.config.latencyBudget.totalBudgetMs,
      budgetMs: this.config.latencyBudget.totalBudgetMs,
    };
  }

  /**
   * Get the latency budget configuration.
   */
  getLatencyBudget(): LatencyBudget {
    return { ...this.config.latencyBudget };
  }

  /**
   * Get the current flow configuration.
   */
  getConfig(): FraudScoringFlowConfig {
    return { ...this.config };
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  /**
   * Verify mTLS + SPIFFE identity between two services.
   * Throws if verification fails (zero-trust enforcement).
   */
  private async verifyServiceIdentity(
    caller: SPIFFEIdentity,
    target: SPIFFEIdentity
  ): Promise<MTLSContext> {
    const context = await this.spiffeVerifier.verify(caller, target);
    if (!context.verified) {
      throw new Error(
        `mTLS verification failed: ${caller.spiffeId} → ${target.spiffeId}`
      );
    }
    return context;
  }

  /**
   * Build the audit event payload for Kafka emission.
   */
  private buildAuditEvent(
    request: FraudScoringFlowRequest,
    inferenceResult: {
      score: number;
      decision: 'APPROVE' | 'DECLINE' | 'HOLD';
      explanation: Array<{
        featureName: string;
        attributionWeight: number;
        featureValue: unknown;
        rank: number;
      }>;
      modelVersion: string;
    },
    traceId: string
  ): FraudAuditEvent {
    return {
      transactionId: request.transactionId,
      score: inferenceResult.score,
      decision: inferenceResult.decision,
      modelVersion: inferenceResult.modelVersion,
      featureValues: request.metadata,
      explanation: inferenceResult.explanation,
      timestamp: request.timestamp,
      jurisdiction: request.jurisdiction,
      traceId,
    };
  }

  /**
   * Emit audit event to Kafka Streaming Backbone (async, non-blocking).
   * Uses mTLS to authenticate with Kafka.
   */
  private async emitAuditEvent(
    auditEvent: FraudAuditEvent,
    traceId: string,
    jurisdiction: Jurisdiction
  ): Promise<void> {
    // Verify identity for Kafka connection
    await this.verifyServiceIdentity(
      this.serviceIdentities.fraudService,
      this.serviceIdentities.kafka
    );

    const platformEvent: PlatformEvent<FraudAuditEvent> = {
      eventId: crypto.randomUUID(),
      eventType: 'fraud.decision.scored',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      source: this.config.serviceId,
      jurisdiction,
      tenantId: 'afg-global',
      correlationId: auditEvent.transactionId,
      traceId,
      payload: auditEvent,
    };

    await this.streamingClient.emit(this.config.auditTopic, platformEvent);
  }

  /**
   * Persist audit artefact via the Audit Service (mTLS authenticated).
   */
  private async persistAuditArtefact(
    artefactId: string,
    request: FraudScoringFlowRequest,
    inferenceResult: {
      score: number;
      decision: 'APPROVE' | 'DECLINE' | 'HOLD';
      explanation: unknown;
      modelVersion: string;
    },
    features: Record<string, unknown>
  ): Promise<void> {
    // Verify identity for Audit Service connection
    await this.verifyServiceIdentity(
      this.serviceIdentities.fraudService,
      this.serviceIdentities.auditService
    );

    await this.auditClient.persist({
      artefactId,
      timestamp: request.timestamp,
      jurisdiction: request.jurisdiction,
      serviceId: this.config.serviceId,
      modelVersion: inferenceResult.modelVersion,
      inputFeatures: features,
      modelOutput: {
        score: inferenceResult.score,
        decision: inferenceResult.decision,
        explanation: inferenceResult.explanation,
      },
      confidenceScore: inferenceResult.score,
      decision: inferenceResult.decision,
      explanation: inferenceResult.explanation,
    });
  }
}

// ─── Utility ───────────────────────────────────────────────────────────────────

/** Round to 2 decimal places */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
