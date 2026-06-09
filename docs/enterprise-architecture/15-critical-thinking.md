# Part 15 — Critical Thinking & Architecture Challenge Responses

## T1. Centralised Global Vector DB for 41M Customers

**Position**: Reject. A single global vector database for 41M customer profiles violates data residency regulations in at least 3 jurisdictions.

**Regulations Cited**:
- **RBI Master Direction on IT Governance**: Indian customer data must be stored in India
- **DPDP Act 2023 (India)**: Data localisation for personal data
- **MAS Notice 655**: Financial institutions must store and process SG customer data in approved locations
- **UAE PDPL**: Personal data processing restricted to UAE territory
- **GDPR Article 44-49**: Cross-border transfer restrictions for UK customers

**Alternative Architecture**:
- Regional vector stores (one per jurisdiction) with no cross-border replication of customer PII
- Wealth RM Copilot queries only the local jurisdictional vector store for that client
- If cross-jurisdictional context needed: anonymised aggregates only, with DPO approval
- Global metadata index (customer ID → jurisdiction mapping) to route queries correctly

---

## T2. Frontier LLM in the Fraud Decline Path

**Position**: Reject on three grounds.

**1. Latency**: Frontier LLM inference takes 2-10 seconds. The fraud decline path has a 100ms p99 budget. Including an LLM in the synchronous decline path is architecturally impossible without violating the latency SLA.

**2. Model Risk / Adverse-Action**: A stochastic LLM producing decline reasons creates regulatory exposure. Adverse-action notices under fair-lending regulations must be deterministic and reproducible. An LLM may generate different explanations for the same decline, making the bank unable to demonstrate consistency in regulatory examination.

**3. Operational Cost**: At 82,000 TPS peak, generating frontier LLM text for every decline (~5% of transactions = 4,100/sec) would cost approximately $40,000/day in tokens alone, with no incremental revenue to justify it.

**Proposed Alternative**: Pre-computed explanation templates populated with SHAP feature attribution values. The fraud model provides ranked contributing features (deterministic); a lookup table maps feature names to plain-language explanations. Cost: ~$0. Latency: <5ms. Reproducible. Audit-safe.

---

## T3. Eliminate GPU Spend Entirely

**Position**: Partially agree, partially refuse.

| Workload | GPU Required? | CPU Viable? | Trade-off |
|----------|:---:|:---:|---|
| Classical ML (fraud, credit) | No | Yes ✓ | XGBoost/LightGBM runs fine on CPU at <10ms |
| Embedding generation (batch) | Depends | Partial | CPU 10x slower; acceptable for batch, not for real-time query embedding |
| Embedding generation (online) | Yes | No | Query-time embedding at 82K TPS needs GPU; CPU cannot meet latency |
| Reranking (cross-encoder) | Marginal | Yes ✓ | Small model, CPU viable at 200ms p95 for top-50 rerank |
| Generative inference (7B INT4) | Marginal | Partial | CPU viable for low-volume; unacceptable latency for high-volume |
| Generative inference (70B) | Yes | No | 70B on CPU = 30-60 seconds per response; unusable |

**Quantified Trade-off**:
- Eliminating GPUs saves ~35-45% of platform cost
- But generative services (conversational AI at 11 languages, RM Copilot, AML narrative) become unusably slow (30s+ response time)
- Compromise: use CPU for classical ML and batch embedding; GPU only for online embedding and generative inference

---

## T4. Champion / Challenger Regime

**Architecture Pattern**:
```
Production Traffic
  → Champion Model (live scoring, affects decisions)
  → [Sample: 10% configurable] → Challenger Model (shadow scoring, log only)
      → Results logged to comparison dataset
      → Monthly automated comparison report
      → No impact on live decisions (ever)
```

**Key Design Decisions**:
- Shadow scoring is fire-and-forget (async) — adds ≤5ms to production path
- Challenger receives the same input features as champion (point-in-time snapshot)
- Results stored in separate comparison table (not mixed with production audit)
- Monthly report: accuracy, FP rate, FN rate, fairness metrics, latency
- Promotion decision requires Model Risk Officer + independent validation team approval

**Load Impact**: <5% additional GPU load (10% sample × 50% overhead for async call)

---

## T5. Salary-Day Capacity Calculation

See detailed calculation in [09-scalability-reliability.md](./09-scalability-reliability.md).

Summary: 8 GPUs (4 pods × 2 GPU), 6-node Redis cluster, 12 Kafka partitions, pre-warmed 30 minutes before spike.

---

## T6. Fully Agentic SME Loan Disbursement

**Position**: Refuse autonomous disbursement. Recommend assisted-autonomy with human gate.

**Regulatory Exposure**: Under RBI guidelines, a loan disbursement is a legally binding financial commitment. Fully autonomous AI disbursement of ₹50 lakh (₹5M) without human oversight creates:
- No recourse if model makes systematic errors
- Regulatory liability if adverse-action rights are violated
- Fraud vector if agentic system is manipulated

**What We Would Deliver Instead**:
- **Level 3 Autonomy** (AI recommends, human approves for >₹10L):
  - AI scores application, gathers documents, prepares disbursement package
  - Human credit officer reviews and approves with one-click
  - Below ₹10L: auto-approve if confidence >0.90 and fairness check passes
  - Above ₹10L: mandatory human approval
- **Kill switches**: Manual override, daily limit caps, automatic halt on anomaly detection

---

## T7. "Fully Managed RAG" Vendor Pitch

**Position**: Do not sign.

**Hidden Costs**: Egress fees for embedding refresh, per-query pricing that scales with adoption, index storage on their infrastructure (metered).

**Hidden Risks**:
- **Data residency violation**: Vendor's global index means Indian customer data may transit through non-Indian infrastructure
- **IP exposure**: Bank's internal documents (policies, case histories) on vendor's infrastructure
- **Exit lock-in**: Proprietary embedding model means vectors are non-portable
- **Vendor bankruptcy**: 90-day EOL leaves bank without search capability

**Alternative**: Self-hosted pgvector + open embedding model. Higher upfront effort but full control, portability, and residency compliance. The 30% cost saving evaporates when factoring in egress, exit costs, and compliance risk.

---

## T8. Single Open-Source Frontier Model Standardisation

**Position**: Reject single-model standardisation.

**When Model Pluralism is Worth It**:
- Different latency requirements (100ms fraud vs 10s RM copilot)
- Different quality needs (simple classification vs complex reasoning)
- Different cost profiles (high-volume low-complexity vs low-volume high-complexity)
- Different language requirements (Indian languages vs English/Mandarin)

**When It's Noise**: If two services have identical requirements (same latency, same quality, same language), consolidate them on one model.

**Our Portfolio**: 3-4 model tiers, not 1 and not 20.

---

## T9. Deliberately Flawed Requirements

**Identified Contradictions/Flaws**:

1. **"GPT-4-grade multilingual assistant" + "data residency"** (Section 5.1 + 5.3): GPT-4 is a managed API that processes data on OpenAI's infrastructure (US). This directly contradicts the requirement for Indian data to stay in India. You cannot have GPT-4-grade output AND data residency compliance simultaneously for Indian customers without DPO-approved anonymisation.

2. **"<100ms p99 fraud scoring" + "feature-attribution explanation in the same response payload"** (Section 5.2): Real-time SHAP computation for complex models adds 20-50ms. Requiring full feature attribution within the 100ms budget is achievable only with pre-computed approximate explanations, not live SHAP. The requirement implicitly forces an architecture choice it doesn't acknowledge.

3. **"Reduce cloud spend by 25%" + "99.99% availability" + "GPU for 12 use cases"** (Section 5.3): These three goals are in direct tension. 99.99% availability requires redundancy (cost). GPU inference for 12 use cases at scale is expensive. Reducing spend by 25% while adding capabilities requires aggressive optimisation that may compromise availability headroom.

4. **"Every customer-impacting AI decision must produce an auditable artefact retained for 7 years"** (Section 5.4) at 82,000 TPS peak: This means 82,000 audit artefacts per second during salary day. At ~2KB per artefact, that's 164MB/sec of audit writes sustained for 90 minutes = ~885GB of audit data in a single salary-day window. The storage and write-throughput implications are significant and under-specified.

**How I Would Address These With the Client**:
"I want to flag four areas where we see productive tension in the requirements. These aren't problems — they're design choices we need to make together. Let me walk you through each one and the trade-off we recommend..."

---

## T13. CISO vs CMO Conflict

**Position**: Both are right. Reconcile via a routing policy.

**Routing Policy**:
```
IF query contains customer PII:
    route → On-premise GPU cluster (70B open-weight model)
    Quality: ~85% of GPT-4 for Indian languages
ELIF query is internal-only (policies, products, research):
    route → On-premise GPU cluster (no data risk)
ELIF query is anonymised/aggregated (no PII):
    route → Frontier API (GPT-4 grade)
    Pre-condition: PII redacted by Guardrails Engine + DPO approval for use case
ELIF query is in a well-supported language (EN, ZH):
    route → On-premise 70B (quality sufficient)
ELIF query is in under-represented language AND no PII:
    route → Frontier API (better multilingual quality)
```

**Net Result**: CISO gets air-gapped inference for PII-bearing queries. CMO gets GPT-4-grade output for non-PII queries and anonymised scenarios. Gap for Indian language PII queries bridged by fine-tuning open-weight models on Indian language data.

---

## T14. Hidden GenAI Cost Line Items

| # | Cost Item | % of Total Platform Cost (Est.) | Why CFO Missed It |
|---|-----------|---:|---|
| 1 | Evaluation harness (automated quality + safety evals) | 3-5% | Not visible until models are in production |
| 2 | Prompt iteration (A/B testing, versioning, staging) | 2-3% | Looks like "development" but is ongoing production cost |
| 3 | Embedding refresh (re-embedding corpus on model update) | 2-4% | Triggered by model upgrades, not predictable |
| 4 | Observability for LLMs (token logging, trace storage, dashboards) | 4-6% | 10x more verbose than traditional service observability |
| 5 | Safety review and red-teaming (quarterly, per service) | 2-3% | Human expert time, not infrastructure |
| 6 | Eval data curation (golden datasets for each use case) | 1-2% | Ongoing: drift requires new eval data |
| 7 | Fine-tuning runs (Indian languages, domain adaptation) | 3-5% | GPU-intensive, periodic but significant |

**Total Hidden**: 17-28% of platform cost is invisible at budgeting time.
