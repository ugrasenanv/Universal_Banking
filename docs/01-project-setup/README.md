# Task 1: Project Setup and Core Interfaces

## Summary

Establishes the monorepo structure, shared TypeScript types, and data classification system that all other services depend on.

## Sub-Tasks

### 1.1 — Create Monorepo Directory Structure

**Requirements**: 22.1, 22.2

**Objective**: Set up a well-organised monorepo with clear package boundaries.

**Directory Structure**:
```
afg-platform/
├── packages/
│   ├── shared-types/          # Domain types, interfaces, enums
│   ├── platform-services/     # Infrastructure services (identity, streaming, audit)
│   ├── ai-services/           # ML/GenAI services (fraud, AML, credit, etc.)
│   ├── data-layer/            # Feature store, customer 360, mainframe facade
│   ├── integration-layer/     # CDC, event processing, external system connectors
│   └── infrastructure/        # K8s configs, Helm charts, Terraform modules
├── tests/
│   ├── property/              # Property-based tests (fast-check)
│   └── integration/           # End-to-end integration tests
├── docs/                      # This documentation
├── tsconfig.base.json         # Shared TypeScript config
├── package.json               # Root workspace config
└── vitest.config.ts           # Test configuration
```

**Configuration Details**:
- TypeScript strict mode enabled globally
- Path aliases configured for cross-package imports (`@afg/shared-types`, `@afg/ai-services`, etc.)
- Vitest as test runner with fast-check integration for property-based tests
- ESLint + Prettier for code quality

---

### 1.2 — Define Core Shared Types and Interfaces

**Requirements**: 28.1, 28.3, 24.1

**Key Types to Implement**:

```typescript
// Jurisdictions
enum Jurisdiction {
  INDIA = 'IN',
  SINGAPORE = 'SG',
  UAE = 'AE',
  UK = 'GB',
  US = 'US'
}

// Platform Event Envelope
interface PlatformEvent<T> {
  eventId: string;           // UUID v7
  eventType: string;         // Domain-qualified event name
  timestamp: ISO8601;        // Event creation time
  jurisdiction: Jurisdiction;
  sourceService: string;
  correlationId: string;     // Distributed trace context
  payload: T;
  schemaVersion: string;     // Semantic version
}

// Dead Letter Event
interface DeadLetterEvent {
  originalEvent: PlatformEvent<unknown>;
  failureReason: string;
  retryCount: number;
  lastRetryTimestamp: ISO8601;
  diagnosticContext: Record<string, unknown>;
}

// Audit Artefact
interface AuditArtefact {
  artefactId: string;
  customerId?: string;
  serviceId: string;
  jurisdiction: Jurisdiction;
  timestamp: ISO8601;
  modelVersion?: string;
  inputFeatures?: Record<string, unknown>;
  prompt?: string;
  retrievedContext?: string[];
  modelOutput: unknown;
  confidenceScore?: number;
  humanOverride?: HumanOverrideRecord;
  downstreamAction: string;
  integrityHash: string;     // SHA-256 of artefact content
  retentionExpiry: ISO8601;  // timestamp + 7 years
}

// Circuit Breaker
interface CircuitBreakerConfig {
  failureThreshold: number;   // default: 3
  recoveryTimeout: number;    // ms, default: 10000
  halfOpenMaxRequests: number; // default: 1
}
```

**Integrity Hash Computation**:
- Serialise artefact fields (excluding `integrityHash`) in canonical JSON format
- Compute SHA-256 hash
- Store as hex string in `integrityHash` field

---

### 1.3 — Data Classification and Residency Enforcement

**Requirements**: 16.1–16.6

**Types**:
```typescript
enum DataClassification {
  RESTRICTED = 'RESTRICTED',     // PII, financial data
  CONFIDENTIAL = 'CONFIDENTIAL', // Internal business data
  INTERNAL = 'INTERNAL',         // General internal
  PUBLIC = 'PUBLIC'              // Publishable data
}

interface JurisdictionPolicy {
  jurisdiction: Jurisdiction;
  allowedStorageRegions: string[];
  allowedProcessingRegions: string[];
  crossBorderAllowed: boolean;
  anonymisationRequired: boolean;
  dpoApprovalRequired: boolean;
}

class ResidencyValidator {
  validate(operation: DataOperation): ResidencyResult;
  // Returns ALLOWED, BLOCKED, or REQUIRES_ANONYMISATION
}
```

**Residency Rules**:
| Jurisdiction | Storage | Processing | Cross-Border |
|---|---|---|---|
| India (RBI/DPDP) | India only | India only | Only if anonymised + DPO approval |
| UAE (DFSA/PDPL) | UAE only | UAE only | Only if anonymised + DPO approval |
| UK (GDPR/FCA) | UK only | UK only | Only if anonymised + DPO approval |
| Singapore (MAS) | Singapore only | Singapore only | Only if anonymised + DPO approval |

## Acceptance Criteria Verification

- [ ] Monorepo builds successfully with `npm run build`
- [ ] All shared types compile with TypeScript strict mode
- [ ] SHA-256 integrity hash computation produces consistent results
- [ ] ResidencyValidator blocks cross-border data movement for restricted data
- [ ] Property test: Audit artefact integrity round-trip passes
