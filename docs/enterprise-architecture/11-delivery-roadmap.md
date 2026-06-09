# Part 10 — Delivery Roadmap & Risk Register

## 10A. Phased Roadmap

### Wave 1: Foundation + MVP (Months 1-6)

**MVP Use Case**: Real-time Payment Fraud (UC-01) — India region

**Rationale**: Highest immediate business value (₹800Cr+ fraud loss), proven ML pattern, measurable outcome within 90 days, exercises core platform components (streaming, feature store, inference, audit).

| Month | Deliverable |
|-------|-------------|
| 1-2 | Platform foundation: K8s clusters, Kafka, Feature Store, Identity, Service Mesh |
| 2-3 | LLM Gateway + Guardrails Engine (required for all GenAI services) |
| 3-4 | Fraud Inference Service + online feature pipeline (India UPI) |
| 4-5 | Audit Service + observability stack + shadow scoring |
| 5-6 | Production rollout (India, UPI only) + salary-day load test |

**Exit Criteria**: Fraud FP rate < 2.5%, p99 < 100ms, 82K TPS sustained

---

### Wave 2: Risk & Credit (Months 4-9)

| Month | Deliverable |
|-------|-------------|
| 4-5 | AML Triage Service + RAG Pipeline (case history corpus) |
| 5-6 | Sanctions Screening Service + LLM disambiguation |
| 6-7 | Credit Underwriting Service (retail unsecured, India) |
| 7-8 | Fairness monitoring + challenger model framework |
| 8-9 | Human Review Queue + Model Registry + Governance Framework |

**Exit Criteria**: AML L1 workload -60%, sanctions FP < 70%, credit TAT < 4h

---

### Wave 3: Customer Experience (Months 7-12)

| Month | Deliverable |
|-------|-------------|
| 7-8 | Conversational AI (English + Hindi, mobile app) |
| 8-9 | Expand to 11 languages + IVR channel |
| 9-10 | RM Copilot (Singapore + Dubai wealth operations) |
| 10-11 | Document Intelligence (KYC + trade finance) |
| 11-12 | Branch Copilot + Complaints Intelligence + NBA Engine |

**Exit Criteria**: AHT < 3m30s, RM data-gathering < 15%, 20% cross-sell lift

---

### Wave 4: Global Rollout & Stabilisation (Months 10-18)

| Month | Deliverable |
|-------|-------------|
| 10-12 | Multi-region deployment (Singapore, UAE, UK) |
| 12-14 | Card fraud (UC-02) + behavioural credit-line (UC-06) |
| 14-16 | FinOps maturity + cost optimisation (25% reduction target) |
| 16-18 | DORA compliance (UK/EU) + exit testing + governance maturity |

**Exit Criteria**: 99.99% availability, cloud spend -25%, full SR 11-7 alignment

---

### Roadmap Gantt (Simplified)

```
Month:  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18
        ├──────────────────┤
Wave 1: Foundation + Fraud MVP
              ├────────────────────┤
Wave 2:       Risk & Credit
                       ├──────────────────────┤
Wave 3:                Customer Experience
                                   ├──────────────────────────────┤
Wave 4:                            Global Rollout & Stabilisation
```

---

## 10B. Risk Register

| ID | Category | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R01 | Technical | Model drift degrades fraud accuracy post-deployment | Medium | High | Automated drift detection + monthly champion/challenger | Model Risk Officer |
| R02 | Technical | Vector DB scaling bottleneck at 41M customer embeddings | Low | Medium | Horizontal partitioning + index sharding strategy | Platform Lead |
| R03 | Technical | Mainframe MIPS budget insufficient for real-time CDC | Medium | High | Batch-windowed extraction + cached replica pattern | Integration Architect |
| R04 | Technical | Vendor API deprecation (managed LLM) | Medium | Medium | Multi-provider routing + open-weight primary | AI Platform Lead |
| R05 | Operational | GPU capacity unavailable in India region | Medium | High | Reserved instances + multi-provider contracts + CPU fallback for 7B models | Cloud Ops |
| R06 | Operational | Cost runaway from GenAI token usage | High | Medium | Hard cost caps + model routing + semantic caching + monthly FinOps reviews | CFO / FinOps Lead |
| R07 | Operational | On-call complexity with 12 AI services | High | Medium | Unified observability + runbooks + degradation hierarchy | SRE Lead |
| R08 | Operational | AI/ML talent scarcity | High | High | Cross-training + managed service usage + CoE model | CTO / HR |
| R09 | Compliance | DPDP Act enforcement stricter than architected | Medium | High | Residency by default + DPO approval gates + annual review | DPO |
| R10 | Compliance | Cross-border data violation (accidental) | Low | Critical | Technical enforcement at platform level + audit + alerting | DPO / CISO |
| R11 | Compliance | SR 11-7 / RBI MRM gap in challenger regime | Medium | High | Monthly comparison reports + validation independence enforcement | Model Risk Officer |
| R12 | AI Governance | Hallucination in customer-facing GenAI | Medium | High | Groundedness scoring + refusal threshold + HITL escalation | AI Safety Lead |
| R13 | AI Governance | Bias in credit model disadvantages protected group | Medium | Critical | Fair-lending gate (ratio < 0.80 blocks execution) + monthly reporting | Model Risk Officer |
| R14 | AI Governance | Adversarial attack on AML co-pilot (prompt injection) | Low | High | Guardrails engine (≥95% detection) + quarterly red-team + doc scanning | CISO |
| R15 | Adoption | Contact centre agents distrust AI recommendations | High | Medium | Phased rollout + confidence indicators + "AI suggested" framing | Change Lead |
| R16 | Adoption | RMs resist Copilot adoption | Medium | Medium | Co-design with top RMs + measurable time savings + opt-in initially | Wealth Tech Lead |
| R17 | Adoption | Executive sponsorship weakens mid-programme | Low | Critical | Monthly Board reporting with measurable KPIs per wave | Programme Director |
| R18 | Vendor | Vector DB vendor bankruptcy (90-day EOL) | Low | High | pgvector (open-source) as primary; Milvus as documented alternative; exit runbook | Platform Lead |
| R19 | Vendor | Cloud provider outage during salary day | Low | Critical | Multi-AZ + pre-warmed capacity + region failover + chaos testing | SRE Lead |
| R20 | Vendor | LLM provider changes pricing >50% YoY | Medium | Medium | Open-weight models as primary; managed APIs only for frontier tasks | AI Platform Lead |

### Exit Triggers (Named)

| Vendor | Exit Trigger | Exit Timeline | Alternative |
|--------|-------------|---------------|-------------|
| Primary Cloud | Outage >4hrs affecting production OR price increase >50% | 90 days | Secondary cloud (already configured) |
| Managed LLM API | Price >2x OR quality regression >10% | 30 days | Self-hosted open-weight models |
| Vector DB vendor | Bankruptcy OR security breach | 90 days | pgvector (already running as backup) |
| Streaming vendor | Protocol incompatibility OR EOL | 60 days | Redpanda (Kafka-compatible) |
| Identity provider | Security breach OR compliance failure | 60 days | Keycloak (open-source, self-hosted) |
