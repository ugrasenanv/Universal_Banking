# Task 8: AML and Sanctions Services

## Summary

Implements AML alert triage with GenAI narrative generation and SAR drafting, plus ML-augmented sanctions screening with LLM disambiguation.

## Sub-Tasks

### 8.1 — AML Triage Service

**Requirements**: 3.1–3.9

**Purpose**: AI-assisted AML alert classification, narrative generation, and SAR draft preparation with mandatory human-in-the-loop.

**Interface**:
```typescript
interface AMLTriageService {
  classifyAlert(alert: AMLAlert): Promise<AlertClassification>;
  generateNarrative(caseId: string, request: NarrativeRequest): Promise<NarrativeResult>;
  draftSAR(caseId: string, request: SARDraftRequest): Promise<SARDraftResult>;
}

interface AlertClassification {
  alertId: string;
  disposition: 'ESCALATE_L2' | 'RECOMMEND_CLOSURE' | 'INVESTIGATE';
  priorityScore: number;      // 1-100
  reasoning: string;          // Written explanation of risk factors
  auditArtefact: AuditArtefact;
}

interface NarrativeResult {
  caseId: string;
  narrative: string;
  citations: Citation[];       // Source for every factual claim
  groundednessScore: number;   // 0.00-1.00
  lowConfidenceFlag: boolean;  // true if groundedness < threshold
  generationTimeMs: number;    // Target: <60,000ms
}

interface SARDraftResult {
  caseId: string;
  draft: SARDocument;
  citations: Citation[];
  requiresAnalystApproval: true;  // Always true — HITL mandatory
  dataGaps: DataGap[];            // Missing data sources identified
}
```

**Key Constraints**:
- **HITL Mandatory**: No SAR is ever filed without explicit analyst approval via confirmed UI action
- **60-Second Narrative**: Draft narrative generated within 60 seconds of request
- **45-Minute SAR**: Total analyst interaction time for SAR < 45 minutes (from 3.5h baseline)
- **60% Workload Reduction**: Automated triage of false-positive alerts reduces L1 analyst daily load
- **Source Citations**: Every factual claim (dates, amounts, names, events) includes a citation

**RAG Integration**:
- Corpus: AML case history, transaction patterns, KYC records
- Chunking: 512-1024 tokens, semantic boundaries
- If source system unavailable: notify analyst, identify gaps, block submission without acknowledgement

**Audit Trail**:
Every alert processing produces:
- Prompt used, retrieved context, model output
- Analyst decision (approve/reject/modify)
- Downstream action taken
- Retained for 7 years minimum

---

### 8.2 — Sanctions Screening Service

**Requirements**: 4.1–4.8

**Purpose**: ML-augmented name matching with LLM disambiguation to reduce false positives from 96% to below 70%.

**Interface**:
```typescript
interface SanctionsScreeningService {
  screen(entity: EntityScreeningRequest): Promise<ScreeningResult>;
  disambiguate(matchCase: AmbiguousMatch): Promise<DisambiguationResult>;
}

interface ScreeningResult {
  entityId: string;
  disposition: 'CLEAR' | 'MATCH' | 'AMBIGUOUS' | 'ESCALATE';
  confidence: number;
  matchDetails: MatchDetail[];
  processingTimeMs: number;    // Target: <60,000ms initial disposition
}

interface DisambiguationResult {
  entityId: string;
  refinedDisposition: 'CLEAR' | 'MATCH' | 'ESCALATE';
  reasoning: string;
  contextUsed: string[];
  processingTimeMs: number;    // Target: <30,000ms
}
```

**Performance Targets**:
| Metric | Target |
|--------|--------|
| False Positive Rate | <70% (from 96%) |
| False Negative Rate | No statistically significant increase (95% CI) |
| Initial Disposition | <60 seconds |
| LLM Disambiguation | <30 seconds |
| Onboarding Screening (p95) | <24 hours |
| Disposition Record Retrieval | <5 seconds by case ID |

**Decision Flow**:
```
Entity Submitted
  ↓
Fuzzy Name Matching (ML-augmented)
  ├── High confidence CLEAR → Auto-clear, emit disposition
  ├── High confidence MATCH → Auto-escalate to compliance analyst
  └── AMBIGUOUS (mid-confidence) → LLM Disambiguation
      ├── LLM available → Refined disposition
      └── LLM unavailable → Fallback to rules-based + manual review
```

**Fallback**: If LLM disambiguation service is unavailable within 30 seconds, fall back to existing rules-based process and flag for manual review. The screening pipeline is never blocked.

**Property Tests**:
- Property 7: HITL gate enforcement — no SAR filed without analyst approval
- Property 8: Confidence-threshold routing — low-confidence decisions always routed to human

## Acceptance Criteria Verification

- [ ] AML alert classification produces priority score 1-100 with reasoning
- [ ] Narrative generation completes within 60 seconds with source citations
- [ ] SAR draft requires explicit analyst approval (HITL mandatory)
- [ ] Missing data sources identified and analyst notified
- [ ] Sanctions FP rate reduced from 96% to below 70%
- [ ] Sanctions FN rate shows no statistically significant increase
- [ ] LLM disambiguation completes within 30 seconds
- [ ] Fallback to rules-based if LLM unavailable
- [ ] Disposition records retrievable in <5 seconds
- [ ] All property tests pass
