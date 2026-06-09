# Part 8 — Security, Compliance & Responsible AI

## Security Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SECURITY LAYERS                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─── PERIMETER ──────────────────────────────────────────────────────────┐│
│  │ WAF │ DDoS Protection │ Geo-blocking │ Bot Detection │ Rate Limiting  ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─── IDENTITY & ACCESS ─────────────────────────────────────────────────┐ │
│  │ OIDC/SAML Federation │ FAPI 2.0 │ PSD2 SCA │ RBAC+ABAC │ JIT Elevate│ │
│  │ SPIFFE/SPIRE Workload Identity │ Session Mgmt (15min/4hr) │ SoD      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─── NETWORK ───────────────────────────────────────────────────────────┐ │
│  │ Zero-Trust │ mTLS (Istio) │ Network Policies │ Private Connectivity   │ │
│  │ Explicit Egress Allow-Lists │ No Public Model API Access              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─── DATA PROTECTION ───────────────────────────────────────────────────┐ │
│  │ PII Tokenisation at Ingest │ Encryption (AES-256-GCM at rest, TLS    │ │
│  │ 1.3 in transit) │ BYOK/HYOK for Regulated Tenants │ Data Residency   │ │
│  │ Regional Isolation │ PII Redaction in Prompts/Completions             │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─── AI SECURITY ──────────────────────────────────────────────────────┐  │
│  │ Prompt Injection Detection │ Jailbreak Detection │ Output Filtering   │  │
│  │ RAG Corpus Scanning │ Model Provenance │ Signed Artefacts │ Eval Gates│  │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─── SUPPLY CHAIN ─────────────────────────────────────────────────────┐  │
│  │ Signed Images (cosign) │ SBOMs │ Dependency Scanning │ Admission Ctrl│  │
│  │ Model Checksums │ Container Vulnerability Scanning │ Kyverno Policies │  │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─── SECRETS MANAGEMENT ────────────────────────────────────────────────┐ │
│  │ HashiCorp Vault │ Short-Lived Credentials (24h max) │ Zero Secrets in │ │
│  │ Prompts/Repos/Env Vars │ CSI Secret Store Driver │ Auto-Rotation     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Residency Enforcement

| Jurisdiction | Regulation | Data Types | Storage | Processing | Cross-Border |
|---|---|---|---|---|---|
| India | RBI, DPDP Act | All Indian customer data | India only | India only | Anonymised + DPO |
| UAE | DFSA, UAE PDPL | UAE customer data | UAE only | UAE only | Anonymised + DPO |
| UK | FCA, GDPR | UK customer data | UK only | UK only | Anonymised + DPO |
| Singapore | MAS | SG customer data | SG only | SG only | Anonymised + DPO |
| US | OCC/FRB | US corporate data | US only | US only | As per agreement |

**Control-Plane Exception**: Metadata (model configs, prompt templates, cost metrics) may be centralised globally as it contains no customer data.

## PII Protection Lifecycle

```
Source System → [Tokenise at Ingest] → Platform Storage (tokenised)
     │
     ├── AI Service needs PII → [De-tokenise in-memory only]
     │                              → [Process]
     │                              → [Re-tokenise or redact in output]
     │
     ├── LLM Prompt → [PII Redacted by Guardrails] → Model (no PII)
     │                                               → Response (scanned)
     │
     └── Audit Artefact → [Tokenised PII stored] → 7-year retention
```

## Encryption

| Layer | Algorithm | Key Management |
|-------|-----------|---------------|
| At rest (data) | AES-256-GCM | BYOK via Vault transit |
| At rest (backups) | AES-256-GCM | HYOK for regulated tenants |
| In transit (external) | TLS 1.3 | Auto-rotated certificates |
| In transit (internal) | mTLS via Istio | SPIFFE SVIDs (short-lived) |
| Audit integrity | SHA-256 | Immutable hash chain |

## Access Control Model

```
RBAC (Role-Based):
  - fraud-analyst: read fraud scores, view explanations
  - aml-analyst: read/write AML cases, approve SARs
  - credit-officer: read/write credit decisions
  - model-deployer: deploy models (cannot approve)
  - model-approver: approve models (cannot deploy)
  - audit-reviewer: read audit artefacts, reverse PII redaction
  - platform-admin: infrastructure management (no data access)

ABAC (Attribute-Based):
  - jurisdiction: user can only access data in their jurisdiction
  - data-classification: user clearance must meet data sensitivity
  - time-of-day: elevated access only during business hours
  - device-trust: only from managed devices for privileged operations

JIT Elevation:
  - Maximum 4-hour session
  - Requires justification + manager approval
  - Logged and auditable
```

## PCI-DSS Scope Minimisation

```
Card Data Entry → [Tokenise at POS/Gateway] → Token stored in Platform
                                              (no PAN/CVV in platform)
                                              
PCI Scope = Entry Point + Token Vault only
Platform Services = OUT OF SCOPE (tokens only)
```

## DORA Compliance (UK/EU)

| Requirement | Implementation |
|-------------|---------------|
| ICT Risk Register | All critical AI services catalogued with impact, RTO/RPO |
| Third-party concentration | No single vendor SPOF; documented exit per vendor |
| Exit testing | Annual drill: migrate critical workload within 90 days |
| Incident management | P1 detection < 60s, escalation < 5 min |
| Resilience testing | Monthly chaos tests, quarterly region-failure tests |

## AI Governance Controls

| Control | Mechanism | Frequency |
|---------|-----------|-----------|
| Model inventory | Model Registry (all models registered) | Continuous |
| Validation independence | Org separation enforced in IAM | Per deployment |
| Champion/Challenger | Shadow scoring + monthly comparison | Monthly |
| Drift monitoring | PSI + accuracy + fairness metrics | Continuous |
| Bias reporting | Disparate impact per cohort | Monthly |
| Explainability | SHAP values + adverse-action reasons | Per decision |
| Audit trail | Full decision artefact, 7-year retention | Per decision |
| Red-teaming | Adversarial testing of GenAI services | Quarterly |
| Right-to-explanation | Historical model + inputs → explanation within 30 days | On request |
