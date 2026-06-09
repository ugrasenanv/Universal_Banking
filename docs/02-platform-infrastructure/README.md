# Task 2: Platform Infrastructure Services

## Summary

Implements the foundational infrastructure services that all AI/ML services depend on: Identity, Streaming, Feature Store, and Audit.

## Sub-Tasks

### 2.1 — Identity Service

**Requirements**: 17.1, 17.4, 17.5

**Purpose**: Federated identity and access management with zero-trust enforcement.

**Key Capabilities**:
- OIDC/SAML federation against enterprise IdP
- FAPI 2.0 for open-banking API authentication
- PSD2-grade Strong Customer Authentication (SCA)
- RBAC + ABAC policy enforcement
- Segregation of duty (model-deployer ≠ model-approver)

**Implementation Details**:

```typescript
interface IdentityService {
  authenticate(request: AuthRequest): Promise<AuthResult>;
  authorise(principal: Principal, action: Action, resource: Resource): Promise<AuthzResult>;
  elevatePrivilege(principal: Principal, justification: string): Promise<JITElevation>;
  validateSCA(challenge: SCAChallenge): Promise<SCAResult>;
}

interface SessionConfig {
  maxInactivityTimeout: 900;    // 15 minutes (seconds)
  maxSessionDuration: 14400;    // 4 hours (seconds)
  scaRequiredAbove: number;     // Regulatory threshold amount
}

// Segregation of Duty Rules
const SEGREGATION_RULES = [
  { role1: 'model-deployer', role2: 'model-approver', conflict: true },
  { role1: 'model-developer', role2: 'model-validator', conflict: true },
  { role1: 'data-engineer', role2: 'audit-reviewer', conflict: true },
];
```

**SCA Methods**: Biometric (fingerprint/face), OTP (SMS/email), Hardware token

---

### 2.2 — Streaming Backbone

**Requirements**: 24.1, 24.3, 24.4

**Purpose**: Kafka-compatible event streaming with schema governance and dead-letter handling.

**Topic Taxonomy**:
```
afg.payments.transactions
afg.payments.settlements
afg.fraud.scores
afg.fraud.decisions
afg.aml.alerts
afg.aml.dispositions
afg.credit.applications
afg.credit.decisions
afg.customer.events
afg.customer.profiles
afg.audit.artefacts
afg.dlq.{service-name}      # Dead-letter queues per service
```

**Schema Registry Configuration**:
- Backward compatibility: default for most topics
- Full compatibility: audit and regulatory topics
- Forward compatibility: customer events (to support new event types)

**Dead-Letter Queue (DLQ) Behaviour**:
```typescript
interface DLQPolicy {
  maxRetries: 3;
  backoffStrategy: 'exponential';
  initialBackoffMs: 1000;
  maxBackoffMs: 30000;
  dlqTopicSuffix: '.dlq';
  diagnosticFields: ['errorMessage', 'stackTrace', 'originalTopic', 'partition', 'offset'];
}
```

**Property Tests**:
- Property 16: Schema evolution compatibility — validates backward/forward compatibility rules
- Property 17: DLQ routing — verifies messages route to DLQ after max retries

---

### 2.5 — Feature Store

**Requirements**: 20.3

**Purpose**: Online feature serving for ML models at 82,000 reads/sec with <10ms p99.

**Feature Groups**:
| Group | Description | Freshness |
|-------|-------------|-----------|
| `txn_velocity_30d` | Transaction velocity features over 30 days | 5 min |
| `device_fingerprint` | Device and session characteristics | Real-time |
| `merchant_risk_score` | Merchant risk categorisation | 1 hour |
| `bureau_score` | Credit bureau data | 24 hours |
| `alternate_data_signals` | Telecom, utility, UPI patterns | 6 hours |
| `behaviour_90d` | 90-day behavioural aggregates | 1 hour |
| `channel_engagement` | Channel usage patterns | 5 min |
| `product_holdings` | Current product portfolio | 1 hour |
| `aml_risk_indicators` | AML risk signals | 15 min |
| `sanctions_watchlist` | Sanctions list match indicators | Real-time |

**Architecture**:
- Online store: Redis-compatible with cluster mode for horizontal scaling
- Offline store: Apache Iceberg tables for historical features
- Point-in-time joins: Prevent data leakage in training

---

### 2.6 — Audit Service

**Requirements**: 28.1, 28.2, 28.3, 28.4, 18.5

**Purpose**: Immutable, tamper-evident storage for all AI decision artefacts with 7-year retention.

**Implementation**:
```typescript
interface AuditService {
  record(artefact: AuditArtefact): Promise<void>;
  query(filters: AuditQueryFilters): Promise<AuditArtefact[]>;
  reconstruct(decisionId: string): Promise<DecisionReconstruction>;
  verifyIntegrity(artefactId: string): Promise<IntegrityResult>;
}

interface AuditQueryFilters {
  artefactId?: string;
  customerId?: string;
  serviceId?: string;
  dateRange?: { from: ISO8601; to: ISO8601 };
  jurisdiction?: Jurisdiction;
}
```

**Storage Design**:
- Format: Apache Iceberg (open table format, cloud-portable)
- Partitioning: by jurisdiction, then by year-month
- Immutability: append-only writes, no updates/deletes
- Integrity: SHA-256 hash per artefact + Merkle tree per partition
- Retention: automatic expiry computation (creation + 7 years)

**Property Tests**:
- Property 5: Every customer-impacting AI decision produces a complete audit artefact
- Property 6: SHA-256 hash round-trip verification passes for all artefacts

## Acceptance Criteria Verification

- [ ] Identity Service authenticates OIDC, SAML, and FAPI 2.0 flows
- [ ] Segregation of duty blocks conflicting role assignments
- [ ] Schema registry rejects incompatible schema evolutions
- [ ] DLQ receives messages after 3 failed retries
- [ ] Feature Store serves 82,000 reads/sec at <10ms p99
- [ ] Audit artefacts are immutable and integrity-verifiable
- [ ] All property tests pass
