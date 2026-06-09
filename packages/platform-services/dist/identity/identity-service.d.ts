/**
 * Identity Service
 *
 * Provides federated identity management with OIDC, SAML, and FAPI 2.0 authentication,
 * RBAC + ABAC access policy enforcement, session management with configurable timeouts,
 * and Strong Customer Authentication (SCA) for PSD2/FAPI compliance.
 *
 * Requirements: 17.1, 17.4, 17.5
 */
import type { ISO8601 } from '@afg/shared-types';
import type { AuthenticationFlow, AuthenticationRequest, AuthenticationResult, AuthProtocol, SCAMethod, Session, SessionConfig, AccessPolicy, AccessRequest, AccessDecision } from './types.js';
/** Configuration for the Identity Service. */
export interface IdentityServiceConfig {
    /** Access policies to enforce. */
    accessPolicy: AccessPolicy;
    /** Session configuration. */
    sessionConfig?: SessionConfig;
}
/**
 * IdentityService manages authentication flows, session lifecycle, and access control.
 *
 * Key design decisions:
 * - Sessions enforce 15-minute inactivity timeout and 4-hour maximum duration (Req 17.5)
 * - SCA is mandatory for payment flows and FAPI 2.0 (Req 17.4)
 * - Segregation of duty prevents model-deployer from also being model-approver (Req 17.5)
 * - Least-privilege defaults with just-in-time elevation (Req 17.5)
 */
export declare class IdentityService {
    private readonly accessPolicy;
    private readonly sessionConfig;
    private readonly sessions;
    constructor(config: IdentityServiceConfig);
    /**
     * Authenticate a principal using the specified protocol.
     * Validates credentials, enforces SCA if required, and creates a session.
     */
    authenticate(request: AuthenticationRequest): AuthenticationResult;
    /**
     * Get the supported authentication flow configuration for a protocol.
     */
    getAuthenticationFlow(protocol: AuthProtocol, scaRequired: boolean, scaMethod?: SCAMethod): AuthenticationFlow;
    /**
     * Select the appropriate SCA method based on context.
     * Priority: BIOMETRIC > HARDWARE_TOKEN > OTP (strongest to weakest).
     */
    selectSCAMethod(availableMethods: SCAMethod[], preferredMethod?: SCAMethod): SCAMethod;
    /**
     * Validate a session, checking both inactivity timeout and max session duration.
     * Returns the session if valid, null if expired or not found.
     */
    validateSession(sessionId: string, currentTime?: ISO8601): Session | null;
    /**
     * Invalidate/terminate a session.
     */
    invalidateSession(sessionId: string): boolean;
    /**
     * Touch a session to update last activity time (keep alive).
     */
    touchSession(sessionId: string, currentTime?: ISO8601): boolean;
    /**
     * Get session by ID.
     */
    getSession(sessionId: string): Session | null;
    /**
     * Evaluate an access request against the configured access policy.
     * Enforces RBAC permissions, ABAC conditions, and segregation of duty rules.
     */
    evaluateAccess(request: AccessRequest): AccessDecision;
    private validateCredentials;
    private performSCA;
    private createSession;
    private generateSessionId;
    private checkSegregationOfDuty;
    private checkRBACPermission;
    private checkABACConditions;
    private evaluateCondition;
}
//# sourceMappingURL=identity-service.d.ts.map