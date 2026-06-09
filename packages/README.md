# AFG Enterprise AI/ML Banking Platform — Implementation Documentation

## Overview

This documentation covers the end-to-end implementation of the AFG Enterprise AI/ML Banking Platform for Aurelia Financial Group. The platform is a cloud-agnostic, multi-region intelligent system serving 41M retail customers, 1.2M SME customers, and 180K wealth clients across India, Singapore, Dubai, London, and New York.

## Documentation Structure

| Folder | Description |
|--------|-------------|
| [01-project-setup/](./01-project-setup/) | Monorepo structure, shared types, data classification |
| [02-platform-infrastructure/](./02-platform-infrastructure/) | Identity, Streaming, Feature Store, Audit services |
| [03-guardrails-llm-gateway/](./03-guardrails-llm-gateway/) | Guardrails Engine, LLM Gateway, model routing |
| [04-rag-pipeline/](./04-rag-pipeline/) | Document ingestion, chunking, embedding, retrieval |
| [05-fraud-service/](./05-fraud-service/) | Real-time payment and card fraud detection |
| [06-aml-sanctions/](./06-aml-sanctions/) | AML triage, narrative generation, sanctions screening |
| [07-credit-underwriting/](./07-credit-underwriting/) | Credit scoring, fairness, behavioural credit-lines |
| [08-conversational-ai-copilots/](./08-conversational-ai-copilots/) | Multilingual assistant, RM Copilot, Branch Copilot |
| [09-document-intelligence-complaints/](./09-document-intelligence-complaints/) | KYC/trade-finance extraction, complaints routing |
| [10-nba-finops/](./10-nba-finops/) | Next-Best-Action engine, FinOps cost tracking |
| [11-integration-data-unification/](./11-integration-data-unification/) | Mainframe facade, customer 360 unification |
| [12-human-review-governance/](./12-human-review-governance/) | Human-in-the-loop, Model Registry, governance |
| [13-observability-resilience/](./13-observability-resilience/) | OpenTelemetry, multi-region failover, auto-scaling |
| [14-end-to-end-wiring/](./14-end-to-end-wiring/) | Service integration, critical paths, DORA compliance |

## Technology Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js on Kubernetes
- **Testing**: Vitest + fast-check (property-based testing)
- **Streaming**: Kafka 3.x (KRaft mode)
- **Storage**: PostgreSQL, Apache Iceberg, S3-compatible object store
- **Vector DB**: pgvector / Milvus (cloud-portable)
- **Service Mesh**: Istio (mTLS, SPIFFE/SPIRE)
- **Observability**: OpenTelemetry, Prometheus, Grafana
- **Secrets**: HashiCorp Vault
- **CI/CD**: GitOps with cosign image signing

## Architecture Principles

1. **Cloud-Agnostic**: No hyperscaler-specific primitives in application logic
2. **Data Residency**: Indian data in India, UAE in UAE, etc.
3. **Zero Trust**: mTLS everywhere, explicit egress allow-lists
4. **Graceful Degradation**: 5-tier fallback (primary → smaller model → rules → human → safe-default)
5. **Audit Everything**: 7-year retention for all customer-impacting AI decisions
6. **Fair Lending**: Disparate impact monitoring with automated blocking
7. **Human-in-the-Loop**: Mandatory for SAR filing, credit declines, transaction holds

## Pain Points Addressed

| ID | Domain | Issue |
|----|--------|-------|
| PP-01 | Contact Centre | AHT 7m12s → target 3m30s |
| PP-02 | Customer Experience | NPS -8, no cross-channel context |
| PP-03 | Data Landscape | 14 systems, no customer 360 |
| PP-04 | Fraud | Losses up 41% YoY, 4.8% FP rate |
| PP-05 | AML | 41K alerts/day, 96% FP, 3.5h SAR |
| PP-06 | Sanctions | 96% FP, 2-7 day onboarding delay |
| PP-07 | Credit | 26h retail TAT, 9-day SME TAT |
| PP-08 | Personalisation | Batch campaigns, inconsistent |
| PP-09 | Wealth RM | 40% time on data gathering |
| PP-10 | Compliance | No model inventory, no MRM |
| PP-11 | Cloud Cost | 34% budget overrun |
| PP-12 | Multilingual | Only EN/HI, losing 23% customers |
| PP-13 | Documents | Manual processing, 3.1% error |
| PP-14 | Complaints | 22% misrouting rate |
| PP-15 | Governance | Shadow GenAI, no LLM gateway |
