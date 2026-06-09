# Part 3 — Logical Architecture (Cloud-Agnostic)

## High-Level Logical View

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL BOUNDARY                                   │
│  Mobile/Web │ IVR │ Branches │ Open Banking APIs │ Fintech Partners (340)    │
└──────┬───────┴──┬──┴────┬─────┴────────┬──────────┴──────────────────────────┘
       │          │       │              │
┌──────▼──────────▼───────▼──────────────▼─────────────────────────────────────┐
│                        CHANNEL LAYER                                          │
│  API Gateway │ BFF (per channel) │ Rate Limiting │ AuthN (OIDC/FAPI)         │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                     AI ORCHESTRATION LAYER                                    │
│ ┌─────────────┐ ┌─────────────┐ ┌───────────────┐ ┌─────────────────────┐  │
│ │ LLM Gateway │ │ Guardrails  │ │ Prompt        │ │ Tool Federation     │  │
│ │ (routing,   │ │ Engine      │ │ Registry      │ │ (MCP, function      │  │
│ │  caching,   │ │ (injection, │ │ (versioned,   │ │  calling, structured│  │
│ │  quotas)    │ │  PII, tox)  │ │  approved)    │ │  output)            │  │
│ └─────────────┘ └─────────────┘ └───────────────┘ └─────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────────────────────┐  │
│ │ RAG Pipeline: Chunking │ Embedding │ Vector Index │ Reranker │ Scoring  │  │
│ └─────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                       AI/ML SERVICES LAYER                                    │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│ │ Fraud    │ │ AML      │ │ Credit   │ │ Conv.    │ │ Doc      │          │
│ │ Inference│ │ Triage   │ │ Under-   │ │ AI       │ │ Intel.   │          │
│ │ Service  │ │ Service  │ │ writing  │ │ Service  │ │ Service  │          │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│ │ Sanctions│ │ RM       │ │ Branch   │ │ NBA      │ │Complaints│          │
│ │ Screening│ │ Copilot  │ │ Copilot  │ │ Engine   │ │ Intel.   │          │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                         DATA LAYER                                            │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│ │ Feature     │ │ Customer    │ │ Vector      │ │ Lakehouse (Iceberg)     ││
│ │ Store       │ │ 360         │ │ Store       │ │ Analytics + Audit       ││
│ │ (online +   │ │ (unified    │ │ (tenant-    │ │                         ││
│ │  offline)   │ │  profile)   │ │  isolated)  │ │                         ││
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────────┘│
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                    STREAMING BACKBONE                                          │
│  Kafka (KRaft) │ Schema Registry │ CDC (Debezium) │ DLQ │ Topic Taxonomy    │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                    INTEGRATION LAYER                                           │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────────┐ │
│ │ Mainframe       │ │ Core Banking    │ │ Satellite Systems               │ │
│ │ Facade (z/OS)   │ │ Adapters        │ │ Connectors (14 systems)         │ │
│ │                 │ │ (Finacle, T24)  │ │                                 │ │
│ └─────────────────┘ └─────────────────┘ └─────────────────────────────────┘ │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                    GOVERNANCE & OBSERVABILITY                                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│ │ Model    │ │ Audit    │ │ Human    │ │ FinOps   │ │ Identity │          │
│ │ Registry │ │ Service  │ │ Review   │ │ Service  │ │ Service  │          │
│ │          │ │ (7-year) │ │ Queue    │ │          │ │ (IAM)    │          │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│ ┌─────────────────────────────────────────────────────────────────────────┐  │
│ │ OpenTelemetry │ Prometheus │ Grafana │ Alerting │ LLM Observability     │  │
│ └─────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Patterns

### Synchronous (Request-Response)
- Customer payment → API Gateway → Fraud Inference → Feature Store → Response
- RM query → RM Copilot → RAG Pipeline → LLM Gateway → Response
- Credit application → Credit Underwriting → Feature Store → Decision

### Asynchronous (Event-Driven)
- Transaction event → Kafka → AML Transaction Monitoring → Alert
- Customer profile update → Kafka → Customer 360 → Feature Store refresh
- Model drift signal → Kafka → Governance Framework → Alert to MRO

### Batch
- Mainframe CDC (off-peak) → Kafka → Customer 360 refresh
- Embedding refresh → RAG Pipeline → Vector Store update
- Monthly fairness reports → Governance Framework → Board reporting

## Event Flow — Topic Taxonomy

```
afg.payments.{region}.transactions       # Real-time payment events
afg.payments.{region}.settlements        # Settlement confirmations
afg.fraud.{region}.scores                # Fraud score results
afg.fraud.{region}.decisions             # Approve/Hold/Decline outcomes
afg.aml.{region}.alerts                  # AML alert generation
afg.aml.{region}.dispositions            # Alert triage outcomes
afg.credit.{region}.applications         # New credit applications
afg.credit.{region}.decisions            # Credit decisions
afg.customer.{region}.events             # Profile changes, life events
afg.customer.{region}.profiles           # Unified profile updates
afg.audit.{region}.artefacts             # AI decision audit records
afg.governance.models.drift              # Model drift signals
afg.governance.models.comparison         # Champion/challenger reports
afg.finops.costs                         # Cost event telemetry
afg.dlq.{service-name}                   # Dead-letter queues
```

## Regional Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                     GLOBAL CONTROL PLANE                          │
│  Model Registry │ Prompt Registry │ FinOps │ Governance Config   │
│  (metadata only — no customer data crosses borders)              │
└───────┬──────────────┬──────────────┬───────────────┬───────────┘
        │              │              │               │
┌───────▼──────┐ ┌────▼─────┐ ┌─────▼────┐ ┌───────▼──────┐
│ INDIA REGION │ │ SG REGION│ │ UAE REGION│ │ UK REGION    │
│              │ │          │ │          │ │              │
│ Data Plane   │ │ Data     │ │ Data     │ │ Data Plane   │
│ AI Inference │ │ Plane    │ │ Plane    │ │ AI Inference │
│ Feature Store│ │ AI Infr. │ │ AI Infr. │ │ Feature Store│
│ Audit Store  │ │ Audit    │ │ Audit    │ │ Audit Store  │
│ Vector Store │ │ Vector   │ │ Vector   │ │ Vector Store │
│              │ │          │ │          │ │              │
│ Kafka Cluster│ │ Kafka    │ │ Kafka    │ │ Kafka Cluster│
│ Customer Data│ │ Cust.    │ │ Cust.    │ │ Customer Data│
└──────────────┘ └──────────┘ └──────────┘ └──────────────┘
```

## Component Substitutability

| Logical Block | Primary Choice | Cloud Alternative 1 | Cloud Alternative 2 | Portability Interface |
|---|---|---|---|---|
| Streaming | Kafka (KRaft) | AWS MSK | Azure Event Hubs (Kafka) | Kafka Protocol |
| Object Storage | MinIO (self-hosted) | AWS S3 | Azure Blob | S3 API |
| Compute | Kubernetes | EKS | AKS/GKE | OCI + K8s API |
| Vector DB | pgvector | OpenSearch (kNN) | Milvus | SQL/gRPC |
| Secrets | HashiCorp Vault | AWS Secrets Manager | Azure Key Vault | Vault API |
| Observability | OpenTelemetry + Prometheus | CloudWatch | Azure Monitor | OTLP Protocol |
| Identity | Keycloak | AWS Cognito | Azure AD | OIDC/SAML |
| Model Serving | vLLM / Triton | SageMaker | Azure ML | OpenAI-compatible API |

## Human-in-the-Loop Feedback Loops

```
AI Decision (low confidence)
    → Human Review Queue
        → Analyst reviews decision
            → Approve / Reject / Modify
                → Decision executed
                → Feedback captured (PII-stripped)
                    → Model improvement pipeline
                        → Retraining dataset
                            → Next model version
                                → Challenger deployment
                                    → Shadow scoring (3 months)
                                        → Promotion (if outperforms)
```

## Monitoring, Observability, and Audit

```
Every Service
    ├── OpenTelemetry Traces (distributed, cross-service)
    ├── Prometheus Metrics (latency, throughput, errors, AI-specific)
    ├── Structured Logs (correlation IDs, jurisdiction tags)
    └── Audit Artefacts (for customer-impacting decisions)
        → Immutable Store (Iceberg, 7-year retention)
        → Integrity Verification (SHA-256)
        → Jurisdiction-scoped partitioning
```
