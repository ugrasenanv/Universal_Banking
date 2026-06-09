# Part 1 — Executive Summary & Assumption Frame

## Business Understanding

Aurelia Financial Group operates as a Tier-1 universal bank serving 41M retail customers, 1.2M SME clients, and 180K wealth relationships across five jurisdictions. The bank's technology estate is fragmented across four core banking platforms (Finacle, T24, z/OS mainframe, Aurora Neobank) and 14 satellite systems, creating data silos that directly impair customer experience, operational efficiency, and risk management.

The platform we design here is not a greenfield rebuild. It is an AI/ML overlay that sits above the existing cores, connected via event streaming and API facades, designed to extract intelligence from fragmented data and inject it into every customer interaction, risk decision, and operational workflow.

## Top 5 Operational Bottlenecks

| # | Pain Point | Business Impact | Root Cause |
|---|-----------|-----------------|------------|
| 1 | **PP-04/PP-05: Fraud & AML** | Fraud losses up 41% YoY; 96% AML FP rate drowning analysts | Rules-based engines cannot adapt; no ML scoring in path |
| 2 | **PP-03: Data Fragmentation** | No customer 360; reconciliation overnight only | 14 systems, 4 cores, no real-time CDC, no identity resolution |
| 3 | **PP-01/PP-02: Contact Centre & CX** | NPS -8; AHT 7m12s; 38% agent attrition | No context across channels; no AI assist; only EN/HI |
| 4 | **PP-07: Credit TAT** | 26h retail, 9-day SME; thin-file exclusion | Manual underwriting; no alternate data; no ML scoring |
| 5 | **PP-15/PP-10: AI Governance Gap** | Shadow GenAI on personal cards; no model inventory | No LLM gateway; no MRM framework; no central control |

## Top 5 AI Opportunity Areas

| # | Opportunity | Value (Order of Magnitude) | Feasibility | Priority |
|---|------------|---------------------------|-------------|----------|
| 1 | Real-time fraud/AML ML | ₹800Cr-1200Cr annual fraud loss reduction + 60% analyst productivity | High (proven patterns) | P0 — MVP |
| 2 | Multilingual conversational AI | ₹400-600Cr annual cost-to-serve reduction (40% of 18K agents) | High (GenAI maturity) | P1 |
| 3 | Credit underwriting acceleration | ₹200-400Cr incremental revenue from faster disbursement + thin-file inclusion | Medium-High | P1 |
| 4 | Wealth RM Copilot + NBA | ₹150-300Cr incremental AUM growth from 20% cross-sell lift | Medium | P2 |
| 5 | Document intelligence | ₹50-100Cr operational savings + faster onboarding | High (OCR+LLM mature) | P2 |

## Material Risks and Unstated Assumptions

### Assumptions (Numbered)

| # | Assumption | Impact if Wrong |
|---|-----------|-----------------|
| A1 | Mainframe MIPS budget allows CDC log reading during off-peak | Mainframe data unavailable to AI services |
| A2 | Existing Kafka investment in Aurora Neobank is Kafka 3.x compatible across all regions | Need parallel streaming infrastructure |
| A3 | RBI will not mandate on-premise-only AI inference before programme completion | Architecture redesign for air-gapped GPU |
| A4 | GPU capacity available in India and UAE regions from at least one cloud provider | Latency impact if inference must traverse regions |
| A5 | PII tokenisation at source system ingest points is achievable without core banking changes | PCI scope cannot be minimised as designed |
| A6 | AFG has budget authority for multi-year GPU reserved instances | FinOps targets unreachable on on-demand pricing |
| A7 | Internal audit accepts challenger-model regime as sufficient for SR 11-7 | May need more conservative dual-production approach |
| A8 | 11-language LLM quality is sufficient from open-weight models for Indian languages | May require fine-tuning or frontier API dependency |

### Material Risks

1. **Regulatory divergence**: RBI DPDP vs GDPR vs UAE PDPL may create irreconcilable data flow requirements
2. **GPU scarcity**: India-region GPU availability may constrain inference capacity during salary-day peaks
3. **Mainframe coupling**: z/OS data freshness depends on MIPS budget negotiation with mainframe team
4. **Model risk at scale**: 12 use cases × challenger requirement = 24+ models to govern simultaneously
5. **Cost runaway**: GenAI token costs scale with adoption; FinOps discipline must be built from day 1

## Cloud-Portability Stance

**Operating Definition**: "Cloud-agnostic" for this programme means:
- All stateful components use open protocols/formats (Kafka protocol, S3 API, OCI, Iceberg, OIDC)
- Application logic contains zero hyperscaler-specific SDK calls
- Managed services are acceptable where an abstraction layer preserves portability

**Deliberate Lock-In Exceptions**:
1. **GPU Inference**: Accept cloud-specific GPU SKUs (A100/H100) because GPU hardware is identical across providers; the portability layer is the model-serving framework (vLLM/Triton)
2. **Regional Object Storage**: Accept cloud-native object storage (S3/GCS/Blob) because S3 API is the de facto standard and all providers implement it

## Headline KPIs (Board Commitment)

| KPI | Baseline | Target | Timeline |
|-----|----------|--------|----------|
| Payment fraud FP rate | 4.8% | <2.5% | Month 6 |
| AML analyst productivity | 100% manual | 60% reduction in L1 workload | Month 9 |
| Contact centre AHT | 7m12s | 3m30s | Month 12 |
| Retail credit TAT | 26 hours | 4 hours | Month 9 |
| Cross-sell conversion | Baseline | +20% | Month 12 |
| Platform availability | ~99.9% | 99.99% | Month 6 |
| Cloud cost vs trajectory | +34% overrun | -25% vs trajectory | Month 12 |

## Transformation Roadmap (Headline)

The programme delivers in four waves over 18 months: Wave 1 (months 1-6) establishes the platform foundation and delivers real-time fraud scoring as the MVP use case in India; Wave 2 (months 4-9) adds AML triage, credit underwriting, and the LLM gateway; Wave 3 (months 7-12) delivers conversational AI, RM Copilot, and document intelligence; Wave 4 (months 10-18) completes global rollout, stabilises FinOps, and matures the governance framework. Each wave is designed to deliver measurable business value independently, de-risking the programme incrementally.
