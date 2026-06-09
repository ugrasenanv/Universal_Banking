# Task 15: Integration Layer and Data Unification

## Summary

Implements the Mainframe Facade for non-intrusive z/OS integration and the Customer Data Unification layer (Customer 360) aggregating data from all source systems.

## Sub-Tasks

### 15.1 — Mainframe Facade

**Requirements**: 26.1–26.4, 22.5, 24.5

**Purpose**: API abstraction layer providing access to IBM z/OS mainframe corporate and trade-finance data without impacting MIPS budget or requiring mainframe changes.

**Interface**:
```typescript
interface MainframeFacade {
  getAccountData(accountId: string): Promise<AccountData>;
  getTradeFinanceData(dealId: string): Promise<TradeFinanceData>;
  getCorporateClient(clientId: string): Promise<CorporateClientData>;
  getTransactionHistory(accountId: string, range: DateRange): Promise<Transaction[]>;
}
```

**Architecture**:
```
AI Services → Mainframe Facade (RESTful APIs)
                    ↓
              Near-Real-Time Replica Cache
                    ↑
              CDC / Batch Extraction from z/OS
```

**Data Egress Patterns**:
| Pattern | Use Case | Lag | MIPS Impact |
|---------|----------|-----|-------------|
| Batch Extraction | Reference data (client master, products) | ≤1 hour | Minimal (off-peak) |
| CDC Log Streaming | Transaction events, balance updates | ≤5 minutes | Low (passive log read) |
| Cached Replica | AI service queries | Near-real-time | Zero (reads from cache) |

**Key Constraints**:
- **No Mainframe Modification**: Facade sits outside mainframe; no CICS or COBOL changes
- **MIPS Budget**: Batch extraction scheduled during off-peak (2AM-5AM IST), CDC reads transaction logs passively
- **Cache Consistency**: Transactional data ≤5 min lag, reference data ≤1 hour lag
- **AI Services**: Always read from cache, never issue synchronous mainframe calls

**Integration with Streaming Backbone**:
- CDC events from z/OS published to `afg.mainframe.cdc.{entity}` topics
- Batch extraction results published to `afg.mainframe.batch.{entity}` topics
- Consumer services subscribe to relevant topics for cache population

---

### 15.2 — Customer Data Unification (Customer 360)

**Requirements**: 29.1–29.4

**Purpose**: Enterprise customer 360-degree view aggregating data from all 18+ source systems.

**Interface**:
```typescript
interface CustomerDataService {
  getUnifiedProfile(customerId: string): Promise<UnifiedCustomerProfile>;
  resolveIdentity(identifiers: CustomerIdentifier[]): Promise<GoldenRecord>;
  subscribeToUpdates(customerId: string, callback: UpdateCallback): Subscription;
}

interface UnifiedCustomerProfile {
  goldenRecordId: string;
  identifiers: CustomerIdentifier[];  // PAN, Aadhaar, passport, account numbers
  demographics: Demographics;
  products: ProductHolding[];
  relationships: Relationship[];
  riskProfile: RiskProfile;
  channelPreferences: ChannelPreference[];
  lastUpdated: ISO8601;
  dataFreshness: DataFreshness;
  sourceSystemContributions: SourceContribution[];
}

interface GoldenRecord {
  goldenRecordId: string;
  matchMethod: 'DETERMINISTIC' | 'PROBABILISTIC';
  matchConfidence: number;     // ≥99.5% accuracy target
  linkedSourceIds: SourceSystemLink[];
}
```

**Source Systems**:
| # | System | Data Provided |
|---|--------|---------------|
| 1 | Finacle 10.x | Retail accounts, deposits, loans, cards (India) |
| 2 | T24 | Accounts, products (Singapore, UK) |
| 3 | z/OS Mainframe | Corporate banking, trade finance |
| 4 | Aurora Neobank | Digital banking products |
| 5-18 | 14 Satellite Systems | Cards, AML, loans, treasury, KYC, sanctions, complaints, collections, etc. |

**Identity Resolution**:
```typescript
interface IdentityResolver {
  resolve(identifiers: CustomerIdentifier[]): Promise<GoldenRecord>;
}

// Deterministic matching:
// - Exact PAN match
// - Exact Aadhaar match
// - Exact passport number + DOB match

// Probabilistic matching:
// - Name similarity (Jaro-Winkler > 0.92)
// - Address similarity (TF-IDF cosine > 0.85)
// - Phone number partial match
// - DOB + partial name match

// Target: ≥99.5% match accuracy
```

**Data Propagation SLAs**:
| Attribute Type | Propagation Target |
|---|---|
| Transactional (balance, recent transactions) | ≤5 minutes |
| Reference (demographics, products, addresses) | ≤1 hour |

**Access Controls**:
- Each consuming service has a defined data classification scope
- Service receives only attributes it's authorised for
- Example: NBA Engine gets product holdings + channel engagement, NOT bureau scores
- Enforcement: attribute-level filtering at the Customer Data Service

**Property Tests**:
- Property 20: Identity resolution determinism — same set of identifiers always resolves to same golden record
- Property 21: Access control enforcement — services never receive attributes outside their authorisation scope

## Acceptance Criteria Verification

- [ ] Mainframe Facade exposes RESTful APIs without mainframe modification
- [ ] Batch extraction during off-peak only (2AM-5AM IST)
- [ ] Cache lag: ≤5 minutes transactional, ≤1 hour reference
- [ ] AI services never issue synchronous mainframe calls
- [ ] Unified profile aggregates from all 18+ source systems
- [ ] Identity resolution achieves ≥99.5% match accuracy
- [ ] Data propagation meets SLAs (5 min / 1 hour)
- [ ] Access controls enforce per-service data scope
- [ ] All property tests pass
