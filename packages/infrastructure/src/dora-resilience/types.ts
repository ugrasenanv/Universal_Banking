/**
 * Types for DORA-aligned Operational Resilience.
 *
 * Covers:
 * - ICT risk register for all critical AI/ML services (Req 30.1)
 * - Third-party concentration risk mitigation (Req 30.2)
 * - Exit strategy documentation executable within 90 days (Req 30.3)
 * - Service criticality tiers and recovery runbooks (Req 30.4)
 */

import type { ISO8601 } from '@afg/shared-types';

// ─── Criticality Tiers ──────────────────────────────────────────────────────

/**
 * Service criticality tier aligned to RTO/RPO matrix.
 * - CRITICAL: Customer-facing real-time services (Fraud, Payments)
 * - HIGH: Compliance and regulatory services (AML, Sanctions, Credit)
 * - MEDIUM: Advisory and recommendation services (NBA, Copilots)
 * - LOW: Internal operational services (FinOps, Branch Copilot)
 */
export type CriticalityTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Jurisdictions subject to DORA operational resilience requirements. */
export type DoraJurisdiction = 'UK' | 'EU';

/** Service operational status for the risk register. */
export type ServiceStatus = 'OPERATIONAL' | 'DEGRADED' | 'IMPAIRED' | 'UNAVAILABLE';

/** Review frequency for ICT risk entries. */
export type ReviewFrequency = 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY';

/** Exit strategy execution status. */
export type ExitStrategyStatus = 'DOCUMENTED' | 'TESTED' | 'EXPIRED' | 'IN_PROGRESS';

/** Runbook test result status. */
export type RunbookTestStatus = 'PASSED' | 'FAILED' | 'NOT_TESTED' | 'PARTIALLY_PASSED';

// ─── ICT Risk Register ──────────────────────────────────────────────────────

/** Vendor dependency for a service. */
export interface VendorDependency {
  /** Vendor name. */
  vendorName: string;

  /** Category of vendor service (cloud, model, vector-db, streaming, etc.). */
  category: VendorCategory;

  /** Whether this vendor is currently the sole provider for this category. */
  isSinglePointOfFailure: boolean;

  /** Documented exit strategy for this vendor. */
  exitStrategyId?: string;

  /** Contract renewal date. */
  contractRenewalDate?: ISO8601;
}

/** Vendor category classification. */
export type VendorCategory =
  | 'CLOUD_PROVIDER'
  | 'MODEL_VENDOR'
  | 'VECTOR_DB'
  | 'STREAMING'
  | 'IDENTITY_PROVIDER'
  | 'OBSERVABILITY'
  | 'SECRETS_MANAGEMENT'
  | 'OTHER';

/** Impact assessment for a service in the ICT risk register. */
export interface ImpactAssessment {
  /** Business impact if the service becomes unavailable. */
  businessImpact: 'SEVERE' | 'HIGH' | 'MODERATE' | 'LOW';

  /** Number of customers potentially affected. */
  affectedCustomersEstimate: number;

  /** Revenue impact per hour of downtime (in USD). */
  revenueImpactPerHourUsd: number;

  /** Regulatory impact if service is unavailable beyond RTO. */
  regulatoryImpact: string;

  /** Downstream services that depend on this service. */
  downstreamDependencies: string[];
}

/** A single entry in the ICT Risk Register (Requirement 30.1). */
export interface IctRiskRegisterEntry {
  /** Unique identifier for this risk entry. */
  entryId: string;

  /** Service identifier. */
  serviceId: string;

  /** Human-readable service name. */
  serviceName: string;

  /** Criticality tier classification. */
  criticalityTier: CriticalityTier;

  /** Current operational status. */
  status: ServiceStatus;

  /** Jurisdictions this entry applies to. */
  jurisdictions: DoraJurisdiction[];

  /** Impact assessment. */
  impactAssessment: ImpactAssessment;

  /** Third-party vendor dependencies. */
  vendorDependencies: VendorDependency[];

  /** Recovery priority (lower number = higher priority). */
  recoveryPriority: number;

  /** RTO in minutes for this service. */
  rtoMinutes: number;

  /** RPO in minutes for this service. */
  rpoMinutes: number;

  /** Reference to recovery runbook. */
  runbookId: string;

  /** Date of last risk review. */
  lastReviewDate: ISO8601;

  /** Date of next scheduled review. */
  nextReviewDate: ISO8601;

  /** Review frequency. */
  reviewFrequency: ReviewFrequency;

  /** Risk mitigations in place. */
  mitigations: string[];

  /** Residual risk notes after mitigations. */
  residualRiskNotes: string;
}

// ─── Third-Party Concentration Risk ────────────────────────────────────────

/** Concentration risk assessment per vendor category (Requirement 30.2). */
export interface ConcentrationRiskAssessment {
  /** Vendor category being assessed. */
  category: VendorCategory;

  /** All vendors providing services in this category. */
  vendors: string[];

  /** Whether a single vendor constitutes a SPOF. */
  hasSinglePointOfFailure: boolean;

  /** Services dependent on this category. */
  dependentServices: string[];

  /** Mitigation strategy description. */
  mitigationStrategy: string;

  /** Exit strategy reference (if single vendor). */
  exitStrategyId?: string;

  /** Whether exit strategy has been tested. */
  exitStrategyTested: boolean;

  /** Compliant: no single-vendor SPOF without documented exit strategy. */
  compliant: boolean;
}

// ─── Exit Strategy ──────────────────────────────────────────────────────────

/** Exit strategy step. */
export interface ExitStep {
  /** Step number (execution order). */
  stepNumber: number;

  /** Step description. */
  description: string;

  /** Estimated duration in days. */
  estimatedDurationDays: number;

  /** Team/role responsible. */
  responsibleTeam: string;

  /** Dependencies on other steps (by step number). */
  dependencies: number[];

  /** Whether this step has been tested. */
  tested: boolean;
}

/** Exit strategy documentation (Requirement 30.2, 30.3). */
export interface ExitStrategy {
  /** Unique exit strategy identifier. */
  strategyId: string;

  /** Vendor being exited. */
  vendorName: string;

  /** Vendor category. */
  category: VendorCategory;

  /** Target alternative vendor(s). */
  targetVendors: string[];

  /** Services affected by this exit. */
  affectedServices: string[];

  /** Maximum execution timeline in days (must be ≤ 90). */
  maxExecutionDays: number;

  /** Ordered steps to execute the exit. */
  steps: ExitStep[];

  /** Total estimated cost of exit (USD). */
  estimatedCostUsd: number;

  /** Risks during exit execution. */
  exitRisks: string[];

  /** Current status of exit strategy documentation. */
  status: ExitStrategyStatus;

  /** Date of last exit test. */
  lastTestDate?: ISO8601;

  /** Date of next scheduled test. */
  nextTestDate?: ISO8601;

  /** Whether the strategy is executable within 90 days. */
  executableWithin90Days: boolean;

  /** Created date. */
  createdDate: ISO8601;

  /** Last updated date. */
  lastUpdatedDate: ISO8601;
}

// ─── Recovery Runbooks ──────────────────────────────────────────────────────

/** Recovery runbook step. */
export interface RunbookStep {
  /** Step number. */
  stepNumber: number;

  /** Step title. */
  title: string;

  /** Detailed instructions. */
  instructions: string;

  /** Expected duration in minutes. */
  expectedDurationMinutes: number;

  /** Automated (can be triggered without human) or manual. */
  executionType: 'AUTOMATED' | 'MANUAL';

  /** Verification criteria to confirm step success. */
  verificationCriteria: string;

  /** Rollback instructions if step fails. */
  rollbackInstructions: string;
}

/** Recovery runbook for a service tier (Requirement 30.4). */
export interface RecoveryRunbook {
  /** Unique runbook identifier. */
  runbookId: string;

  /** Service this runbook applies to. */
  serviceId: string;

  /** Service name. */
  serviceName: string;

  /** Criticality tier of the service. */
  criticalityTier: CriticalityTier;

  /** RTO target in minutes. */
  rtoMinutes: number;

  /** RPO target in minutes. */
  rpoMinutes: number;

  /** Ordered recovery steps. */
  steps: RunbookStep[];

  /** Total estimated recovery time in minutes. */
  estimatedRecoveryMinutes: number;

  /** Prerequisites for runbook execution. */
  prerequisites: string[];

  /** Escalation contacts by role. */
  escalationContacts: EscalationContact[];

  /** Date of last test. */
  lastTestDate?: ISO8601;

  /** Test result. */
  lastTestStatus: RunbookTestStatus;

  /** Frequency of testing. */
  testFrequency: ReviewFrequency;

  /** Next scheduled test date. */
  nextTestDate?: ISO8601;

  /** Version of the runbook. */
  version: string;

  /** Last updated date. */
  lastUpdatedDate: ISO8601;
}

/** Escalation contact for runbook execution. */
export interface EscalationContact {
  /** Contact role (e.g., "On-Call SRE", "Service Owner"). */
  role: string;

  /** Contact identifier (team/individual). */
  contactId: string;

  /** Escalation level (1 = first responder, 2 = manager, etc.). */
  escalationLevel: number;
}

// ─── Compliance Validation ──────────────────────────────────────────────────

/** Result of DORA compliance validation. */
export interface DoraComplianceResult {
  /** Overall compliance status. */
  compliant: boolean;

  /** Timestamp of validation. */
  validatedAt: ISO8601;

  /** Per-requirement compliance details. */
  requirements: DoraRequirementResult[];

  /** Summary of non-compliant findings. */
  findings: ComplianceFinding[];
}

/** Result for a single DORA requirement check. */
export interface DoraRequirementResult {
  /** Requirement reference (e.g., "30.1", "30.2"). */
  requirementId: string;

  /** Whether this requirement is satisfied. */
  compliant: boolean;

  /** Details about compliance status. */
  details: string;
}

/** A compliance finding (non-compliance issue). */
export interface ComplianceFinding {
  /** Severity of the finding. */
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  /** Requirement reference. */
  requirementId: string;

  /** Description of the finding. */
  description: string;

  /** Recommended remediation. */
  remediation: string;

  /** Service(s) affected. */
  affectedServices: string[];
}
