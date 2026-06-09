# Task 16: Human Review Queue and Governance

## Summary

Implements the Human-in-the-Loop review queue for high-impact AI decisions and the Model Registry with full governance framework aligned to SR 11-7 and RBI MRM guidance.

## Sub-Tasks

### 16.1 — Human Review Queue

**Requirements**: 15.1–15.6

**Purpose**: Structured escalation and approval workflow for AI decisions requiring human oversight.

**Interface**:
```typescript
interface HumanReviewQueue {
  enqueue(item: ReviewItem): Promise<EnqueueResult>;
  assign(itemId: string, reviewerId: string): Promise<void>;
  recordDecision(itemId: string, decision: HumanDecision): Promise<void>;
  notifyCustomer(customerId: string, notification: HoldNotification): Promise<void>;
}

interface ReviewItem {
  itemId: string;
  sourceService: string;
  decisionType: HighImpactAction;
  aiDecision: AIDecisionPayload;
  confidence: number;
  urgency: 'IMMEDIATE' | 'STANDARD' | 'LOW';
  customerId: string;
  timestamp: ISO8601;
}

type HighImpactAction =
  | 'SAR_FILING'
  | 'TRANSACTION_HOLD'    // Hold exceeding 1 hour
  | 'CREDIT_DECLINE'
  | 'CREDIT_LINE_REDUCTION'
  | 'SANCTIONS_MATCH';

interface HumanDecision {
  reviewerId: string;
  action: 'APPROVE' | 'REJECT' | 'MODIFY';
  rationale: string;
  modifications?: Record<string, unknown>;
  timestamp: ISO8601;
}
```

**Routing Rules**:
| Trigger | Routing Time | Queue Priority |
|---------|-------------|---------------|
| Confidence below use-case threshold | ≤30 seconds | STANDARD |
| SAR filing recommendation | ≤30 seconds | IMMEDIATE |
| Transaction hold >1 hour | ≤30 seconds | IMMEDIATE |
| Credit decline | ≤30 seconds | STANDARD |
| Credit-line reduction | ≤30 seconds | STANDARD |

**Customer Notification**:
- When transaction is held pending review → notify customer within 60 seconds
- Include: hold reason (generic), expected resolution time
- Channel: push notification + SMS

**Feedback Loop**:
- Human decision ingested into model improvement pipeline within 24 hours
- PII stripped before entering training data
- Feedback types: approve (AI was right), reject (AI was wrong), modify (partially right)

**Complete Decision Chain** (captured for every review):
```json
{
  "itemId": "review-001",
  "prompt": "...",
  "retrievedContext": ["..."],
  "modelOutput": "...",
  "aiConfidence": 0.62,
  "humanDecision": "APPROVE",
  "humanRationale": "...",
  "downstreamAction": "SAR filed to FIU",
  "timestamp": "2026-06-09T12:00:00Z"
}
```

---

### 16.2 — Model Registry and Governance Framework

**Requirements**: 18.1–18.7

**Purpose**: Centralised model lifecycle management aligned with SR 11-7 and RBI MRM guidance.

**Interface**:
```typescript
interface ModelRegistry {
  register(model: ModelRegistration): Promise<string>;
  getInventory(filters?: ModelFilters): Promise<ModelEntry[]>;
  updateStatus(modelId: string, status: ModelStatus): Promise<void>;
  archiveModel(modelId: string): Promise<void>;
  getProvenance(modelId: string): Promise<ModelProvenance>;
}

interface ModelEntry {
  modelId: string;
  modelName: string;
  purpose: string;
  owner: string;
  riskTier: 'TIER_1_CRITICAL' | 'TIER_2_HIGH' | 'TIER_3_MEDIUM' | 'TIER_4_LOW';
  validationStatus: 'PENDING' | 'VALIDATED' | 'EXPIRED' | 'REJECTED';
  deploymentHistory: Deployment[];
  challengerModelId?: string;
  driftStatus: 'STABLE' | 'DRIFTING' | 'CRITICAL';
  lastValidation: ISO8601;
  nextValidationDue: ISO8601;
}

interface ModelProvenance {
  modelId: string;
  trainingDataLineage: DataLineageEntry[];
  hyperparameters: Record<string, unknown>;
  evaluationResults: EvaluationResult[];
  approvalChain: Approval[];
  createdAt: ISO8601;
  deployedAt?: ISO8601;
  retiredAt?: ISO8601;
  archivalExpiry: ISO8601;    // Retention for 7 years
}
```

**Governance Rules**:

| Rule | Enforcement |
|------|-------------|
| Challenger required | Every credit and fraud model must have an active challenger |
| Validation independence | Validating team ≠ developing team (organisational separation) |
| Drift alerting | Automated alert within 1 hour of threshold breach |
| Monthly comparison | Champion vs challenger performance report (accuracy, FP, FN, fairness) |
| Model archival | 7-year retention even after retirement |
| Right-to-explanation | Retrieve historical model + inputs to reconstruct decision within 30 days |

**Drift Detection**:
```typescript
interface DriftMonitor {
  checkDrift(modelId: string): Promise<DriftResult>;
}

interface DriftResult {
  modelId: string;
  metrics: {
    accuracy: DriftMetric;
    fairness: DriftMetric;
    stability: DriftMetric;
  };
  overallStatus: 'STABLE' | 'DRIFTING' | 'CRITICAL';
  alertRequired: boolean;     // true if any metric exceeds threshold
  recalibrationRequired: boolean;
}

// Thresholds (configurable per model):
// Accuracy: warn at -2%, alert at -5%
// Fairness: warn at ratio < 0.85, alert at ratio < 0.80
// Stability: warn at PSI > 0.1, alert at PSI > 0.2
```

**Challenger Model Workflow**:
```
Challenger Deployed (shadow-scoring mode)
  ↓ Minimum 3 months observation
Monthly Comparison Reports Generated
  ↓ If challenger outperforms champion on key metrics
Promotion Request → Model Risk Officer Review
  ↓ Approval (validation-independent team)
Champion Retired → Challenger Promoted
  ↓
Old Champion Archived (7-year retention)
```

## Acceptance Criteria Verification

- [ ] Low-confidence decisions routed to human within 30 seconds
- [ ] HITL gate blocks high-impact actions without human approval
- [ ] Customer notified of hold within 60 seconds
- [ ] Complete decision chain captured for every review
- [ ] Feedback ingested within 24 hours, PII-free
- [ ] All models inventoried with risk tier, owner, validation status
- [ ] Challenger model active for every credit and fraud model
- [ ] Validation independence enforced (separate teams)
- [ ] Drift alert fires within 1 hour of threshold breach
- [ ] Model provenance tracked (lineage, hyperparams, evals, approvals)
- [ ] Historical model retrievable for 7 years for right-to-explanation
