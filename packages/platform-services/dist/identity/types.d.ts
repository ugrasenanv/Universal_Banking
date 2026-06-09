/**
 * Identity Service Types
 *
 * Types for the Identity Service supporting federated authentication (OIDC, SAML, FAPI 2.0),
 * RBAC + ABAC access control, session management, and Strong Customer Authentication.
 *
 * Requirements: 17.1, 17.4, 17.5
 */
import type { Jurisdiction, ISO8601 } from '@afg/shared-types';
/** Supported authentication protocols. */
export type AuthProtocol = 'OIDC' | 'SAML' | 'FAPI_2_0';
/** Strong Customer Authentication methods (PSD2-grade). */
export type SCAMethod = 'BIOMETRIC' | 'OTP' | 'HARDWARE_TOKEN';
/** Session configuration enforcing inactivity timeout and max session duration. */
export interface SessionConfig {
    /** Maximum inactivity period before session expiry (minutes). */
    maxInactivityMinutes: 15;
    /** Maximum total session duration before forced re-authentication (hours). */
    maxSessionHours: 4;
}
/** Defines an authentication flow including protocol, SCA requirements, and session limits. */
export interface AuthenticationFlow {
    protocol: AuthProtocol;
    scaRequired: boolean;
    scaMethod?: SCAMethod;
    sessionConfig: SessionConfig;
}
/** Represents an authentication request from a user or service. */
export interface AuthenticationRequest {
    /** Unique request identifier. */
    requestId: string;
    /** Protocol to use for this authentication attempt. */
    protocol: AuthProtocol;
    /** User or service principal identifier. */
    principalId: string;
    /** Credentials payload (token, assertion, etc.). */
    credentials: AuthCredentials;
    /** Whether SCA is required for this flow (e.g. payment transactions). */
    scaRequired: boolean;
    /** SCA method preference if SCA is required. */
    scaMethod?: SCAMethod;
    /** Jurisdiction for data residency compliance. */
    jurisdiction: Jurisdiction;
}
/** Authentication credentials supporting multiple protocol types. */
export type AuthCredentials = {
    type: 'OIDC_TOKEN';
    idToken: string;
    accessToken: string;
} | {
    type: 'SAML_ASSERTION';
    assertion: string;
} | {
    type: 'FAPI_TOKEN';
    accessToken: string;
    dpopProof: string;
};
/** Result of an authentication attempt. */
export interface AuthenticationResult {
    /** Whether authentication succeeded. */
    authenticated: boolean;
    /** Session token if successful. */
    sessionToken?: string;
    /** Session metadata. */
    session?: Session;
    /** Error details if failed. */
    error?: AuthenticationError;
    /** Whether SCA was completed. */
    scaCompleted: boolean;
}
/** Authentication error details. */
export interface AuthenticationError {
    code: 'INVALID_CREDENTIALS' | 'EXPIRED_TOKEN' | 'SCA_REQUIRED' | 'SCA_FAILED' | 'PROTOCOL_ERROR' | 'SESSION_LIMIT_EXCEEDED';
    message: string;
}
/** Represents an active authenticated session. */
export interface Session {
    /** Unique session identifier. */
    sessionId: string;
    /** Authenticated principal. */
    principalId: string;
    /** Protocol used for authentication. */
    protocol: AuthProtocol;
    /** When session was created. */
    createdAt: ISO8601;
    /** Last activity timestamp. */
    lastActivityAt: ISO8601;
    /** When session expires (max session duration). */
    expiresAt: ISO8601;
    /** Whether SCA was performed. */
    scaCompleted: boolean;
    /** SCA method used. */
    scaMethod?: SCAMethod;
    /** Jurisdiction of the session. */
    jurisdiction: Jurisdiction;
    /** Whether the session is currently valid. */
    active: boolean;
}
/** Role for RBAC enforcement. */
export interface Role {
    /** Unique role identifier. */
    roleId: string;
    /** Display name. */
    name: string;
    /** Permissions granted by this role. */
    permissions: Permission[];
}
/** A permission granting access to a specific resource and action. */
export interface Permission {
    /** Resource identifier (e.g. 'model', 'audit-artefact', 'customer-data'). */
    resource: string;
    /** Allowed actions on the resource. */
    actions: ('read' | 'write' | 'execute' | 'approve' | 'deploy')[];
}
/** Attribute-based access condition for ABAC enforcement. */
export interface AttributeCondition {
    /** Attribute to evaluate (e.g. 'jurisdiction', 'department', 'clearance'). */
    attribute: string;
    /** Comparison operator. */
    operator: 'eq' | 'neq' | 'in' | 'not_in' | 'gte' | 'lte';
    /** Expected value(s). */
    value: string | string[] | number;
}
/** Segregation of duty rule preventing conflicting role combinations. */
export interface SegregationRule {
    /** Rule identifier. */
    ruleId: string;
    /** Description of what this rule enforces. */
    description: string;
    /** Roles that cannot be held simultaneously by the same principal. */
    conflictingRoles: [string, string];
}
/** Complete access policy combining RBAC, ABAC, and segregation of duty. */
export interface AccessPolicy {
    rbac: Role[];
    abac: AttributeCondition[];
    segregationOfDuty: SegregationRule[];
    leastPrivilege: true;
}
/** Request to evaluate access for a principal. */
export interface AccessRequest {
    /** Principal requesting access. */
    principalId: string;
    /** Roles assigned to the principal. */
    assignedRoles: string[];
    /** Principal attributes for ABAC evaluation. */
    attributes: Record<string, string | number | string[]>;
    /** Resource being accessed. */
    resource: string;
    /** Action being attempted. */
    action: 'read' | 'write' | 'execute' | 'approve' | 'deploy';
}
/** Result of an access evaluation. */
export interface AccessDecision {
    /** Whether access is granted. */
    granted: boolean;
    /** Reason for denial if not granted. */
    denialReason?: 'INSUFFICIENT_PERMISSIONS' | 'ABAC_CONDITION_FAILED' | 'SEGREGATION_OF_DUTY_VIOLATION' | 'SESSION_EXPIRED';
    /** Which policy element caused the denial. */
    deniedBy?: string;
}
//# sourceMappingURL=types.d.ts.map