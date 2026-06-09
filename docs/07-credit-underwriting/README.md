# Task 9: Credit Underwriting Service

## Summary

Implements ML-based credit scoring for retail unsecured and SME working capital loans with fairness monitoring, adverse-action explanations, and behavioural credit-line management.

## Sub-Tasks

### 9.1 — Credit Scoring and Decisioning

**Requirements**: 5.1–5.4

**Purpose**: Automated credit decisioning with reduced turnaround times and thin-file support.

**Interface**:
```typescript
interface CreditUnderwritingService {
  scoreRetail(application: RetailLoanApplication): Promise<CreditDecision>;
  scoreSME(application: SMEApplication): Promise<CreditDecision>;
  adjustCreditLine(customerId: string, signals: BehaviouralSignals): Promise<CreditLineResult>;
}

interface CreditDecision {
  applicationId: string;
  decision: 'APPROVE' | 'DECLINE' | 'REFER_TO_HUMAN';
  creditScore: number;
  confidence: number;
  adverseActionFactors?: AdverseActionFactor[];  // Min 4 for declines
  alternateDataUsed: boolean;
  modelVersion: string;
  decisionTimestamp: ISO8601;
}

interface AdverseActionFactor {
  factor: string;             // Plain language description
  rank: number;               // 1 = most impactful
  readingLevel: 'GRADE_8';   // Written at ≤8th grade level
}
```

**SLA Targets**:
| Loan Type | Current TAT | Target TAT |
|-----------|-------------|------------|
| Retail Unsecured | 26 hours | 4 hours |
| SME Working Capital | 9 days | 48 hours |

**Thin-File Handling**:
- Threshold: <6 months credit bureau history
- Alternate data sources: telecom payment history, utility payments, UPI transaction patterns, rental payments
- Never auto-decline thin-file — must produce a scoreable decision using alternate data

---

### 9.2 — Fairness Metrics and Behavioural Credit-Line Management

**Requirements**: 5.5, 5.6, 6.1–6.6

**Purpose**: Ensure fair-lending compliance and dynamic credit-line optimisation.

**Fairness Monitoring**:
```typescript
interface FairnessReport {
  reportPeriod: { from: ISO8601; to: ISO8601 };
  modelVersion: string;
  cohortMetrics: CohortMetric[];
  overallDisparateImpact: number;
  complianceStatus: 'PASS' | 'FAIL' | 'WARNING';
  failedCohorts: string[];
}

interface CohortMetric {
  cohort: string;            // e.g., "gender:female", "geography:rural"
  approvalRate: number;
  defaultRate: number;
  disparateImpactRatio: number;  // Must be ≥ 0.80
  sampleSize: number;
}
```

**Fair-Lending Compliance Gate**:
- Compute disparate impact ratio for EVERY credit decision across all protected categories
- Protected categories: gender, geography, income band, caste, age, marital status, national origin, religion
- If ANY cohort ratio < 0.80 → **BLOCK** the decision, flag for human review
- Log failed evaluation with the specific category that triggered the block

**Behavioural Credit-Line Management**:
```typescript
interface BehaviouralSignals {
  paymentPatterns90d: PaymentHistory;
  utilisationTrend: TrendDirection;
  incomeIndicators: IncomeSignal[];
  spendingTrajectory: SpendTrend;
}

interface CreditLineResult {
  customerId: string;
  recommendation: 'INCREASE' | 'DECREASE' | 'MAINTAIN';
  currentLimit: Money;
  recommendedLimit: Money;
  explanation: ExplanationFactor[];    // Min 3 factors ranked by influence
  fairnessCheck: FairnessCheckResult;
  adverseActionNotice?: AdverseActionNotice;  // Required for decreases
}
```

**Adverse-Action Notices** (for credit-line reductions):
- Generated within 5 seconds
- 2-4 specific reasons
- Written at ≤8th grade reading level
- Example: "Your recent payment history shows 3 late payments in the past 90 days"

**Challenger Models**:
- Shadow-scoring mode for minimum 3 months before promotion
- Monthly comparison: accuracy, approval rate, default rate, fairness metrics
- Champion vs challenger comparison never affects live decisions

**Fallback Behaviour**:
- If model unavailable → route to manual underwriting queue
- If confidence < threshold → escalate to human underwriter
- If credit-line model unavailable or confidence < 0.60 → defer adjustment, queue for re-evaluation in 24h

**Property Tests**:
- Property 11: Fair-lending compliance gate — execution blocked if any cohort ratio < 0.80
- Property 25: Adverse-action explanations always contain ≥4 factors for declines, ≥2 for reductions

## Acceptance Criteria Verification

- [ ] Retail unsecured decisions produced within 4 hours
- [ ] SME WC decisions produced within 48 hours
- [ ] Adverse-action explanations contain ≥4 ranked factors for declines
- [ ] Thin-file applicants scored using alternate data (never auto-declined)
- [ ] Fair-lending gate blocks execution when disparate impact ratio < 0.80
- [ ] Behavioural credit-line adjustments explain ≥3 contributing factors
- [ ] Adverse-action notices for reductions: 2-4 reasons, ≤8th grade reading level, <5 seconds
- [ ] Challenger model comparison reports generated monthly
- [ ] All property tests pass
