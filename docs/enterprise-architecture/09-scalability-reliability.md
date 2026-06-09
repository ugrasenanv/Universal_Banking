# Part 9 — Scalability, Reliability & FinOps

## 9A. Scalability

### Peak Traffic: Salary Day

- **Spike**: 4.5x normal to 82,000 TPS sustained for ~90 minutes
- **Normal**: ~18,000 TPS
- **Trigger**: Last working day of each month

### Capacity Calculation (T5 — Fraud Service)

**Given**:
- Peak TPS: 82,000
- Latency target: <100ms p99
- Model inference: ~5ms per request on GPU (XGBoost on Triton)
- Feature Store read: ~8ms p99
- Network/serialisation overhead: ~10ms

**Model Serving Pod Count**:
- Triton batch size: 64 requests
- GPU throughput: 64 / 5ms = 12,800 inferences/second per GPU
- Required GPUs: 82,000 / 12,800 = 6.4 → **8 GPUs** (with headroom)
- Pod configuration: 4 pods × 2 GPUs each (NVIDIA A10G sufficient for XGBoost)

**Feature Store Throughput**:
- 82,000 reads/sec, ~5 features per read = 410,000 key lookups/sec
- Redis cluster: 6 nodes × 100K ops/sec per node = 600K ops/sec capacity
- Headroom: 46% buffer

**Kafka Partition Count**:
- Target: 82,000 events/sec on `afg.payments.in.transactions`
- Throughput per partition: ~10,000 messages/sec (conservative)
- Partitions needed: 82,000 / 10,000 = 8.2 → **12 partitions** (headroom)
- Consumer group: 12 consumers (1:1 with partitions)

**Auto-scaling Strategy**:
- Pre-warm: Scale to peak capacity 30 minutes before predicted salary day
- Trigger: Queue depth > 100 OR GPU utilisation > 75% OR TPS > 60,000
- Scale factor: 2x per scaling event
- Cooldown: 15 minutes before scale-down
- Minimum replicas: 2 (always-on for HA)

### IPL/Cricket Spikes

- Entertainment-linked card spend spikes: 2-3x normal card TPS
- Predictable: match schedules known weeks in advance
- Strategy: Pre-warm card fraud inference pods 1 hour before match start

### Global Traffic Distribution

- Latency-aware routing via geo-DNS
- Requests route to nearest region with capacity
- If primary region saturated → spill to secondary region
- Cross-region routing adds ~40ms (acceptable for non-real-time services)

---

## 9B. Reliability

### HA Strategy Per Data Class

| Component | Strategy | Failover Time | Notes |
|-----------|----------|---------------|-------|
| Stateless APIs | Active-Active (multi-AZ) | Instant (DNS/LB) | All regions simultaneously |
| PostgreSQL (transactional) | Streaming replication (sync) | <5 min (RPO <1 min) | Automatic failover |
| Redis (Feature Store) | Multi-AZ cluster | Instant | Replicated across AZs |
| Kafka | 3-node quorum, ISR=2 | Automatic | Partition leader election |
| Vector Store | Streaming replication | <8 hours rebuild | Acceptable for search |
| Audit Store (Iceberg) | Multi-copy, immutable | <1 hour | Never loses committed data |
| Model artefacts | Object storage (replicated) | <4 hours | Archive retrieval |

### Graceful Degradation Hierarchy

```
Tier 1: Primary ML/GenAI Model (full capability)
    ↓ failure detected (5 seconds)
Tier 2: Smaller/Distilled Model (reduced quality, faster)
    ↓ failure detected
Tier 3: Rules-Based Engine (deterministic, no ML)
    ↓ failure detected
Tier 4: Human Handoff (queue to agent/analyst)
    ↓ capacity exceeded
Tier 5: Safe-Default Response (conservative action)
```

**Per Use Case Defaults**:
| Use Case | Safe Default |
|----------|-------------|
| Fraud | Decline (protect customer) |
| AML | Escalate to L2 (err on compliance side) |
| Credit | Refer to human underwriter |
| Conversational AI | "Please hold, connecting you to an agent" |
| Document extraction | Route to manual processing |
| NBA | Show generic offers (no personalisation) |

### RPO/RTO Matrix

| Data Class | RPO | RTO | Strategy |
|---|---|---|---|
| Transactional | <1 minute | <5 minutes | Synchronous replication |
| Audit artefacts | <15 minutes | <1 hour | Async replication + write-ahead |
| Model artefacts | <1 hour | <4 hours | Object storage versioning |
| Vector indices | <4 hours | <8 hours | Rebuild from WAL/source |
| Prompt registry | <1 hour | <2 hours | Git-backed, multi-region |

### Chaos Engineering

- **Monthly**: Kill random pods, inject network latency, simulate AZ failure
- **Quarterly**: Full AZ outage simulation, evaluate degradation cascade
- **Annually**: Region failover drill, vendor exit test (DORA)
- **Tool**: Chaos Mesh or Litmus (Kubernetes-native)

---

## 9C. FinOps

### Major Cost Drivers (Ranked)

| # | Cost Driver | % of Total (Estimated) | Optimisation Lever |
|---|------------|----------------------|-------------------|
| 1 | GPU compute (inference) | 35-45% | Quantisation, batching, model routing |
| 2 | LLM tokens (managed APIs) | 15-25% | Semantic caching, prompt compression |
| 3 | Vector storage + queries | 8-12% | Index compaction, lifecycle policies |
| 4 | Network egress | 5-10% | Regional processing, compression |
| 5 | Observability (traces/metrics/logs) | 5-8% | Sampling, aggregation, retention policies |
| 6 | Evaluation (eval harness) | 3-5% | Sampling, offline eval |
| 7 | Embedding refresh | 2-4% | Incremental re-embedding only |

### Token Optimisation

- **Prompt compression**: Remove redundant instructions, use reference IDs
- **Context pruning**: Send only top-k relevant chunks (not all retrieved)
- **Summarisation caches**: Cache summaries of frequently-accessed documents
- **Structured output**: JSON mode reduces output verbosity

### Model Routing for Cost

```
Request arrives at LLM Gateway
  → Check semantic cache (cosine > 0.95)
    → HIT: Return cached response (cost: ~$0)
    → MISS: Route to cheapest adequate model
      → Classify task complexity (metadata-based)
      → LOW: 7B model ($0.0001/request)
      → MEDIUM: 70B model ($0.001/request)
      → HIGH: Frontier API ($0.01/request)
```

### GPU Utilisation Targets

- Target: >80% utilisation during working hours
- Alert: <60% sustained for >1 hour → right-sizing recommendation
- Strategy: Multi-tenant inference (multiple use cases share GPU pools)
- Reserved instances: 70% base capacity reserved, 30% on-demand for peaks

### Showback/Chargeback Model

```
Per Line of Business per month:
  - Retail Banking: ₹X (fraud inference × volume + conversational AI × sessions)
  - Wealth: ₹Y (RM Copilot × queries + NBA × recommendations)
  - Compliance: ₹Z (AML triage × alerts + sanctions × screenings)
  
Per Feature per month:
  - Fraud scoring: ₹0.002 per transaction
  - AML narrative: ₹12 per case
  - RM brief: ₹8 per brief
  - Conversational AI: ₹0.50 per session
```
