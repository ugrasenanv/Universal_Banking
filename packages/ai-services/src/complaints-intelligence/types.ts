/**
 * Complaints Intelligence Service Types
 *
 * Defines all interfaces for complaint classification, routing,
 * structured summary generation, and RBI CMS schema conformance.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import type { ISO8601, Jurisdiction } from '@afg/shared-types';

// ──────────────────────────────────────────────────────────────────────────────
// Complaint Categories (RBI CMS aligned)
// ──────────────────────────────────────────────────────────────────────────────

/** Predefined complaint categories aligned with RBI CMS taxonomy. */
export type ComplaintCategory =
  | 'ACCOUNT_OPERATIONS'
  | 'LOANS_AND_ADVANCES'
  | 'CREDIT_CARDS'
  | 'INTERNET_BANKING'
  | 'MOBILE_BANKING'
  | 'ATM_DEBIT_CARDS'
  | 'REMITTANCES'
  | 'PENSION'
  | 'DEPOSIT_ACCOUNTS'
  | 'PARA_BANKING'
  | 'STAFF_BEHAVIOUR'
  | 'OTHERS';

/** Subcategories for finer-grained classification. */
export type ComplaintSubcategory =
  | 'ACCOUNT_OPENING'
  | 'ACCOUNT_CLOSURE'
  | 'ACCOUNT_MAINTENANCE'
  | 'LOAN_DISBURSEMENT'
  | 'LOAN_RECOVERY'
  | 'INTEREST_RATE'
  | 'EMI_ISSUES'
  | 'BILLING_DISPUTE'
  | 'CARD_BLOCK_UNBLOCK'
  | 'REWARD_POINTS'
  | 'UNAUTHORIZED_TRANSACTION'
  | 'LOGIN_ISSUES'
  | 'TRANSACTION_FAILURE'
  | 'UPI_ISSUES'
  | 'FUND_TRANSFER_DELAY'
  | 'ATM_CASH_NOT_DISPENSED'
  | 'ATM_WRONG_AMOUNT'
  | 'INWARD_REMITTANCE'
  | 'OUTWARD_REMITTANCE'
  | 'PENSION_CREDIT_DELAY'
  | 'FIXED_DEPOSIT'
  | 'RECURRING_DEPOSIT'
  | 'INSURANCE_MISSELLING'
  | 'MUTUAL_FUND_ISSUES'
  | 'RUDE_BEHAVIOUR'
  | 'NON_RESPONSE'
  | 'MISCELLANEOUS';

// ──────────────────────────────────────────────────────────────────────────────
// Resolution Teams
// ──────────────────────────────────────────────────────────────────────────────

/** Resolution team identifiers mapped to complaint categories. */
export type ResolutionTeam =
  | 'BRANCH_OPERATIONS'
  | 'LOAN_SERVICING'
  | 'CARD_OPERATIONS'
  | 'DIGITAL_BANKING'
  | 'PAYMENTS_OPERATIONS'
  | 'ATM_OPERATIONS'
  | 'REMITTANCE_DESK'
  | 'PENSION_CELL'
  | 'DEPOSIT_OPERATIONS'
  | 'THIRD_PARTY_PRODUCTS'
  | 'HR_COMPLIANCE'
  | 'GENERAL_CUSTOMER_SERVICE'
  | 'SENIOR_OFFICER';

/** Mapping from category to resolution team. */
export interface CategoryTeamMapping {
  category: ComplaintCategory;
  team: ResolutionTeam;
}

/** Default category-to-team routing configuration. */
export const DEFAULT_CATEGORY_TEAM_MAP: Record<ComplaintCategory, ResolutionTeam> = {
  ACCOUNT_OPERATIONS: 'BRANCH_OPERATIONS',
  LOANS_AND_ADVANCES: 'LOAN_SERVICING',
  CREDIT_CARDS: 'CARD_OPERATIONS',
  INTERNET_BANKING: 'DIGITAL_BANKING',
  MOBILE_BANKING: 'DIGITAL_BANKING',
  ATM_DEBIT_CARDS: 'ATM_OPERATIONS',
  REMITTANCES: 'REMITTANCE_DESK',
  PENSION: 'PENSION_CELL',
  DEPOSIT_ACCOUNTS: 'DEPOSIT_OPERATIONS',
  PARA_BANKING: 'THIRD_PARTY_PRODUCTS',
  STAFF_BEHAVIOUR: 'HR_COMPLIANCE',
  OTHERS: 'GENERAL_CUSTOMER_SERVICE',
};

// ──────────────────────────────────────────────────────────────────────────────
// Request / Response Types
// ──────────────────────────────────────────────────────────────────────────────

/** Request to classify and route a customer complaint. */
export interface ComplaintClassificationRequest {
  /** Unique complaint identifier. */
  complaintId: string;
  /** Customer who filed the complaint. */
  customerId: string;
  /** Free-text complaint description from the customer. */
  complaintText: string;
  /** Channel through which complaint was received. */
  channel: 'BRANCH' | 'CALL_CENTRE' | 'EMAIL' | 'MOBILE_APP' | 'WEB' | 'LETTER';
  /** Timestamp of complaint receipt. */
  receivedAt: ISO8601;
  /** Jurisdiction for data residency and regulatory context. */
  jurisdiction: Jurisdiction;
  /** Optional: product/service reference. */
  productReference?: string;
  /** Optional: account reference. */
  accountReference?: string;
}

/** Response from complaint classification and routing. */
export interface ComplaintClassificationResponse {
  /** The complaint ID echoed back. */
  complaintId: string;
  /** Assigned complaint category. */
  category: ComplaintCategory;
  /** Assigned subcategory for finer granularity. */
  subcategory: ComplaintSubcategory;
  /** Resolution team the complaint is routed to. */
  routedToTeam: ResolutionTeam;
  /** Confidence of the classification (0.00-1.00). */
  confidence: number;
  /** Whether the complaint was escalated to a senior officer. */
  escalatedToSeniorOfficer: boolean;
  /** Structured summary conforming to RBI CMS schema. */
  structuredSummary: RBICMSComplaintSummary;
  /** Processing latency in milliseconds. */
  processingTimeMs: number;
  /** Audit artefact ID for traceability. */
  auditArtefactId: string;
  /** Whether fallback to manual classification was triggered. */
  fallbackTriggered: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// RBI CMS Schema Types
// ──────────────────────────────────────────────────────────────────────────────

/** Structured complaint summary conforming to RBI CMS and Banking Ombudsman schema. */
export interface RBICMSComplaintSummary {
  /** Complaint reference number. */
  complaintReferenceNumber: string;
  /** Primary complaint category (RBI taxonomy). */
  category: ComplaintCategory;
  /** Subcategory for detailed classification. */
  subcategory: ComplaintSubcategory;
  /** Customer-identified issue summary. */
  customerIssue: string;
  /** Resolution team assignment. */
  resolutionTeam: ResolutionTeam;
  /** Classification confidence score. */
  classificationConfidence: number;
  /** Timestamp of classification. */
  classifiedAt: ISO8601;
  /** Escalation flag for low-confidence or manual routing. */
  escalated: boolean;
  /** Escalation reason (if applicable). */
  escalationReason?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Audit Types
// ──────────────────────────────────────────────────────────────────────────────

/** Audit trail entry for a complaint classification decision. */
export interface ComplaintAuditRecord {
  /** Audit artefact ID. */
  artefactId: string;
  /** Complaint ID. */
  complaintId: string;
  /** Timestamp of classification. */
  timestamp: ISO8601;
  /** Category assigned. */
  categoryAssigned: ComplaintCategory;
  /** Subcategory assigned. */
  subcategoryAssigned: ComplaintSubcategory;
  /** Confidence score. */
  confidenceScore: number;
  /** Classification reasoning/factors. */
  classificationReasoning: string[];
  /** Routing decision (team). */
  routingDecision: ResolutionTeam;
  /** Whether escalated to senior officer. */
  escalated: boolean;
  /** Escalation reason (if applicable). */
  escalationReason?: string;
  /** Resolution outcome (filled post-resolution). */
  resolutionOutcome?: string;
  /** Jurisdiction for data residency. */
  jurisdiction: Jurisdiction;
  /** Service version. */
  serviceVersion: string;
  /** Retention expiry (7 years from creation). */
  retentionExpiry: ISO8601;
  /** Whether fallback was triggered. */
  fallbackTriggered: boolean;
  /** Failure event details (if service was unavailable). */
  failureEvent?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Adapter Interfaces (for dependency injection)
// ──────────────────────────────────────────────────────────────────────────────

/** ML model adapter for complaint classification. */
export interface ComplaintClassificationModelAdapter {
  /** Classify a complaint and return category, subcategory, confidence. */
  classify(request: ComplaintClassificationRequest): Promise<ComplaintClassificationResult>;
}

/** Raw classification result from the ML model. */
export interface ComplaintClassificationResult {
  /** Predicted category. */
  category: ComplaintCategory;
  /** Predicted subcategory. */
  subcategory: ComplaintSubcategory;
  /** Classification confidence (0.00-1.00). */
  confidence: number;
  /** Reasoning factors for the classification. */
  reasoningFactors: string[];
  /** Identified customer issue summary. */
  customerIssueSummary: string;
}

/** Audit emitter for persisting complaint audit records. */
export interface ComplaintAuditEmitter {
  /** Emit an audit record and return its ID. */
  emit(record: Omit<ComplaintAuditRecord, 'artefactId'>): Promise<string>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────

/** Configuration for the Complaints Intelligence Service. */
export interface ComplaintsIntelligenceConfig {
  /** Service identifier for audit trail. */
  serviceId: string;
  /** Service version string. */
  serviceVersion: string;
  /** Confidence threshold below which escalation to senior officer occurs. */
  confidenceThreshold: number;
  /** Maximum classification time in ms before fallback (default: 30000). */
  classificationTimeoutMs: number;
  /** Category-to-team routing map. */
  categoryTeamMap: Record<ComplaintCategory, ResolutionTeam>;
  /** Audit retention period in years. */
  retentionYears: number;
}

/** Default configuration values. */
export const DEFAULT_COMPLAINTS_INTELLIGENCE_CONFIG: ComplaintsIntelligenceConfig = {
  serviceId: 'complaints-intelligence-service',
  serviceVersion: '1.0.0',
  confidenceThreshold: 0.75,
  classificationTimeoutMs: 30_000,
  categoryTeamMap: DEFAULT_CATEGORY_TEAM_MAP,
  retentionYears: 7,
};
