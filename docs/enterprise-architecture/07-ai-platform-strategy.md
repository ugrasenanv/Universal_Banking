# Part 7 — AI / GenAI Platform Strategy

## 7A. RAG Design

### Chunking Strategy

| Corpus | Strategy | Chunk Size | Overlap | Rationale |
|--------|----------|-----------|---------|-----------|
| AML Case History | Hierarchical (semantic) | 512-1024 tokens | 20% | Investigation narratives need long context; semantic boundaries preserve reasoning chains |
| Wealth Product/Research | Structural (section-based) | 256-512 tokens | 10% | Dense factual content; smaller chunks improve precision retrieval |
| Policies/Circulars | Structural (heading-based) | 256-512 tokens | 15% | Well-structured docs; section boundaries are natural chunk boundaries |
| KYC Records | Fixed + metadata | 128-256 tokens | 5% | Short structured fields; needs precise field-level retrieval |

### Embedding Strategy

- **Model**: multilingual-e5-large (or equivalent open-weight)
- **Dimensions**: 768 minimum
- **Languages**: All 11 platform languages with cross-lingual capability
- **Refresh cadence**: Incremental (new/updated docs within 1 hour, no full re-index)
- **Corpus refresh**: Append-only vector inserts + soft-delete for updates + periodic compaction

### Retrieval Design

- **Primary**: Hybrid (BM25 lexical + dense vector)
- **Reranker**: Cross-encoder (e.g., BGE-reranker) for top-50 → top-10 refinement
- **Metadata filters**: jurisdiction, document_type, business_unit, confidentiality_level
- **Tenant isolation**: Partition-level enforcement (no cross-tenant vector access)
- **Latency**: top-k within 200ms p95

### Grounding Methodology

- **Citations**: Every factual claim maps to a source chunk (document name, section, date)
- **Structured context windows**: Retrieved chunks formatted with metadata headers
- **Deterministic retrieval contracts**: Fixed retrieval parameters per use case (k, threshold)

### Hallucination Mitigation

- **Groundedness scoring**: NLI-based scorer computes support ratio (0.00-1.00)
- **Refusal threshold**: Score < 0.70 → refuse to present response
- **Retrieval-confidence gate**: If no chunk scores above relevance threshold → refuse
- **Claim-level verification**: Each factual statement scored individually

---

## 7B. Model Strategy

### Model Selection Criteria

| Criterion | Managed Frontier | Open-Weight (70B) | Open-Weight (7B-13B) | Classical ML |
|-----------|-----------------|-------------------|---------------------|--------------|
| Use when | Complex reasoning, multilingual generation | Standard GenAI tasks within residency | Simple classification, routing | Tabular scoring, real-time (<100ms) |
| Latency | 2-10s | 1-5s | 200ms-2s | <10ms |
| Cost | $$$$ | $$ | $ | ¢ |
| Residency | Requires DPO approval for cross-border | Self-hosted, any region | Self-hosted, any region | Self-hosted, any region |
| Examples | GPT-4, Claude | Llama 3.1 70B, Qwen 72B | Llama 3.1 8B, Mistral 7B | XGBoost, LightGBM |

### Fine-Tuning vs RAG vs Prompt Engineering

| Approach | Use Cases | Rationale |
|----------|-----------|-----------|
| **RAG** | AML narrative, RM Copilot, Branch Copilot, Complaints | Dynamic knowledge; avoids retraining on corpus changes |
| **Prompt Engineering** | Conversational AI, dispute summaries, adverse-action notices | Sufficient with good prompts + guardrails |
| **Fine-Tuning (LoRA)** | Indian language generation, tone calibration | Open models need Indian language quality improvement |
| **Classical ML** | Fraud scoring, credit scoring, NBA ranking | Tabular data; latency-critical; interpretable |

### Cost Optimisation

- **Quantisation**: INT8 for 70B models (minimal quality loss), INT4 for 7B models
- **Distillation**: Distil 70B teacher → 7B student for high-volume simple tasks
- **KV-cache reuse**: Shared prefix caching for repeated system prompts
- **Semantic caching**: Cosine > 0.95 cache hit (1-hour TTL, regional scope)
- **Batching**: Continuous batching in vLLM for GPU utilisation >80%
- **Model routing**: Cheapest model meeting quality floor per request

### Model Routing Policy

```
IF task_complexity == LOW AND latency_required < 2s:
    route → 7B-13B model (local GPU)
ELIF task_complexity == MEDIUM:
    route → 70B model (local GPU, quantised)
ELIF task_complexity == HIGH AND data_residency_allows:
    route → Frontier API (with PII redaction)
ELIF task_complexity == HIGH AND !data_residency_allows:
    route → 70B model (local GPU) + indicate capability limitation
```

---

## 7C. Responsible AI & AI Safety

| Threat | Detection Method | Response |
|--------|-----------------|----------|
| Direct prompt injection | Pattern matching + classifier (≥95% recall) | Block request, log attempt |
| Indirect injection (via RAG) | Document scanning at ingest time | Quarantine document |
| Jailbreak attempts | Multi-layer classifier (≥90% detection) | Block, log, alert security |
| PII in prompts | NER + regex (Aadhaar, PAN, phone, email, card) | Redact before model |
| PII in completions | NER + regex scan on output | Redact before return |
| Toxicity | Content safety classifier | Block response |
| Copyright/IP leakage | Source attribution + deduplication check | Flag for review |
| Hallucinations | Groundedness scoring (NLI) | Refuse below threshold |
| Bias (credit/fraud) | Monthly disparate impact reporting | Block if ratio < 0.80 |
| Adverse-action exposure | Explanation audit + fair-lending check | Mandatory HITL review |

### Bias Measurement Methodology

- Compute approval/decline rates per demographic cohort
- Calculate disparate impact ratio: (protected group rate / reference group rate)
- Alert if ratio < 0.85 (warning), block if < 0.80 (violation)
- Demographics: gender, geography, income band, caste, age, marital status
- Frequency: Monthly reports to Model Risk Committee

---

## 7D. Human-in-the-Loop Design

### Escalation Flows

```
AI Decision
  └── Confidence check
      ├── Above threshold → Automated execution
      └── Below threshold → Human Review Queue
          ├── IMMEDIATE: SAR filing, sanctions match, >₹10L hold
          ├── STANDARD: Credit decline, credit-line reduction
          └── LOW: Dispute classification, complaint routing
```

### Confidence Thresholds (per use case)

| Use Case | Auto-Execute Threshold | Escalation Threshold |
|----------|----------------------|---------------------|
| Fraud scoring | >0.85 (decline) or <0.30 (approve) | 0.30-0.85 (HOLD) |
| AML triage | >0.90 (close as FP) | <0.90 (analyst review) |
| Credit underwriting | >0.80 confidence | <0.80 (human underwriter) |
| Sanctions | >0.95 (clear) or >0.95 (match) | Between thresholds |
| Document extraction | >0.85 per field | <0.85 (human review) |

### Audit Trail Structure

Every HITL decision captures:
1. **Prompt**: What was asked of the model
2. **Retrieved context**: What evidence was surfaced (RAG chunks)
3. **Model output**: What the AI recommended
4. **Human decision**: Approve / Reject / Modify
5. **Rationale**: Why the human made that choice
6. **Downstream side-effect**: What happened as a result (SAR filed, payment released, etc.)

### Feedback Loop (PII-Safe)

```
Human Decision
  → Strip PII (replace with tokens)
  → Extract: (input_pattern, correct_output, incorrect_output)
  → Add to feedback dataset
  → Trigger retraining evaluation (quarterly)
  → New model → Challenger deployment → Shadow scoring (3 months)
```
