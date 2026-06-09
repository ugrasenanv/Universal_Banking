# Task 11: Conversational AI and Copilot Services

## Summary

Implements the multilingual customer-facing virtual assistant (11 languages), the Wealth/Corporate RM Copilot, and the Branch Copilot for internal staff.

## Sub-Tasks

### 11.1 — Conversational AI Service

**Requirements**: 7.1–7.10

**Purpose**: Multilingual intelligent assistant for retail customers across mobile app and IVR.

**Interface**:
```typescript
interface ConversationalAIService {
  processMessage(session: SessionContext, message: UserMessage): Promise<AssistantResponse>;
  transferSession(fromChannel: Channel, toChannel: Channel, sessionId: string): Promise<void>;
  detectLanguage(text: string): LanguageDetection;
  escalateToHuman(session: SessionContext, reason: string): Promise<EscalationResult>;
}

interface AssistantResponse {
  responseText: string;
  language: LanguageCode;
  confidence: number;
  intent: DetectedIntent;
  suggestedActions: Action[];
  escalationRequired: boolean;
  latencyMs: number;
}
```

**Language Support** (11 languages):
English, Hindi, Tamil, Telugu, Marathi, Bengali, Kannada, Malayalam, Arabic, Bahasa Malay, Mandarin

**Performance Targets**:
| Channel | Response Latency (p95) | Intent Accuracy |
|---------|----------------------|-----------------|
| Mobile | ≤5 seconds | ≥90% per language |
| IVR | ≤3 seconds | ≥90% per language |

**Routine Queries Automated**:
- Balance inquiries
- Transaction history
- Fund transfers
- Card blocking
- Statement requests
- Payment status checks

**Cross-Channel Session Transfer**:
```typescript
interface SessionState {
  sessionId: string;
  customerId: string;
  language: LanguageCode;
  conversationHistory: Message[];
  detectedIntent: Intent;
  collectedFields: Record<string, string>;
  authenticationLevel: AuthLevel;
  channel: Channel;
}
// Transfer completes within 3 seconds
// No re-authentication required within session validity (15-min inactivity window)
```

**Content Safety**:
- Every response passes through content-safety classifier
- Blocks: toxicity, profanity, discriminatory content, policy contradictions
- Brand-safe tone enforcement

**Escalation to Human**:
- Triggered when confidence < threshold
- Completes within 10 seconds
- Transfers: full transcript, detected intent, retrieved context, suggested resolution

**Unsupported Language Fallback**:
- Default to English
- Present explicit language-selection option in first response

---

### 11.3 — RM Copilot

**Requirements**: 8.1–8.8

**Purpose**: AI-powered research and advisory assistant for Wealth and Corporate Relationship Managers.

**Interface**:
```typescript
interface RMCopilot {
  prepareClientBrief(rmId: string, clientId: string): Promise<ClientBrief>;
  queryResearch(rmId: string, clientId: string, query: string): Promise<ResearchResponse>;
}

interface ClientBrief {
  clientId: string;
  portfolioSummary: PortfolioSummary;
  marketInsights: Insight[];
  productRecommendations: ProductRecommendation[];
  citations: Citation[];        // Document name, section, publication date
  generationTimeMs: number;    // Target: <30,000ms
}
```

**Key Constraints**:
- **30-Second Brief**: Synthesised client preparation within 30 seconds
- **PII Isolation**: Single-client context per session, no cross-client leakage
- **Source Citations**: Document name + section + publication date for every factual claim
- **Data Residency**: Singapore data stays in SG, Dubai in AE, London in GB
- **Fallback**: If frontier model unavailable due to residency, use local model and indicate capability reduction

**Data Gathering Reduction Target**: From 40% of weekly hours to below 15%

---

### 11.4 — Branch Copilot

**Requirements**: 12.1–12.4

**Purpose**: Internal AI assistant for branch operations staff to query policies, circulars, and product details.

**Interface**:
```typescript
interface BranchCopilot {
  query(staffId: string, question: string): Promise<BranchCopilotResponse>;
}

interface BranchCopilotResponse {
  answer: string;
  citations: PolicyCitation[];     // Mandatory — never answer without citation
  confidence: number;
  refusal: boolean;               // true if insufficient source material
  generationTimeMs: number;       // Target: <10,000ms
}

interface PolicyCitation {
  documentName: string;
  section: string;
  effectiveDate: ISO8601;
  sourceType: 'POLICY' | 'CIRCULAR' | 'PRODUCT_SPEC';
}
```

**Key Behaviour**:
- **Mandatory Citations**: Every answer must include source document references
- **Refusal on Low Confidence**: If retrieval confidence < threshold, refuse to answer and direct to escalation
- **Hybrid Retrieval**: BM25 + dense vector search over internal corpus
- **Corpus Updates**: New policies/circulars incorporated within 1 hour without full re-index

**Property Tests**:
- Property 18: Cross-channel session state preservation — session transfers are lossless

## Acceptance Criteria Verification

- [ ] 11 languages supported with ≥90% intent accuracy per language
- [ ] Cross-channel session transfer completes within 3 seconds without data loss
- [ ] AHT reduced from 7m12s to ≤3m30s (rolling 30-day average)
- [ ] Content safety blocks toxic/inappropriate responses
- [ ] Escalation to human within 10 seconds with full context
- [ ] RM Copilot generates brief within 30 seconds with citations
- [ ] PII isolation prevents cross-client data leakage
- [ ] Data residency enforced per jurisdiction for RM Copilot
- [ ] Branch Copilot always includes source citations
- [ ] Branch Copilot refuses when retrieval confidence below threshold
- [ ] All property tests pass
