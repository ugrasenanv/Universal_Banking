# Task 17: Observability and Resilience

## Summary

Implements the OpenTelemetry-based observability stack with AI-specific metrics, and the multi-region resilience layer with auto-scaling and graceful degradation.

## Sub-Tasks

### 17.1 — OpenTelemetry Observability Stack

**Requirements**: 25.1–25.5

**Purpose**: Unified observability across all platform services with AI-specific metrics and LLM observability.

**Architecture**:
```
All Services (instrumented with OTel SDK)
    ↓
OpenTelemetry Collector (per-region)
    ├── Traces → Distributed Trace Store (Jaeger/Tempo)
    ├── Metrics → Prometheus → Grafana Dashboards
    └── Logs → Central Log Aggregation (Loki/OpenSearch)
```

**Distributed Tracing**:
- Trace context propagated across: sync HTTP/gRPC, async Kafka, batch jobs
- Every service emits spans with:
  - Service name, operation, duration
  - Model version (for AI services)
  - Jurisdiction tag
  - Error classification

**AI-Specific Metrics** (Prometheus compatible):
```yaml
# Fraud Service
afg_fraud_inference_latency_seconds{model_version, payment_type}
afg_fraud_inference_score{decision, model_version}
afg_fraud_feature_freshness_seconds{feature_group}
afg_fraud_fallback_activations_total{tier}

# LLM Gateway
afg_llm_request_duration_seconds{model, use_case}
afg_llm_tokens_total{direction, model, use_case}
afg_llm_cost_usd{model, use_case, team}
afg_llm_cache_hit_ratio{use_case}
afg_llm_guardrail_triggers_total{check_type, direction}

# RAG Pipeline
afg_rag_retrieval_latency_seconds{corpus, retrieval_type}
afg_rag_groundedness_score{service}
afg_rag_refusal_total{service, reason}

# Model Governance
afg_model_drift_score{model_id, metric_type}
afg_model_challenger_comparison{model_id, metric}

# General AI
afg_ai_inference_error_rate{service, model}
afg_ai_human_escalation_total{service, reason}
afg_ai_fairness_disparate_impact{model, cohort}
```

**LLM-Specific Observability**:
- Prompt/completion token counts per request
- Model routing decisions (which model was selected and why)
- Guardrail trigger rates (injection, jailbreak, PII, toxicity)
- Cost-per-inference with model breakdown
- Semantic cache hit/miss ratios

**Alerting**:
- Alert fires within **60 seconds** of threshold breach
- Alert channels: PagerDuty, Slack, email
- Severity levels: P1 (immediate), P2 (30 min), P3 (next business day)

**Retention**:
| Data Type | Operational | Regulatory |
|-----------|-------------|------------|
| Traces | 90 days | N/A |
| Metrics | 90 days (full resolution) | 7 years (aggregated) |
| Logs | 90 days | 7 years (audit-relevant) |

---

### 17.2 — Multi-Region Resilience and Auto-Scaling

**Requirements**: 19.1–19.5, 20.1–20.5

**Purpose**: 99.99% availability with multi-region failover, graceful degradation, and predictive auto-scaling.

**Availability Target**: 99.99% = max 4.3 minutes unplanned downtime per month

**Multi-Region Strategy**:
| Component Type | Strategy | Failover |
|---|---|---|
| Stateless services (APIs, inference) | Active-Active | Automatic via DNS |
| Stateful data (PostgreSQL, queues) | Active-Passive | Automated within RTO |
| Vector indices | Active-Passive | Rebuild from WAL |
| Feature Store (online) | Active-Active (replicated) | Automatic |
| Audit Store | Active-Passive per jurisdiction | Within 1 hour RTO |

**RPO/RTO Matrix**:
| Data Class | RPO | RTO |
|---|---|---|
| Transactional (payments, balances) | <1 minute | <5 minutes |
| Audit artefacts | <15 minutes | <1 hour |
| Model artefacts | <1 hour | <4 hours |
| Vector indices | <4 hours | <8 hours |
| Prompt registry | <1 hour | <2 hours |

**Graceful Degradation Hierarchy** (applies to all AI services):
```
Tier 1: Primary ML/GenAI Model
  ↓ detected failure (5-second detection)
Tier 2: Smaller/Distilled Model
  ↓ detected failure
Tier 3: Rules-Based Engine
  ↓ detected failure
Tier 4: Human Handoff
  ↓ capacity exceeded
Tier 5: Safe-Default Response
```

**Auto-Scaling** (GPU-Backed Inference):
```typescript
interface AutoScalePolicy {
  metrics: {
    queueDepth: { threshold: 100, scaleUp: 2 };
    gpuUtilisation: { threshold: 0.75, scaleUp: 1.5 };
    tokenThroughput: { threshold: 10000, scaleUp: 2 };
  };
  preWarm: {
    enabled: true;
    triggersMinutesBefore: 30;     // Pre-warm 30 min before expected peak
    predictablePeaks: ['SALARY_DAY', 'MONTH_END', 'IPL_MATCH'];
  };
  coolDown: {
    scaleDownDelayMinutes: 15;
    minReplicas: 2;
  };
}
```

**Salary Day Handling**:
- Expected: 82,000 TPS sustained for 90 minutes
- Pre-warm: Scale up GPU pods 30 minutes before last working day
- Monitor: Real-time TPS dashboard with automatic alert at 80% capacity
- Verify: All latency SLAs maintained throughout peak

**Latency-Aware Routing**:
- Requests routed to nearest region with available capacity
- If primary region saturated → spill to secondary region
- If both saturated → activate pre-provisioned burst capacity

**Chaos Engineering**:
- Monthly chaos tests: kill random pods, simulate AZ failure, inject latency
- Quarterly: simulate full region outage
- Annual: exit testing (migrate workloads between providers)

## Acceptance Criteria Verification

- [ ] OpenTelemetry traces propagate across sync, async, and batch paths
- [ ] AI-specific metrics exposed via Prometheus endpoints
- [ ] LLM observability captures tokens, routing, guardrails, cost
- [ ] Alerts fire within 60 seconds of threshold breach
- [ ] 99.99% availability maintained (monthly measurement)
- [ ] Failover works within defined RTO per data class
- [ ] Degradation hierarchy activates in correct order
- [ ] Auto-scaling handles 82,000 TPS salary-day spike
- [ ] Pre-warming activates 30 minutes before predicted peaks
- [ ] Latency-aware routing directs to nearest available region
- [ ] Chaos tests run monthly and pass
