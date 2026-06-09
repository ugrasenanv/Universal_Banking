# Part 6 — Sequence Diagram: UPI Payment Fraud + AML Co-Pilot Flow

## Flow Description

Customer-initiated UPI payment of ₹2,40,000 to a new beneficiary, where the fraud model returns a borderline score and the transaction is held for step-up authentication, then escalated to a contact-centre agent who consults the AML/fraud co-pilot before releasing the transaction.

## Sequence (Annotated)

```
Customer          Mobile App       API Gateway      BFF          Payment Orch.
   │                 │                │              │                │
   │─── Initiate ───▶│                │              │                │
   │  UPI ₹2,40,000  │                │              │                │
   │  new beneficiary │                │              │                │
   │                 │                │              │                │
   │                 │── HTTPS/TLS ──▶│              │                │
   │                 │  Bearer token  │              │                │
   │                 │  [2ms]         │              │                │
   │                 │                │── mTLS ─────▶│                │
   │                 │                │  SPIFFE SVID │                │
   │                 │                │  [2ms]       │                │
   │                 │                │              │── mTLS ───────▶│
   │                 │                │              │  [2ms]         │
   │                 │                │              │                │
```

### Step 1: Authentication & Authorization [5ms budget]
```
Payment Orch.    Identity Service
     │                 │
     │── Validate ────▶│  OIDC token validation
     │   session       │  Check session validity (15-min window)
     │   [3ms]         │  Verify transaction limit
     │◀── OK ──────────│  OTel span: auth.validate
     │                 │
```

### Step 2: Feature Store Retrieval [10ms budget]
```
Payment Orch.    Feature Store (Redis)
     │                 │
     │── Get features ▶│  txn_velocity_30d
     │   customer +    │  device_fingerprint
     │   beneficiary   │  payee_risk_score (new beneficiary = elevated)
     │   [8ms p99]     │  behaviour_90d
     │◀── Features ────│  OTel span: feature_store.get
     │   + freshness   │  Emit: afg_fraud_feature_freshness_seconds
     │                 │
```

### Step 3: Fraud Inference [60ms budget]
```
Payment Orch.    Fraud Inference     Explainability Sidecar
     │                 │                    │
     │── Score ───────▶│                    │
     │   request       │── Compute ────────▶│  SHAP values
     │   [gRPC]        │   score: 0.72      │  Top factors:
     │                 │   (BORDERLINE)      │  1. new_beneficiary (+0.3)
     │                 │                    │  2. amount_percentile (+0.2)
     │                 │◀── Attribution ────│  3. txn_velocity (+0.15)
     │                 │   [8ms]            │
     │◀── Response ────│                    │
     │   score: 0.72   │  OTel span: fraud.inference
     │   decision: HOLD│  Emit: afg_fraud_inference_latency_seconds
     │   factors: [3]  │  Kafka: afg.fraud.in.scores
     │   [55ms total]  │
     │                 │
```

### Step 4: Decision Orchestration — HOLD [5ms budget]
```
Payment Orch.    Decision Orchestrator    Rules Engine
     │                 │                      │
     │── Route ───────▶│                      │
     │   score=0.72    │── Cross-check ──────▶│  Amount > ₹1L to new payee
     │   [2ms]         │   rules              │  Confirm HOLD
     │                 │◀── HOLD confirmed ───│
     │◀── HOLD ────────│                      │
     │                 │  OTel span: decision.route
     │                 │  Kafka: afg.fraud.in.decisions {HOLD}
     │                 │
```

### Step 5: Kafka Event Publication [async, 5ms budget]
```
Payment Orch.    Kafka
     │                 │
     │── Publish ─────▶│  Topic: afg.payments.in.transactions
     │   txn event     │  Topic: afg.fraud.in.decisions
     │   [async, 3ms]  │  Topic: afg.audit.in.artefacts
     │                 │  OTel span: kafka.produce
     │                 │
```

### Step 6: Step-Up Authentication [out-of-band, 30-60s]
```
Payment Orch.    Step-Up Auth         Mobile App          Customer
     │                 │                  │                   │
     │── Trigger SCA ─▶│                  │                   │
     │   biometric     │── Push notify ──▶│                   │
     │                 │                  │── Fingerprint ───▶│
     │                 │                  │◀── Confirm ───────│
     │                 │◀── SCA success ──│                   │
     │◀── SCA passed ──│                  │                   │
     │                 │  OTel span: sca.challenge             │
     │                 │  Timeout: 120s → decline              │
     │                 │                                       │
```

### Step 7: Score still borderline — Escalate to Contact Centre [within 60s]
```
Payment Orch.    Human Review Queue    Contact Centre Console
     │                 │                      │
     │── Escalate ────▶│                      │
     │   reason: score │── Assign agent ─────▶│  Agent sees:
     │   0.72 + new    │   within 30s         │  - Transaction details
     │   beneficiary   │                      │  - Fraud score + factors
     │   context: full │                      │  - Customer history
     │                 │                      │  - SCA result
     │                 │  OTel span: escalation.route
     │                 │  Emit: afg_ai_human_escalation_total
     │                 │
```

### Step 8: Agent Consults AML/Fraud Co-Pilot [5-15s]
```
Contact Centre    LLM Gateway       Guardrails       RAG Pipeline
     │                 │                │                │
     │── Query ───────▶│                │                │
     │  "Is this txn   │── PII redact ─▶│                │
     │   suspicious?   │◀── Clean ──────│                │
     │   Context:      │                │                │
     │   customer X,   │── Retrieve ────────────────────▶│
     │   ₹2.4L to new │                │                │  Case history
     │   beneficiary"  │◀── Context ────────────────────│  KYC records
     │                 │                │                │  Transaction patterns
     │                 │                │                │
     │                 │── Generate (LLM 70B) ──────────▶│ (model inference)
     │                 │◀── Response + citations ────────│
     │                 │                │                │
     │                 │── Output check▶│                │
     │                 │◀── Clean ──────│  PII scan OK   │
     │                 │                │                │
     │◀── Assessment ──│  "Low risk. Customer has regular│
     │   + citations   │   salary credits from same      │
     │   [8s total]    │   employer. First UPI to this   │
     │                 │   beneficiary but payee is a     │
     │                 │   verified merchant. Recommend   │
     │                 │   release."                      │
     │                 │                                  │
     │                 │  OTel span: llm.inference        │
     │                 │  Emit: afg_llm_tokens_total      │
     │                 │  Kafka: afg.audit.in.artefacts   │
```

### Step 9: Mainframe Data Enrichment [during co-pilot call]
```
LLM Gateway      Mainframe Facade    z/OS (cached replica)
     │                 │                    │
     │── Get account ─▶│                    │
     │   context       │── Read cache ─────▶│  Corporate relationship
     │   [via tool]    │◀── Response ───────│  Trade history
     │   [15ms]        │                    │  Account tenure
     │◀── Context ─────│                    │
     │                 │  OTel span: mainframe.facade.get
     │                 │  Note: reads from cache, NOT live z/OS call
     │                 │
```

### Step 10: Agent Releases Transaction
```
Contact Centre    Human Review Queue    Payment Orch.    Audit Service
     │                 │                      │                │
     │── APPROVE ─────▶│                      │                │
     │   rationale:    │── Release ──────────▶│                │
     │   "verified     │   decision           │── Settle ─────▶│ (NPCI/UPI)
     │   merchant,     │                      │                │
     │   regular       │                      │── Audit ───────▶│
     │   customer"     │                      │   full chain:  │
     │                 │                      │   score, factors│
     │                 │                      │   SCA result   │
     │                 │                      │   copilot query│
     │                 │                      │   agent decision│
     │                 │                      │   settlement   │
     │                 │                      │   [7-year keep]│
     │                 │  OTel span: human.decision
     │                 │  Kafka: afg.fraud.in.decisions {RELEASE}
     │                 │  Kafka: afg.audit.in.artefacts
     │                 │
```

### Step 11: Customer Notification + Settlement
```
Payment Orch.    Notification Service    Customer
     │                 │                    │
     │── Notify ──────▶│                    │
     │   "Payment      │── Push + SMS ─────▶│  "₹2,40,000 sent to
     │    released"    │                    │   [beneficiary]"
     │                 │                    │
     │                 │  OTel span: notification.send
     │                 │
```

## Latency Budget Summary

| Phase | Budget | Actual (p99) | Observability Signal |
|-------|--------|-------------|---------------------|
| Auth + routing | 10ms | ~7ms | `auth.validate`, `bff.route` |
| Feature retrieval | 10ms | ~8ms | `feature_store.get` |
| Fraud inference | 60ms | ~55ms | `fraud.inference` |
| Decision routing | 5ms | ~3ms | `decision.route` |
| Kafka publish | 5ms | ~3ms | `kafka.produce` |
| **Total (approve path)** | **100ms** | **~76ms** | End-to-end trace |
| Step-up SCA | 120s max | 30-60s | `sca.challenge` |
| Agent escalation | 30s max | ~15s | `escalation.route` |
| Co-pilot response | 15s max | ~8s | `llm.inference` |

## Failure/Timeout Behaviour

| Component | Timeout | Failure Action |
|-----------|---------|---------------|
| Feature Store | 20ms | Use stale features (warn) |
| Fraud Inference | 200ms | Fall back to rules engine |
| Rules Engine | 500ms | Route to human review |
| Step-Up Auth | 120s | Decline transaction |
| LLM Co-Pilot | 30s | Manual assessment only |
| Mainframe Facade | 5s | Proceed without enrichment |
| Kafka publish | 5s | Buffer and retry (DLQ) |
