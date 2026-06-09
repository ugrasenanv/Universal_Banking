# Part 5 — Component Diagrams

## Component 1: Real-Time Payment Fraud Service (UC-01)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FRAUD INFERENCE SERVICE                                    │
│                                                                             │
│  ┌───────────────────┐    ┌───────────────────┐    ┌────────────────────┐  │
│  │ Request Handler   │───▶│ Feature Assembler │───▶│ Model Inference    │  │
│  │                   │    │                   │    │ Engine             │  │
│  │ Port: gRPC/8080   │    │ Calls Feature     │    │                    │  │
│  │ Protocol: Protobuf│    │ Store (Redis)     │    │ Triton/ONNX        │  │
│  │ Timeout: 200ms    │    │ p99 < 10ms        │    │ XGBoost/LightGBM   │  │
│  │                   │    │                   │    │ Batch: 1-64        │  │
│  │ Failure: reject   │    │ Failure: stale    │    │ Latency: <60ms     │  │
│  │ with safe-default │    │ features warning  │    │                    │  │
│  └───────────────────┘    └───────────────────┘    └────────┬───────────┘  │
│                                                             │              │
│  ┌───────────────────┐    ┌───────────────────┐            │              │
│  │ Explainability    │◀───│ Decision Router   │◀───────────┘              │
│  │ Sidecar           │    │                   │                           │
│  │                   │    │ Thresholds:       │    ┌────────────────────┐  │
│  │ SHAP values       │    │ decline > 0.85    │    │ Shadow Scorer      │  │
│  │ Top 3-5 factors   │    │ hold: 0.60-0.85   │    │                    │  │
│  │ <10ms compute     │    │ approve < 0.60    │    │ Challenger model   │  │
│  │                   │    │                   │    │ Async fire-forget  │  │
│  │ Protocol: gRPC    │    │ Protocol: internal│    │ ≤5ms added latency │  │
│  │ Failure: degrade  │    │ Failure: rules    │    │ Log only, no live  │  │
│  │ to top-3 only     │    │ fallback          │    │ impact             │  │
│  └───────────────────┘    └───────────────────┘    └────────────────────┘  │
│                                                                             │
│  ┌───────────────────┐    ┌───────────────────┐                           │
│  │ Circuit Breaker   │    │ Audit Emitter     │                           │
│  │                   │    │                   │                           │
│  │ 3 failures → OPEN│    │ Kafka producer    │                           │
│  │ 10s → HALF_OPEN  │    │ Topic: fraud.dec  │                           │
│  │ 5-tier hierarchy  │    │ 7-year retention  │                           │
│  │                   │    │                   │                           │
│  │ Protocol: internal│    │ Protocol: Kafka   │                           │
│  │ Failure: next tier│    │ Failure: DLQ      │                           │
│  └───────────────────┘    └───────────────────┘                           │
└─────────────────────────────────────────────────────────────────────────────┘

External Dependencies:
  → Feature Store (Redis, gRPC, p99 < 10ms)
  → Kafka (fraud.scores, fraud.decisions topics)
  → Audit Service (via Kafka async)
  → Rules Engine (fallback, gRPC)
  → Human Review Queue (for HOLD decisions)
```

**Portability**: Model served via ONNX Runtime or Triton (open protocols). Feature Store accessed via gRPC (portable). Kafka via standard protocol.
**Failure Mode Optimised Against**: Latency spike during peak load — pre-warmed pods + circuit breaker ensure graceful degradation rather than cascading timeout.

---

## Component 2: LLM Gateway and Orchestration Plane

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      LLM GATEWAY                                             │
│                                                                             │
│  ┌───────────────────┐    ┌───────────────────┐    ┌────────────────────┐  │
│  │ Request Router    │───▶│ Prompt Registry   │───▶│ Semantic Cache     │  │
│  │                   │    │ Client            │    │                    │  │
│  │ Port: gRPC/8443   │    │                   │    │ Cosine > 0.95 hit │  │
│  │ Protocol: Protobuf│    │ Version lookup    │    │ TTL: per use-case  │  │
│  │ Auth: mTLS+RBAC   │    │ Ownership check   │    │ Regional scope     │  │
│  │                   │    │ Approval status   │    │                    │  │
│  │ Failure: reject   │    │                   │    │ Protocol: Redis    │  │
│  │ unapproved prompts│    │ Protocol: REST    │    │ Failure: cache miss│  │
│  └───────────────────┘    │ Failure: reject   │    │ → proceed to model │  │
│                           └───────────────────┘    └────────┬───────────┘  │
│                                                             │              │
│  ┌───────────────────┐    ┌───────────────────┐            │ (cache miss) │
│  │ Rate Limiter      │    │ Model Router      │◀───────────┘              │
│  │                   │    │                   │                           │
│  │ Per-team quotas   │    │ LOW → 7B-13B      │    ┌────────────────────┐  │
│  │ Per-use-case caps │    │ MED → 30B-70B     │───▶│ Model Provider     │  │
│  │ Cost caps (monthly│    │ HIGH → Frontier   │    │ Abstraction        │  │
│  │                   │    │                   │    │                    │  │
│  │ Protocol: internal│    │ Factors: task,    │    │ vLLM (self-host)   │  │
│  │ Failure: HTTP 429 │    │ latency, cost,    │    │ OpenAI-compat API  │  │
│  │                   │    │ residency, quality│    │ Managed API (ext)  │  │
│  └───────────────────┘    │                   │    │                    │  │
│                           │ Protocol: internal│    │ Protocol: OpenAI   │  │
│                           │ Failure: downgrade│    │ Failure: next model│  │
│                           └───────────────────┘    └────────────────────┘  │
│                                                                             │
│  ┌───────────────────┐    ┌───────────────────┐    ┌────────────────────┐  │
│  │ Guardrails        │    │ Observability     │    │ Audit Emitter      │  │
│  │ Integration       │    │ Tap               │    │                    │  │
│  │                   │    │                   │    │ Every request:     │  │
│  │ INPUT: injection, │    │ OTel traces       │    │ prompt, model,     │  │
│  │ jailbreak, PII    │    │ Token metrics     │    │ output, latency,   │  │
│  │ OUTPUT: PII leak, │    │ Cost tracking     │    │ tokens, cost       │  │
│  │ toxicity, policy  │    │ Cache hit ratio   │    │                    │  │
│  │                   │    │                   │    │ Protocol: Kafka    │  │
│  │ Protocol: gRPC    │    │ Protocol: OTLP    │    │ Failure: DLQ       │  │
│  │ Failure: block req│    │ Failure: degrade  │    │                    │  │
│  └───────────────────┘    └───────────────────┘    └────────────────────┘  │
│                                                                             │
│  ┌───────────────────┐                                                     │
│  │ Eval Harness      │                                                     │
│  │                   │                                                     │
│  │ Quality gates     │                                                     │
│  │ Safety gates      │                                                     │
│  │ Bias checks       │                                                     │
│  │ Pre-production    │                                                     │
│  │                   │                                                     │
│  │ Protocol: REST    │                                                     │
│  │ Failure: block    │                                                     │
│  │ promotion         │                                                     │
│  └───────────────────┘                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Portability**: All model access via OpenAI-compatible API. Cache uses Redis protocol. Audit via Kafka protocol.
**Failure Mode Optimised Against**: Model provider outage — router automatically degrades to next-best model meeting quality floor.

---

## Component 3: AML Alert Triage + Narrative Generation (UC-03)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                AML TRIAGE SERVICE                                             │
│                                                                             │
│  ┌───────────────────┐    ┌───────────────────┐    ┌────────────────────┐  │
│  │ Alert Intake      │───▶│ Triage Classifier │───▶│ Priority Scorer    │  │
│  │                   │    │                   │    │                    │  │
│  │ Kafka consumer    │    │ Classification:   │    │ Score: 1-100       │  │
│  │ Topic: aml.alerts │    │ ESCALATE_L2       │    │ Reasoning summary  │  │
│  │                   │    │ RECOMMEND_CLOSE   │    │ Risk factor list   │  │
│  │ Protocol: Kafka   │    │ INVESTIGATE       │    │                    │  │
│  │ Failure: DLQ      │    │                   │    │ Protocol: internal │  │
│  │                   │    │ Protocol: gRPC    │    │ Failure: ESCALATE  │  │
│  └───────────────────┘    │ Failure: escalate │    │ by default         │  │
│                           └───────────────────┘    └────────────────────┘  │
│                                                                             │
│  ┌───────────────────┐    ┌───────────────────┐    ┌────────────────────┐  │
│  │ RAG Retriever     │    │ Narrative         │    │ SAR Drafter        │  │
│  │                   │    │ Generator         │    │                    │  │
│  │ Corpus: case      │    │                   │    │ Template-guided    │  │
│  │ history, KYC,     │    │ LLM Gateway call  │    │ LLM generation     │  │
│  │ transactions      │    │ Grounded output   │    │ Regulatory format  │  │
│  │                   │    │ Citations for     │    │ Field-by-field     │  │
│  │ Hybrid retrieval  │    │ every fact claim  │    │ <45 min interaction│  │
│  │ Tenant-isolated   │    │ <60s generation   │    │                    │  │
│  │                   │    │                   │    │ Protocol: gRPC     │  │
│  │ Protocol: gRPC    │    │ Protocol: gRPC    │    │ Failure: manual    │  │
│  │ Failure: notify   │    │ Failure: flag as  │    │ drafting fallback  │  │
│  │ analyst of gap    │    │ low-confidence    │    │                    │  │
│  └───────────────────┘    └───────────────────┘    └────────────────────┘  │
│                                                                             │
│  ┌───────────────────┐    ┌───────────────────┐    ┌────────────────────┐  │
│  │ HITL Gate         │    │ Agentic Tool      │    │ Audit Emitter      │  │
│  │                   │    │ Calls             │    │                    │  │
│  │ MANDATORY         │    │                   │    │ Complete chain:    │  │
│  │ No SAR filed      │    │ KYC system query  │    │ prompt, context,   │  │
│  │ without analyst   │    │ Sanctions check   │    │ output, decision,  │  │
│  │ approval          │    │ Transaction fetch │    │ downstream action  │  │
│  │                   │    │ Account balance   │    │                    │  │
│  │ Protocol: REST    │    │                   │    │ 7-year retention   │  │
│  │ Failure: block    │    │ Protocol: gRPC    │    │                    │  │
│  │ submission        │    │ Failure: partial  │    │ Protocol: Kafka    │  │
│  │                   │    │ result + gap note │    │ Failure: DLQ       │  │
│  └───────────────────┘    └───────────────────┘    └────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘

External Dependencies:
  → Kafka (aml.alerts, aml.dispositions topics)
  → RAG Pipeline (gRPC, vector store access)
  → LLM Gateway (gRPC, narrative/SAR generation)
  → KYC System (REST, customer identity data)
  → Sanctions System (gRPC, watchlist status)
  → Transaction History (gRPC, via Feature Store)
  → Human Review Queue (REST, HITL enforcement)
  → Audit Service (Kafka, artefact emission)
```

**Portability**: All external calls via gRPC/REST (open protocols). LLM access via gateway abstraction. Storage via Kafka + Iceberg.
**Failure Mode Optimised Against**: Source system unavailability during narrative generation — service identifies which data sources are unavailable, notifies analyst of gaps, and prevents submission without acknowledgement.
