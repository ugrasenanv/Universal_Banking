# Part 2 — Business Architecture

## Business Domain & Capability Map (BIAN-Aligned)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AFG BUSINESS CAPABILITY MAP                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─── CUSTOMER ENGAGEMENT ────┐  ┌─── PRODUCTS & SERVICES ──────────────┐  │
│  │ Digital Channels (App/Web) │  │ Retail Banking (Deposits/Lending)    │  │
│  │ Contact Centre             │  │ Cards & Payments (UPI/IMPS/RTGS)     │  │
│  │ Branch Operations          │  │ SME & Corporate Banking              │  │
│  │ Open Banking APIs          │  │ Wealth & Private Banking             │  │
│  │ RM Workstation             │  │ Trade Finance (LC/BG/SCF)            │  │
│  └────────────────────────────┘  └──────────────────────────────────────┘  │
│                                                                             │
│  ┌─── RISK & COMPLIANCE ─────┐  ┌─── OPERATIONS & SUPPORT ─────────────┐  │
│  │ Fraud Detection            │  │ Customer Onboarding (KYC/KYB)       │  │
│  │ AML/CFT                    │  │ Document Processing                  │  │
│  │ Sanctions Screening        │  │ Complaints Management                │  │
│  │ Credit Risk Management     │  │ Collections & Recovery               │  │
│  │ Model Risk Management      │  │ Reconciliation                       │  │
│  │ Regulatory Reporting       │  │ Treasury Operations (data only)      │  │
│  └────────────────────────────┘  └──────────────────────────────────────┘  │
│                                                                             │
│  ┌─── AI/ML PLATFORM ────────┐  ┌─── TECHNOLOGY PLATFORM ──────────────┐  │
│  │ LLM Gateway & Governance  │  │ Core Banking (Finacle/T24/z/OS)      │  │
│  │ RAG Pipeline              │  │ Event Streaming (Kafka)               │  │
│  │ Feature Store             │  │ Identity & Access Management          │  │
│  │ Model Registry & MLOps    │  │ Observability & Monitoring            │  │
│  │ AI Safety & Guardrails    │  │ API Management                        │  │
│  │ Human Review Workflow     │  │ Data Lakehouse                        │  │
│  └────────────────────────────┘  └──────────────────────────────────────┘  │
│                                                                             │
│  ┌─── GOVERNANCE & CONTROL ──┐  ┌─── COST & ANALYTICS ─────────────────┐  │
│  │ AI Governance Framework   │  │ FinOps & Unit Economics              │  │
│  │ Audit & Retention (7yr)   │  │ Business Intelligence                │  │
│  │ Data Residency Control    │  │ Customer 360 Analytics               │  │
│  │ Regulatory Compliance     │  │ Personalisation & NBA                 │  │
│  └────────────────────────────┘  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## User Personas

| Persona | Description | Key AI Touchpoints |
|---------|-------------|--------------------|
| **Retail Customer** | 41M active, mobile-first, multilingual | Conversational AI (11 langs), NBA recommendations, fraud notifications |
| **SME Customer** | 1.2M businesses, working capital focus | Credit underwriting, trade-finance doc extraction, Branch Copilot |
| **Wealth RM** | ~2,000 RMs serving 180K HNW/UHNW | RM Copilot, client brief synthesis, product recommendations |
| **Contact Centre Agent** | 18,000 agents across 9 sites | AI-assisted conversation, AML/fraud co-pilot, context transfer |
| **AML Analyst (L1/L2)** | ~500 analysts processing 41K alerts/day | AI triage, narrative generation, SAR draft, HITL approval |
| **Branch Operations** | 4,200 branches, policy questions | Branch Copilot (policies, circulars, product info) |
| **Model Risk Officer** | Central MRM team | Model inventory, drift alerts, challenger reports, bias metrics |
| **CISO** | Security governance | Zero-trust enforcement, PII protection, prompt injection monitoring |
| **Regulator** | RBI, MAS, DFSA, FCA, OCC | Audit trail retrieval, explainability, compliance reports |

## AI Touchpoints on Customer Journey

```
┌─────────────────────────────────────────────────────────────────────┐
│                     RETAIL CUSTOMER JOURNEY                          │
├──────────┬──────────┬──────────┬──────────┬──────────┬─────────────┤
│ DISCOVER │ ONBOARD  │ TRANSACT │ SERVICE  │ BORROW   │ COMPLAIN    │
├──────────┼──────────┼──────────┼──────────┼──────────┼─────────────┤
│ NBA      │ Doc      │ Fraud    │ Conv.    │ Credit   │ Complaints  │
│ Engine   │ Intel.   │ Scoring  │ AI       │ Under-   │ Intel.      │
│          │          │          │          │ writing  │             │
│ Person-  │ Sanctions│ Payment  │ RM       │ Credit   │ Routing     │
│ alised   │ Screen   │ Auth     │ Copilot  │ Line     │             │
│ Offers   │          │          │          │ Mgmt     │ Resolution  │
└──────────┴──────────┴──────────┴──────────┴──────────┴─────────────┘
     UC-11     UC-09     UC-01      UC-07      UC-05       UC-10
               UC-04     UC-02      UC-08      UC-06
                                    UC-12
```

## Governance, Risk, and Audit Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ BOARD / TECHNOLOGY COMMITTEE                                        │
├─────────────────────────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│ │ AI           │ │ Model Risk   │ │ Data         │ │ Information│ │
│ │ Governance   │ │ Committee    │ │ Protection   │ │ Security   │ │
│ │ Council      │ │ (SR 11-7)    │ │ Office       │ │ (CISO)     │ │
│ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └─────┬──────┘ │
│        │                │                │               │         │
│ ┌──────▼────────────────▼────────────────▼───────────────▼──────┐  │
│ │                    GOVERNANCE FRAMEWORK                        │  │
│ │  Model Registry │ Drift Monitor │ Fairness │ Audit │ Residency│  │
│ └───────────────────────────────────────────────────────────────┘  │
│        │                                                           │
│ ┌──────▼───────────────────────────────────────────────────────┐   │
│ │                    AUDIT & RETENTION (7 YEARS)                │   │
│ │  Every AI decision → Audit Artefact → Immutable Store        │   │
│ │  Right-to-Explanation → Reconstructable within 30 days       │   │
│ └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Operational Boundaries

| Boundary | Entities | Regulatory Authority |
|----------|----------|---------------------|
| India | Retail, Cards, SME, Contact Centre, z/OS | RBI, DPDP Act |
| Singapore | Wealth (booking), Aurora Neobank | MAS |
| UAE (DIFC) | Wealth (advisory), Private Banking | DFSA, UAE PDPL |
| UK | Wealth, Corporate | FCA/PRA, GDPR, DORA |
| US | Corporate (limited) | OCC/FRB |

Each jurisdiction operates an independent data plane with no cross-border customer data movement unless anonymised with DPO approval.
