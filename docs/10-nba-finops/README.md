# Task 13: NBA Engine and FinOps Service

## Summary

Implements the Next-Best-Action personalisation engine for real-time product recommendations and the FinOps cost tracking service for platform cost optimisation.

## Sub-Tasks

### 13.1 — Next-Best-Action Engine

**Requirements**: 11.1–11.5

**Purpose**: Real-time personalised product recommendations delivered to mobile app customers and RMs.

**Interface**:
```typescript
interface NBAEngine {
  getCustomerRecommendations(customerId: string, context: AppContext): Promise<Recommendations>;
  getRMActions(rmId: string, clientId: string): Promise<RMActions>;
  measureFairness(period: ReportingPeriod): Promise<FairnessReport>;
}

interface Recommendations {
  customerId: string;
  recommendations: ProductRecommendation[];
  computeTimeMs: number;            // Target: <2,000ms for mobile
  signalFreshness: ISO8601;         // Feature freshness (<5 minutes)
}

interface ProductRecommendation {
  productId: string;
  productName: string;
  relevanceScore: number;           // 0.00 - 1.00
  reasoning: string;                // Why this recommendation
  triggerSignals: string[];         // What signals drove this
  rank: number;
}

interface RMActions {
  clientId: string;
  actions: NextBestAction[];
  computeTimeMs: number;            // Target: <3,000ms
}

interface NextBestAction {
  actionType: string;
  priority: number;
  reasoning: string;
  expectedOutcome: string;
  supportingData: Record<string, unknown>;
}
```

**Performance Targets**:
| Channel | Latency | Freshness |
|---------|---------|-----------|
| Mobile App | <2 seconds | <5 minutes |
| RM Workstation | <3 seconds | <5 minutes |

**Real-Time Signals** (replacing batch campaigns):
- Transaction recency and patterns
- Channel engagement (app opens, feature usage)
- Life-event indicators (salary credit, large purchase, address change)
- Product holdings and utilisation
- Browsing and search patterns (within app)

**Conversion Target**: 20% lift vs batch-driven campaign baseline (measured over 90-day rolling window)

**Fairness Monitoring**:
- Monthly fairness report per customer segment
- Detect and report systematic exclusion of demographic groups from product offers
- Alert if recommendation distribution shows significant skew vs population distribution

---

### 13.2 — FinOps Service

**Requirements**: 21.1, 21.2, 21.6, 21.7

**Purpose**: Granular cost tracking and optimisation for the AI/ML platform.

**Interface**:
```typescript
interface FinOpsService {
  recordCost(event: CostEvent): Promise<void>;
  getUnitEconomics(filters: CostFilters): Promise<UnitEconomicsReport>;
  getTopCostDrivers(period: ReportingPeriod): Promise<CostDriverReport>;
  getGPUUtilisation(clusterId: string): Promise<GPUUtilisationReport>;
}

interface CostEvent {
  eventId: string;
  timestamp: ISO8601;
  serviceId: string;
  customerId?: string;
  apiCall: string;
  costDrivers: CostDriver[];
  totalCostUSD: number;
  jurisdiction: Jurisdiction;
  lineOfBusiness: string;
}

interface CostDriver {
  type: 'TOKENS' | 'GPU_SECONDS' | 'STORAGE_GB' | 'EGRESS_GB' | 'OBSERVABILITY' | 'EVALUATION' | 'EMBEDDING_REFRESH';
  quantity: number;
  unitCostUSD: number;
  totalCostUSD: number;
}

interface UnitEconomicsReport {
  period: ReportingPeriod;
  perCustomerCost: number;
  perAPICallCost: number;
  perDecisionCost: number;
  byLineOfBusiness: Record<string, number>;
  monthOverMonthChange: number;
}
```

**Cost Tracking Granularity**:
- Per-customer: total AI cost attributable to each customer
- Per-API-call: cost of each inference request
- Per-decision: cost of each business decision (fraud, credit, etc.)

**Top 7 Cost Drivers Monitored**:
1. LLM tokens (input + output)
2. GPU compute (inference seconds)
3. Vector storage (index size, queries)
4. Network egress (cross-region, external)
5. Observability (traces, metrics, logs volume)
6. Model evaluation (eval harness runs)
7. Embedding refresh (re-embedding on corpus update)

**GPU Utilisation Alerting**:
- Alert if utilisation below 60% sustained for >1 hour
- Triggers right-sizing recommendation
- Monthly report with utilisation heat-maps

**Showback/Chargeback**:
- Monthly reports per Line of Business
- Unit economics breakdowns
- Trend analysis (MoM, QoQ)

**Property Tests**:
- Property 26: Cost attribution completeness — every API call produces a cost record with all required fields

## Acceptance Criteria Verification

- [ ] Mobile recommendations computed within 2 seconds
- [ ] RM actions computed within 3 seconds
- [ ] Real-time signals (not batch) drive recommendations
- [ ] Feature freshness <5 minutes
- [ ] 20% cross-sell conversion lift vs baseline (90-day measurement)
- [ ] Fairness report generated monthly per segment
- [ ] Cost tracked at per-customer, per-call, per-decision granularity
- [ ] Top 7 cost drivers reported with MoM trends
- [ ] GPU utilisation alert fires below 60% for >1 hour
- [ ] Showback/chargeback reports per LoB monthly
- [ ] All property tests pass
