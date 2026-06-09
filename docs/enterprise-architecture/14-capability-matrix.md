# Part 10 — Platform Capability Matrix

For every capability area: (a) primary open-source/portable choice with version; (b) managed-service alternatives; (c) portability interface; (d) operational owner.

| Capability Area | Primary Choice (Version) | Managed Alternative 1 | Managed Alternative 2 | Portability Interface | Operational Owner |
|---|---|---|---|---|---|
| **GenAI / Foundation Models** | vLLM 0.4+ serving Llama 3.1 70B (INT8) + Mistral 7B (INT4) | AWS Bedrock (Claude/Llama) | Azure OpenAI (GPT-4) | OpenAI-compatible API (chat/completions) | AI Platform Team |
| **Agentic / Orchestration** | Custom TypeScript orchestrator + MCP | LangChain (if needed) | Semantic Kernel | Tool-use JSON schema + structured output | AI Platform Team |
| **Search & Retrieval** | pgvector 0.7+ on PostgreSQL 16 + BM25 | AWS OpenSearch (kNN) | Azure AI Search | SQL interface + hybrid search API | Data Platform Team |
| **Reranking** | BGE-reranker-v2-m3 (self-hosted) | Cohere Rerank | — | HTTP REST (score endpoint) | AI Platform Team |
| **Compute — Stateless** | Kubernetes 1.29+ (CNCF conformant) | AWS EKS | Azure AKS / GCP GKE | Kubernetes API + OCI images | Platform Engineering |
| **Compute — AI Inference** | vLLM + Triton Inference Server on GPU nodes (A10G/A100) | AWS SageMaker Endpoints | Azure ML Managed Endpoints | OpenAI-compatible API + ONNX Runtime | AI Platform Team |
| **Storage — Object** | MinIO (S3-compatible, self-hosted) | AWS S3 | Azure Blob (S3 compat mode) | S3 API | Platform Engineering |
| **Storage — Transactional** | PostgreSQL 16 (streaming replication) | AWS RDS PostgreSQL | Azure Database for PostgreSQL | libpq / SQL protocol | Data Platform Team |
| **Storage — Lakehouse** | Apache Iceberg 1.5+ on Parquet | AWS Glue Iceberg | Azure Synapse (Iceberg) | Iceberg REST Catalog API | Data Platform Team |
| **Storage — Vector** | pgvector 0.7+ (primary) / Milvus 2.3+ (scale-out) | AWS OpenSearch (kNN) | Azure AI Search | SQL (pgvector) / gRPC (Milvus) | AI Platform Team |
| **Streaming & Events** | Apache Kafka 3.7 (KRaft mode) + Confluent Schema Registry | AWS MSK | Azure Event Hubs (Kafka surface) | Kafka Protocol + Schema Registry REST | Platform Engineering |
| **CDC** | Debezium 2.5+ | AWS DMS | — | Kafka Connect API | Integration Team |
| **Feature Store** | Feast 0.38+ (online: Redis, offline: Iceberg) | AWS SageMaker Feature Store | Vertex AI Feature Store | Feast SDK + gRPC serving API | ML Platform Team |
| **ML Platform / Registry** | MLflow 2.12+ + custom Model Registry | AWS SageMaker Model Registry | Azure ML Model Registry | MLflow REST API + model URI scheme | ML Platform Team |
| **Security — Secrets** | HashiCorp Vault 1.16+ | AWS Secrets Manager | Azure Key Vault | Vault HTTP API + CSI driver | Security Engineering |
| **Security — Mesh** | Istio 1.21+ (mTLS, traffic policy) | AWS App Mesh | Linkerd (alternative) | Envoy xDS API + SPIFFE | Platform Engineering |
| **Security — Identity** | Keycloak 24+ (OIDC/SAML) | AWS Cognito | Azure AD B2C | OIDC / SAML 2.0 / FAPI 2.0 | Identity Team |
| **Security — Workload ID** | SPIFFE/SPIRE | AWS IAM Roles for Service Accounts | Azure Workload Identity | SPIFFE SVID (X.509) | Security Engineering |
| **Security — Container** | cosign (image signing) + Kyverno (admission) | — | — | OCI signatures + CEL policies | DevSecOps |
| **AI Governance & Lineage** | OpenMetadata 1.3+ + custom governance layer | AWS DataZone | Purview (Azure) | OpenMetadata REST API | Data Governance Team |
| **Monitoring — Traces** | OpenTelemetry Collector + Jaeger/Tempo | AWS X-Ray | Azure Monitor (OTel) | OTLP Protocol | SRE Team |
| **Monitoring — Metrics** | Prometheus 2.51+ + Grafana 10+ | AWS CloudWatch | Azure Monitor | PromQL + Prometheus Remote Write | SRE Team |
| **Monitoring — Logs** | Loki 3.0+ (or OpenSearch) | AWS CloudWatch Logs | Azure Monitor Logs | LogQL / OpenSearch API | SRE Team |
| **Monitoring — LLM** | Langfuse 2.0+ (self-hosted) | Arize AI | WhyLabs | REST API (traces + evals) | AI Platform Team |
| **API Management** | Kong Gateway 3.6+ | AWS API Gateway | Azure APIM | OpenAPI 3.1 + Gateway API | Platform Engineering |
| **Container Platform** | OCI Registry (Harbor 2.10+) | AWS ECR | Azure ACR | OCI Distribution Spec | DevSecOps |
| **CI/CD** | ArgoCD 2.10+ (GitOps) + GitHub Actions | AWS CodePipeline | Azure DevOps | Git + Kubernetes API + OCI | DevSecOps |
| **Edge / CDN** | Cloudflare (or equivalent) | AWS CloudFront | Azure CDN | HTTP/2 + edge compute | Platform Engineering |
| **Service Mesh Control** | Istio 1.21+ | — | Linkerd 2.14+ | Envoy xDS + Gateway API | Platform Engineering |

## Notes

- Every primary choice is open-source and self-hostable on any Kubernetes cluster
- Managed alternatives exist for each tier across at least two hyperscalers
- The portability interface is the contract that insulates application code from infrastructure
- Operational ownership is assigned to specific platform teams (not individual engineers)
- Version numbers reflect minimum supported versions at time of design
