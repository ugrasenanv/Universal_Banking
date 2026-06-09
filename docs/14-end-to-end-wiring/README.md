# Task 18: End-to-End Wiring and DORA Compliance

## Summary

Wires all services together into complete operational flows, verifies end-to-end latency, and implements DORA-aligned operational resilience for UK/EU operations.

## Sub-Tasks

### 18.1 — Fraud Scoring Critical Path

**Requirements**: 1.1, 17.1, 17.3

**End-to-End Flow**:
```
Mobile App
  → API Gateway (AuthN, rate-limit)
  → BFF (Backend for Frontend)
  → Payment Orchestration Service
  → Fraud Inference Service
      → Feature Store (online features, <10ms)
      → ML Model (score computation)
      → Explainability Sidecar (SHAP values)
  → Decision Orchestrator
      → [APPROVE] → Settlement
      → [HOLD] → Step-Up Auth → Human Review → Release/Decline
      → [DECLINE] → Customer Notification
  → Kafka (fraud.scores, fraud.decisions)
  → Audit Service (7-year retention)
```

**Latency Budget**:
| Hop | Budget |
|-----|--------|
| API Gateway → BFF | 5ms |
| BFF → Payment Orchestration | 5ms |
| Feature Store retrieval | 10ms |
| ML Inference | 60ms |
| Explainability computation | 10ms |
| Decision routing | 5ms |
| Kafka publish (async) | 5ms |
| **Total (p99)** | **<100ms** |

**Security**: mTLS via SPIFFE/SPIRE for all service-to-service calls

---

### 18.2 — AML/Sanctions Flows

**Requirements**: 3.1, 4.3, 4.6

**AML Flow**:
```
AML Alert (from TM system)
  → Streaming Backbone (afg.aml.alerts)
  → AML Triage Service
      → RAG Pipeline (case history retrieval)
      → LLM Gateway (narrative generation)
      → Guardrails Engine (PII redaction, injection detection)
  → Human Review Queue (HITL mandatory)
  → Analyst Decision
  → [Approve SAR] → SAR Filing System
  → Audit Service (complete chain)
```

**Sanctions Flow**:
```
Entity Screening Request
  → Sanctions Screening Service
      → Name Matching Engine (fuzzy/ML)
      → [AMBIGUOUS] → LLM Gateway (disambiguation)
      → Guardrails Engine (safety checks)
  → [CLEAR/MATCH] → Disposition Record
  → [ESCALATE] → Human Review Queue
  → Audit Service (disposition + reasoning)
```

---

### 18.3 — Conversational AI and Copilot Flows

**Requirements**: 7.1, 8.1, 12.1

**Customer Conversation Flow**:
```
Customer Message (Mobile/IVR)
  → API Gateway (AuthN, session validation)
  → Conversational AI Service
      → Language Detection
      → Intent Recognition
      → [Needs data] → RAG Pipeline (product info, FAQ)
      → LLM Gateway (response generation)
      → Guardrails Engine (safety, PII redaction)
      → Content Safety Classifier
  → [Confidence OK] → Response to Customer
  → [Low confidence] → Human Agent Escalation (full context)
  → Audit Service (interaction record)
```

**RM Copilot Flow**:
```
RM Query (Workstation)
  → RM Copilot Service
      → Data Residency Check (jurisdiction enforcement)
      → Customer Data Service (unified profile)
      → RAG Pipeline (research, products)
      → LLM Gateway (synthesis)
      → Guardrails Engine (PII isolation check)
  → [Citations available] → Synthesised Brief
  → [Low groundedness] → Refusal with explanation
  → Audit Service (full trail)
```

---

### 18.4 — Credit and Document Flows

**Requirements**: 5.1, 9.1, 11.1

**Credit Application Flow**:
```
Loan Application (Mobile/Branch)
  → Credit Underwriting Service
      → Feature Store (bureau, alternate data, behaviour)
      → ML Credit Model (scoring)
      → Fairness Gate (disparate impact check)
      → [APPROVE] → Loan Disbursement
      → [DECLINE] → Adverse-Action Generation → Customer Notification
      → [REFER] → Human Review Queue → Manual Underwriting
  → Audit Service (decision + explanation + fairness metrics)
```

**Document Processing Flow**:
```
Document Upload (KYC/Trade Finance)
  → Document Intelligence Service
      → OCR Engine (text extraction)
      → LLM Extraction (structured fields)
      → Confidence Scoring
      → [High confidence] → Validated Result
      → [Low confidence] → Human Review Queue (pre-populated)
      → [Corrupt/Unreadable] → Rejection (within 10s)
  → Audit Service (extraction record)
```

**NBA Flow**:
```
App Open / RM Profile View
  → NBA Engine
      → Feature Store (real-time signals)
      → Recommendation Model (scoring)
      → Fairness Filter
  → Ranked Recommendations with Reasoning
  → Audit Service (recommendation record)
```

---

### 18.5 — DORA-Aligned Operational Resilience

**Requirements**: 30.1–30.4

**Purpose**: Meet Digital Operational Resilience Act (DORA) requirements for UK and EU operations.

**ICT Risk Register**:
```typescript
interface ICTRiskEntry {
  serviceId: string;
  serviceName: string;
  criticalityTier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  impactIfUnavailable: string;
  recoveryPriority: number;
  rto: number;              // minutes
  rpo: number;              // minutes
  dependencies: string[];
  thirdPartyVendors: VendorDependency[];
  lastTestedDate: ISO8601;
  nextTestDue: ISO8601;
}
```

**Third-Party Concentration Risk**:
| Risk Area | Mitigation |
|-----------|-----------|
| Cloud Provider | Multi-cloud capable, no single-provider SPOF |
| LLM Vendor | Multiple providers (open-weight + managed APIs) |
| Vector DB Vendor | pgvector (open-source) as primary, Milvus as alternative |
| Streaming | Kafka (open protocol), compatible with multiple vendors |
| Secrets | Vault (open-source, multi-cloud) |

**Exit Strategy**:
- Documented for every critical vendor dependency
- Executable within 90 days
- Named exit triggers:
  - Vendor bankruptcy announcement
  - Material price increase (>50% YoY)
  - Security breach affecting customer data
  - Regulatory prohibition on vendor

**Recovery Runbooks**:
- One runbook per service per criticality tier
- Tested semi-annually (minimum)
- Includes: detection, escalation, recovery, verification, post-mortem

**Annual Exit Testing**:
- Full migration drill from primary cloud to secondary
- Document: time to migrate, data loss (if any), service impact
- Report to CRO and Board Risk Committee

## Acceptance Criteria Verification

- [ ] Fraud critical path end-to-end latency <100ms p99
- [ ] mTLS enforced on all service-to-service calls
- [ ] AML flow enforces HITL before SAR filing
- [ ] Sanctions flow falls back to rules-based if LLM unavailable
- [ ] Conversational AI escalates with full context within 10 seconds
- [ ] Credit fairness gate blocks decisions when disparate impact < 0.80
- [ ] Document extraction rejects corrupt files within 10 seconds
- [ ] ICT risk register covers all critical services
- [ ] No single-vendor SPOF across cloud, LLM, vector DB, streaming
- [ ] Exit strategies documented and executable within 90 days
- [ ] Recovery runbooks tested semi-annually
