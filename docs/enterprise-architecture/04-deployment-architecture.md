# Part 4 — Cloud-Agnostic Deployment Architecture

## Deployment Overview

The platform deploys across regional Kubernetes clusters with GPU node pools for AI inference. Every component uses portable, open-standards-based building blocks. Managed services are permitted only where an explicit abstraction layer preserves portability.

## Network Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        INTERNET / PUBLIC                                  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────┐
│                     EDGE / CDN LAYER                                      │
│  Global Anycast LB │ Geo-DNS │ WAF │ DDoS Protection │ Edge Compute     │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ (TLS termination)
┌────────────────────────────────▼────────────────────────────────────────┐
│                     DMZ / API GATEWAY                                     │
│  Kong/Envoy Gateway │ Rate Limiting │ AuthN │ Request Routing │ BFF     │
│  FAPI 2.0 endpoints │ Open Banking APIs │ Partner mTLS                  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ (mTLS via Service Mesh)
┌────────────────────────────────▼────────────────────────────────────────┐
│                     SERVICE MESH (Istio)                                   │
│  mTLS (SPIFFE/SPIRE) │ Traffic Policy │ Retries │ Circuit Breaking       │
│  Canary Deployments │ Identity-Based AuthZ │ Observability Tap           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────┐
│                     KUBERNETES CLUSTER (per region)                        │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ NAMESPACE: ai-services                                               │ │
│  │  fraud-inference │ aml-triage │ credit-underwriting │ conv-ai       │ │
│  │  rm-copilot │ branch-copilot │ doc-intelligence │ complaints        │ │
│  │  nba-engine │ sanctions-screening                                    │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ NAMESPACE: platform-services                                         │ │
│  │  llm-gateway │ guardrails │ rag-pipeline │ feature-store            │ │
│  │  audit-service │ human-review │ model-registry │ finops             │ │
│  │  identity-service │ streaming-backbone                               │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ NAMESPACE: gpu-inference                                             │ │
│  │  vLLM pods (7B-70B models) │ Triton pods (classical ML)             │ │
│  │  Embedding service │ Reranker service                                │ │
│  │  Auto-scaler (queue depth + GPU util + token throughput)             │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ NAMESPACE: data-services                                             │ │
│  │  PostgreSQL (transactional) │ Redis (feature cache)                  │ │
│  │  pgvector (embeddings) │ MinIO (object storage)                      │ │
│  │  Kafka (KRaft mode) │ Schema Registry                                │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ NAMESPACE: observability                                             │ │
│  │  OTel Collector │ Prometheus │ Grafana │ Alertmanager │ Loki        │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Zero-Trust Security Overlay

| Layer | Implementation | Protocol |
|-------|---------------|----------|
| Workload Identity | SPIFFE/SPIRE | X.509 SVIDs |
| Service-to-Service | Istio mTLS | TLS 1.3 |
| External APIs | Kong + FAPI 2.0 | OAuth 2.0 + PKCE |
| Customer Auth | Keycloak + SCA | OIDC + WebAuthn |
| Network Policy | Kubernetes NetworkPolicy + Calico | IP-level isolation |
| Egress Control | Explicit allow-lists per namespace | DNS-based filtering |
| Secrets | Vault + CSI driver | Short-lived creds (24h max) |

## AI Inference Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   GPU NODE POOL                                    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ vLLM Server (Llama 3.1 70B, quantised INT8)                 │ │
│  │  - KV-cache optimisation                                     │ │
│  │  - Continuous batching                                       │ │
│  │  - Speculative decoding                                      │ │
│  │  - Multi-tenant request queue                                │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ vLLM Server (Llama 3.1 8B / Mistral 7B, INT4)              │ │
│  │  - Low-latency inference for simple tasks                    │ │
│  │  - CPU-only fallback available                               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Triton Inference Server (Classical ML)                       │ │
│  │  - XGBoost/LightGBM fraud models                            │ │
│  │  - Credit scoring models                                     │ │
│  │  - <10ms per inference on CPU                                │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Embedding Service                                            │ │
│  │  - Multilingual-e5-large (768 dim)                           │ │
│  │  - Batch embedding for corpus refresh                        │ │
│  │  - Online embedding for query-time                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Data Services

| Service | Technology | Portability Layer | HA Strategy |
|---------|-----------|-------------------|-------------|
| Transactional DB | PostgreSQL 16 | SQL + libpq protocol | Streaming replication |
| Feature Cache | Redis 7 (cluster mode) | RESP protocol | Multi-AZ replication |
| Vector Store | pgvector (on PostgreSQL) | SQL interface | Streaming replication |
| Object Storage | MinIO (S3-compatible) | S3 API | Erasure coding |
| Lakehouse | Apache Iceberg on Parquet | Iceberg REST Catalog | Multi-copy across AZs |
| Event Streaming | Kafka 3.7 (KRaft) | Kafka Protocol | 3-node quorum, ISR=2 |
| Schema Registry | Confluent Schema Registry | REST API | Active-Passive |

## CI/CD and GitOps

```
Developer Push
  → GitHub Actions / GitLab CI
    → Build + Test (Vitest + fast-check)
    → SBOM Generation (syft)
    → Image Build (OCI)
    → Image Sign (cosign)
    → Vulnerability Scan (Trivy)
    → Push to Registry
  → ArgoCD (GitOps)
    → Kubernetes Deployment
    → Admission Control (Kyverno)
      → Reject unsigned images
      → Reject missing SBOMs
      → Enforce resource limits
    → Canary Rollout (Istio traffic splitting)
    → Health Check → Promote or Rollback
```

## Disaster Recovery

| Region | Primary | Secondary | Strategy | Failover Trigger |
|--------|---------|-----------|----------|------------------|
| India | Mumbai (AZ-1,2,3) | Hyderabad | Active-Active (stateless), Active-Passive (stateful) | Automated at AZ level, manual at region level |
| Singapore | SG-1 | SG-2 (same region) | Multi-AZ Active-Active | Automated |
| UAE | Dubai | — | Single-region Multi-AZ | N/A (limited by geography) |
| UK | London | Ireland (for DR only) | Active-Passive | Manual with CRO approval |

## Managed Service Abstraction Registry

For every managed service adopted, the abstraction layer is:

| Managed Service | Abstraction | Open Alternative | Swap Effort |
|---|---|---|---|
| Cloud GPU (A100) | vLLM server API | Same on any cloud GPU | Days (re-deploy pods) |
| Cloud LB | Kubernetes Ingress | MetalLB + HAProxy | Hours |
| Cloud DNS | External-DNS controller | Self-hosted CoreDNS | Hours |
| Cloud KMS | Vault transit engine | Vault on any infra | Days |
| Cloud Monitoring | OTel Collector (OTLP) | Self-hosted Prom/Grafana | Days |
