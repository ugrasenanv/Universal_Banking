# Task 4: Guardrails Engine and LLM Gateway

## Summary

Implements the centralised AI safety layer (Guardrails Engine) and the governed LLM routing service (LLM Gateway) that all GenAI services must pass through.

## Sub-Tasks

### 4.1 — Guardrails Engine

**Requirements**: 14.1, 14.2, 14.3, 14.6, 14.8

**Purpose**: Multi-layer safety pipeline that screens all LLM inputs and outputs.

**Pipeline Architecture**:
```
INPUT Direction:
  Request → Prompt Injection Detection → Jailbreak Detection → PII Redaction → Model

OUTPUT Direction:
  Model → PII Leakage Scan → Toxicity Filter → Policy Compliance → Response
```

**Detection Capabilities**:

| Check | Direction | Target Rate | Action |
|-------|-----------|-------------|--------|
| Prompt Injection | INPUT | ≥95% recall | Block request |
| Jailbreak | INPUT | ≥90% detection | Block request |
| PII Redaction | INPUT | 100% of known PII patterns | Redact before model |
| PII Leakage | OUTPUT | 100% of known PII patterns | Redact before return |
| Toxicity | OUTPUT | Configurable threshold | Block response |
| Indirect Injection (RAG) | INPUT | ≥90% detection | Quarantine document |

**PII Redaction Implementation**:
```typescript
interface PIIRedactor {
  redact(text: string, direction: 'INPUT' | 'OUTPUT'): RedactionResult;
  restore(redactedText: string, redactionMap: RedactionMap, role: PrivilegedRole): string;
}

// PII patterns detected:
// - Aadhaar numbers (12-digit, Verhoeff checksum)
// - PAN numbers (AAAAA0000A format)
// - Phone numbers (Indian, international)
// - Email addresses
// - Bank account numbers
// - Credit card numbers (Luhn validated)
// - Passport numbers
// - Names (NER-based)
// - Addresses (NER-based)
```

**Reversibility**: Only privileged roles (compliance-officer, audit-reviewer) can reverse PII redaction using the stored redaction map.

---

### 4.4 — LLM Gateway

**Requirements**: 13.1–13.7

**Purpose**: Single governed entry point for all LLM inference across the platform.

**Architecture**:
```
Consumer Service
    ↓
LLM Gateway
    ├── Prompt Registry (versioned prompts)
    ├── Model Router (cost-quality optimisation)
    ├── Guardrails Engine (input/output safety)
    ├── Semantic Cache (cache-hit detection)
    ├── Rate Limiter (per-team/use-case/tenant)
    ├── Cost Tracker (token counting, GPU seconds)
    └── Audit Emitter (full request/response record)
    ↓
Model Provider (frontier API / open-weight / self-hosted)
```

**Model Routing Policy**:
```typescript
interface ModelRoutingPolicy {
  route(request: LLMRequest): ModelSelection;
}

// Routing tiers:
// LOW complexity    → 7B-13B models (Llama 3.1 8B, Mistral 7B)
// MEDIUM complexity → 30B-70B models (Llama 3.1 70B, Qwen 72B)
// HIGH complexity   → Frontier APIs (GPT-4, Claude)
// FRONTIER         → Latest frontier (only with DPO approval for data residency)

// Selection factors:
// 1. Task complexity (determined by prompt template metadata)
// 2. Latency requirement (streaming vs batch)
// 3. Cost budget (per-team caps)
// 4. Quality floor (minimum acceptable quality score)
// 5. Data residency (jurisdiction of customer data)
```

**Semantic Caching**:
```typescript
interface SemanticCache {
  lookup(prompt: string, threshold: number): CacheResult | null;
  store(prompt: string, response: string, metadata: CacheMetadata): void;
  invalidate(pattern: string): void;
}
// Uses embedding similarity (cosine > 0.95) for cache hits
// TTL configurable per use case (default: 1 hour)
// Respects data residency — cache is regional
```

**Rate Limiting**:
- Per-team: requests/minute, tokens/hour
- Per-use-case: configurable limits based on business priority
- Per-tenant: overall platform quotas
- Cost caps: monthly spend limits with alerting at 80%

**Audit Record**:
Every LLM request emits:
```json
{
  "requestId": "uuid",
  "timestamp": "ISO8601",
  "consumingService": "aml-triage",
  "promptId": "prompt-registry-id",
  "promptVersion": "v2.3.1",
  "modelId": "llama-3.1-70b",
  "modelVersion": "2024-q4",
  "inputTokens": 2340,
  "outputTokens": 512,
  "latencyMs": 1847,
  "cacheHit": false,
  "guardrailTriggered": false,
  "costUSD": 0.0023,
  "jurisdiction": "IN"
}
```

**Property Tests**:
- Property 15: Model routing always selects cheapest model meeting quality floor
- Property 9: Data residency enforcement — no customer data crosses jurisdictional boundary
- Property 22: Prompt injection and jailbreak detection rates meet thresholds
- Property 10: PII redaction completeness — no PII leaks in prompts or responses

## Acceptance Criteria Verification

- [ ] All LLM requests route through the gateway (no direct model API access)
- [ ] Prompt injection detection achieves ≥95% recall on test set
- [ ] Jailbreak detection achieves ≥90% on test set
- [ ] PII is redacted before reaching model and in responses
- [ ] Model routing selects cheapest model meeting quality floor
- [ ] Semantic cache reduces redundant inference calls
- [ ] Rate limiting blocks requests exceeding quotas
- [ ] Audit record emitted for every LLM request
- [ ] All property tests pass
