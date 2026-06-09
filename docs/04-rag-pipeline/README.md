# Task 5: RAG Pipeline

## Summary

Implements the retrieval-augmented generation pipeline including document ingestion, chunking, multilingual embedding, hybrid retrieval, tenant isolation, and groundedness scoring.

## Sub-Tasks

### 5.1 — Document Ingestion and Chunking

**Requirements**: 23.1, 23.3

**Purpose**: Convert documents into optimally-sized chunks for embedding and retrieval.

**Chunking Strategies**:

| Corpus | Strategy | Chunk Size | Overlap | Rationale |
|--------|----------|-----------|---------|-----------|
| AML Case History | Hierarchical + Semantic | 512-1024 tokens | 20% | Investigative narratives need longer context for reasoning chains |
| Wealth Product/Research | Structural | 256-512 tokens | 10% | Factual details are dense; smaller chunks improve precision |
| Policies/Circulars | Structural (section-based) | 256-512 tokens | 15% | Well-structured documents with clear section boundaries |
| KYC Documents | Fixed + Semantic | 128-256 tokens | 5% | Short extracted fields, need precise retrieval |

**Semantic Boundary Detection**:
```typescript
interface ChunkingService {
  chunk(document: Document, strategy: ChunkingStrategy): Chunk[];
  detectBoundaries(text: string): SectionBoundary[];
}

interface Chunk {
  chunkId: string;
  documentId: string;
  content: string;
  tokenCount: number;
  metadata: ChunkMetadata;
  sectionPath: string[];     // Hierarchical section breadcrumb
  language: LanguageCode;
}
```

**Incremental Updates**:
- New/updated documents are chunked and embedded without full re-index
- Deleted documents have their chunks removed from the vector store
- Update latency target: within 1 hour of corpus change

---

### 5.3 — Embedding, Indexing, and Retrieval

**Requirements**: 23.2, 23.4, 23.5, 23.6, 23.7

**Embedding Configuration**:
- Model: Multilingual embedding model (e.g., multilingual-e5-large or equivalent)
- Dimensions: ≥768
- Languages: All 11 platform languages with cross-lingual capability
- Cross-lingual: Query in Hindi retrieves relevant English documents

**Hybrid Retrieval Pipeline**:
```
Query
  ├── BM25 Lexical Search (sparse retrieval)
  ├── Dense Vector Search (semantic retrieval)
  └── Merge + Cross-Encoder Reranker
      ↓
  Top-K Results (within 200ms p95)
```

**Tenant Isolation**:
```typescript
interface TenantIsolation {
  // Vector indices are partitioned by tenant/business-unit
  // Queries are scoped to the caller's tenant partition
  // No cross-tenant retrieval is possible at the index level
  resolvePartition(principal: Principal): TenantPartition;
  validateAccess(principal: Principal, chunk: Chunk): boolean;
}
```

**Groundedness Scoring**:
```typescript
interface GroundednessScorer {
  score(response: string, retrievedChunks: Chunk[]): GroundednessResult;
}

interface GroundednessResult {
  overallScore: number;       // 0.00 - 1.00
  claimScores: ClaimScore[];  // Per-claim breakdown
  ungroundedClaims: string[]; // Claims not supported by evidence
  refusalRequired: boolean;   // true if score < threshold (default 0.70)
}
```

**Refusal Behaviour**: If groundedness score < 0.70:
- Response is NOT presented to user
- Structured refusal message returned: "Insufficient evidence to provide a reliable answer"
- Failure logged in audit trail

**Property Tests**:
- Property 24: All chunks fall within configured size bounds (no oversized chunks)
- Property 12: Tenant isolation — queries never return chunks from other tenants
- Property 23: Groundedness score is always between 0.00-1.00; refusal triggers below threshold

## Acceptance Criteria Verification

- [ ] AML chunks are 512-1024 tokens with semantic boundaries
- [ ] Wealth/product chunks are 256-512 tokens with structural boundaries
- [ ] Corpus updates incorporate within 1 hour without full re-index
- [ ] Hybrid retrieval returns top-k within 200ms p95
- [ ] Cross-lingual retrieval works (Hindi query → English documents)
- [ ] Tenant isolation prevents cross-tenant document access
- [ ] Groundedness scoring triggers refusal below 0.70 threshold
- [ ] All property tests pass
