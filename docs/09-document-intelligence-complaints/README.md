# Task 12: Document Intelligence and Complaints Services

## Summary

Implements OCR-based document extraction for KYC and trade-finance documents, and AI-powered complaint classification and routing.

## Sub-Tasks

### 12.1 — Document Intelligence Service

**Requirements**: 9.1–9.10

**Purpose**: Automated extraction of structured data from KYC and trade-finance documents with idempotency and regulatory compliance.

**Interface**:
```typescript
interface DocumentIntelligenceService {
  extract(document: DocumentSubmission): Promise<ExtractionResult>;
  validate(extraction: ExtractionResult, rules: ValidationRuleSet): Promise<ValidationResult>;
}

interface ExtractionResult {
  documentId: string;
  documentType: DocumentType;
  fields: ExtractedField[];
  overallConfidence: number;
  processingTimeMs: number;         // Target: <30,000ms per page
  humanReviewRequired: boolean;
  idempotencyKey: string;           // SHA-256 of document binary
}

interface ExtractedField {
  fieldName: string;
  value: string;
  confidence: number;              // 0.00 - 1.00
  boundingBox?: BoundingBox;       // Location in source document
  flaggedForReview: boolean;       // true if confidence < 0.85
}
```

**Supported Document Types**:
| Type | Category | Key Fields |
|------|----------|------------|
| National ID | KYC | Name, DOB, ID number, address |
| Passport | KYC | Name, DOB, passport number, nationality, expiry |
| Utility Bill | KYC | Name, address, date, account number |
| Letter of Credit | Trade Finance | Applicant, beneficiary, amount, expiry, terms |
| Bill of Lading | Trade Finance | Shipper, consignee, goods, vessel, port |
| Commercial Invoice | Trade Finance | Seller, buyer, items, amounts, Incoterms |
| Bank Guarantee | Trade Finance | Guarantor, beneficiary, amount, validity |

**Performance Targets**:
| Metric | Target |
|--------|--------|
| Field-level error rate | <3% |
| Processing time per page | <30 seconds |
| Confidence threshold (human review) | 0.85 |
| Rejection of corrupt documents | <10 seconds |

**Idempotency**:
```typescript
// Same document binary → same extraction results
// Key: SHA-256(document_binary)
// If same key submitted again → return cached result without re-processing
```

**Trade-Finance Compliance**:
- ICC UCP 600 rules for Letters of Credit
- ISBP 745 rules for document examination
- Round-trip property: extract → format → re-extract produces identical field values

**Error Handling**:
- Unreadable/corrupt/unsupported → reject within 10 seconds, return reason, no partial results
- Timeout → route to manual processing, log timeout event
- Critical field below confidence → route to human with pre-populated data

---

### 12.4 — Complaints Intelligence Service

**Requirements**: 10.1–10.6

**Purpose**: AI-powered complaint classification, routing, and regulatory reporting.

**Interface**:
```typescript
interface ComplaintsIntelligenceService {
  classify(complaint: IncomingComplaint): Promise<ClassificationResult>;
  generateSummary(complaintId: string): Promise<RegulatoryComplaintSummary>;
}

interface ClassificationResult {
  complaintId: string;
  category: ComplaintCategory;
  subcategory: string;
  routedTo: ResolutionTeam;
  confidence: number;
  reasoning: string;
  processingTimeMs: number;        // Target: <30,000ms
  escalatedToSenior: boolean;      // true if confidence < threshold
}

interface RegulatoryComplaintSummary {
  complaintId: string;
  category: string;
  subcategory: string;
  customerIssue: string;
  resolutionTeam: string;
  conformsToSchema: 'RBI_CMS' | 'BANKING_OMBUDSMAN';
}
```

**Performance Targets**:
| Metric | Target |
|--------|--------|
| Classification + routing | <30 seconds |
| Misrouting rate | <5% (from 22%) |
| Audit trail retention | 7 years |

**Fallback Behaviour**:
- If classification confidence < threshold → route to senior officer for manual classification
- If service unavailable or timeout (>30 seconds) → route to senior officer, log failure

**Audit Trail** (every complaint):
- Timestamp, category assigned, confidence score
- Classification reasoning, routing decision
- Resolution outcome (added when resolved)
- Retained for minimum 7 years

**Property Tests**:
- Property 13: Document extraction idempotency — same binary always produces same output
- Property 14: Trade-finance round-trip — extract→format→re-extract produces identical fields
- Property 19: Complaint classification consistency — same complaint text always maps to same category

## Acceptance Criteria Verification

- [ ] KYC documents extracted with <3% field-level error rate
- [ ] Processing completes within 30 seconds per page
- [ ] Idempotent: re-submission produces identical results
- [ ] Low-confidence critical fields routed to human reviewer
- [ ] Trade-finance documents parsed per ICC UCP 600 / ISBP 745
- [ ] Round-trip property holds for all valid trade-finance documents
- [ ] Corrupt documents rejected within 10 seconds
- [ ] Complaints classified and routed within 30 seconds
- [ ] Misrouting rate <5%
- [ ] RBI CMS / Banking Ombudsman reporting schema compliance
- [ ] All property tests pass
