# Task 7: Fraud Inference Service

## Summary

Implements real-time payment fraud detection (100ms p99) and card fraud detection (150ms p99) with feature attribution, fallback chains, and shadow scoring for challenger models.

## Sub-Tasks

### 7.1 — Real-Time Payment Fraud Scoring

**Requirements**: 1.1, 1.2, 1.3

**Purpose**: Score every UPI, IMPS, CNP, and wire payment for fraud risk in real-time.

**Interface**:
```typescript
interface FraudInferenceService {
  scorePayment(request: FraudScoringRequest): Promise<FraudScoringResponse>;
  scoreCard(request: CardFraudRequest): Promise<CardFraudResponse>;
}

interface FraudScoringRequest {
  transactionId: string;
  paymentType: 'UPI' | 'IMPS' | 'CNP' | 'WIRE';
  amount: Money;
  payer: EntityRef;
  payee: EntityRef;
  deviceContext: DeviceContext;
  timestamp: ISO8601;
}

interface FraudScoringResponse {
  transactionId: string;
  fraudScore: number;         // 0.00 - 1.00
  decision: 'APPROVE' | 'DECLINE' | 'HOLD';
  attribution: FeatureAttribution[];  // Top 3-5 factors
  modelVersion: string;
  latencyMs: number;
  featureFreshnessMs: number;
}

interface FeatureAttribution {
  featureName: string;
  shapValue: number;
  rank: number;               // 1 = highest contributor
  direction: 'INCREASES_RISK' | 'DECREASES_RISK';
}
```

**Performance Targets**:
| Metric | Target |
|--------|--------|
| Latency (p99) | <100ms |
| Throughput (peak) | 82,000 TPS |
| Peak duration | 90 minutes sustained |
| False positive rate | <2.5% (rolling 7-day) |
| Feature freshness | <5 minutes |

**Feature Store Integration**:
- Online features retrieved in <10ms p99
- Features: `txn_velocity_30d`, `device_fingerprint`, `merchant_risk_score`, `payee_risk_profile`
- Freshness check: emit warning if feature age > 5 minutes

---

### 7.2 — Card Fraud and Dispute Pre-Classification

**Requirements**: 2.1–2.5

**Purpose**: Score card transactions at 150ms p99, generate risk summaries, and pre-classify disputes.

**Card-Specific Extensions**:
- 28M active cards, 3.4B annual transactions
- GenAI risk factor summary (≤500 chars) generated within 3 seconds of decline
- Dispute pre-classification into defined categories
- Low-confidence disputes (< 0.75) routed to human analyst
- Evidence summary (≤300 words) for classified disputes

---

### 7.3 — Fallback Chain and Shadow Scoring

**Requirements**: 1.4, 1.5, 1.7, 1.8, 2.6, 2.7

**5-Tier Degradation Hierarchy**:
```
Tier 1: Primary ML Model (production champion)
  ↓ fails (200ms timeout or 3 consecutive errors)
Tier 2: Smaller/Faster ML Model (distilled version)
  ↓ fails (500ms timeout)
Tier 3: Rules-Based Engine (deterministic rules)
  ↓ fails
Tier 4: Human Review Queue
  ↓ capacity exceeded
Tier 5: Safe-Default Decline
```

**Circuit Breaker**:
```typescript
// State transitions:
// CLOSED → OPEN (after 3 consecutive failures)
// OPEN → HALF_OPEN (after 10-second timeout)
// HALF_OPEN → CLOSED (if probe succeeds)
// HALF_OPEN → OPEN (if probe fails)
```

**Shadow/Challenger Scoring**:
```typescript
interface ShadowScoringConfig {
  enabled: boolean;
  sampleRate: number;          // 1-100% (default 10%)
  challengerModelId: string;
  maxAddedLatencyMs: 5;        // Must not add >5ms to production path
  logOnly: true;               // Never affects live decisions
}
```

- Challenger runs asynchronously (fire-and-forget or background)
- Results logged for comparison but never returned to caller
- Monthly comparison reports: accuracy, FP rate, FN rate, latency

**Audit Emission**:
Every scored transaction produces an audit artefact:
- Transaction ID, model version, fraud score, decision, timestamp
- Feature values used, feature freshness
- Retained for 7 years

**Property Tests**:
- Property 1: Fraud score always between 0.00 and 1.00; decision maps correctly to thresholds
- Property 2: Feature attribution always returns 3-5 factors, ranked by absolute SHAP value
- Property 3: Fallback chain is deterministic — same failure state always produces same tier
- Property 4: Shadow scoring never alters live decisioning outcomes

## Acceptance Criteria Verification

- [ ] Payment fraud scoring returns in <100ms p99
- [ ] Card fraud scoring returns in <150ms p99
- [ ] Sustains 82,000 TPS for 90 minutes without degradation
- [ ] Feature attribution returns 3-5 ranked factors for every decline
- [ ] Fallback chain activates correctly on timeouts/errors
- [ ] Shadow scoring adds ≤5ms to production path
- [ ] Challenger results logged but never affect live decisions
- [ ] Audit artefact emitted for every scored transaction
- [ ] False positive rate below 2.5% (rolling 7-day window)
- [ ] All property tests pass
