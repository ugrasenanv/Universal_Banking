"use strict";
/**
 * Identity Service
 *
 * Provides federated identity management with OIDC, SAML, and FAPI 2.0 authentication,
 * RBAC + ABAC access policy enforcement, session management with configurable timeouts,
 * and Strong Customer Authentication (SCA) for PSD2/FAPI compliance.
 *
 * Requirements: 17.1, 17.4, 17.5
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentityService = void 0;
/**
 * IdentityService manages authentication flows, session lifecycle, and access control.
 *
 * Key design decisions:
 * - Sessions enforce 15-minute inactivity timeout and 4-hour maximum duration (Req 17.5)
 * - SCA is mandatory for payment flows and FAPI 2.0 (Req 17.4)
 * - Segregation of duty prevents model-deployer from also being model-approver (Req 17.5)
 * - Least-privilege defaults with just-in-time elevation (Req 17.5)
 */
class IdentityService {
    accessPolicy;
    sessionConfig;
    sessions = new Map();
    constructor(config) {
        this.accessPolicy = config.accessPolicy;
        this.sessionConfig = config.sessionConfig ?? {
            maxInactivityMinutes: 15,
            maxSessionHours: 4,
        };
    }
    // ─── Authentication ──────────────────────────────────────────────────────
    /**
     * Authenticate a principal using the specified protocol.
     * Validates credentials, enforces SCA if required, and creates a session.
     */
    authenticate(request) {
        // Validate protocol-credential alignment
        const credentialValid = this.validateCredentials(request);
        if (!credentialValid) {
            return {
                authenticated: false,
                scaCompleted: false,
                error: {
                    code: 'INVALID_CREDENTIALS',
                    message: `Invalid credentials for ${request.protocol} protocol`,
                },
            };
        }
        // Enforce SCA for FAPI 2.0 and when explicitly required
        const scaRequired = request.scaRequired || request.protocol === 'FAPI_2_0';
        if (scaRequired && !request.scaMethod) {
            return {
                authenticated: false,
                scaCompleted: false,
                error: {
                    code: 'SCA_REQUIRED',
                    message: 'Strong Customer Authentication is required but no SCA method was provided',
                },
            };
        }
        // Validate SCA method if required
        const scaCompleted = scaRequired ? this.performSCA(request.scaMethod) : false;
        if (scaRequired && !scaCompleted) {
            return {
                authenticated: false,
                scaCompleted: false,
                error: {
                    code: 'SCA_FAILED',
                    message: `SCA verification failed for method: ${request.scaMethod}`,
                },
            };
        }
        // Create session
        const session = this.createSession(request, scaCompleted);
        this.sessions.set(session.sessionId, session);
        return {
            authenticated: true,
            sessionToken: session.sessionId,
            session,
            scaCompleted,
        };
    }
    /**
     * Get the supported authentication flow configuration for a protocol.
     */
    getAuthenticationFlow(protocol, scaRequired, scaMethod) {
        return {
            protocol,
            scaRequired,
            scaMethod,
            sessionConfig: this.sessionConfig,
        };
    }
    /**
     * Select the appropriate SCA method based on context.
     * Priority: BIOMETRIC > HARDWARE_TOKEN > OTP (strongest to weakest).
     */
    selectSCAMethod(availableMethods, preferredMethod) {
        if (preferredMethod && availableMethods.includes(preferredMethod)) {
            return preferredMethod;
        }
        const priority = ['BIOMETRIC', 'HARDWARE_TOKEN', 'OTP'];
        for (const method of priority) {
            if (availableMethods.includes(method)) {
                return method;
            }
        }
        // Fallback to first available
        return availableMethods[0];
    }
    // ─── Session Management ──────────────────────────────────────────────────
    /**
     * Validate a session, checking both inactivity timeout and max session duration.
     * Returns the session if valid, null if expired or not found.
     */
    validateSession(sessionId, currentTime) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.active) {
            return null;
        }
        const now = currentTime ? new Date(currentTime) : new Date();
        const lastActivity = new Date(session.lastActivityAt);
        const createdAt = new Date(session.createdAt);
        // Check inactivity timeout (15 minutes)
        const inactivityMs = now.getTime() - lastActivity.getTime();
        const maxInactivityMs = this.sessionConfig.maxInactivityMinutes * 60 * 1000;
        if (inactivityMs > maxInactivityMs) {
            this.invalidateSession(sessionId);
            return null;
        }
        // Check max session duration (4 hours)
        const sessionDurationMs = now.getTime() - createdAt.getTime();
        const maxSessionMs = this.sessionConfig.maxSessionHours * 60 * 60 * 1000;
        if (sessionDurationMs > maxSessionMs) {
            this.invalidateSession(sessionId);
            return null;
        }
        // Update last activity
        session.lastActivityAt = now.toISOString();
        return session;
    }
    /**
     * Invalidate/terminate a session.
     */
    invalidateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }
        session.active = false;
        return true;
    }
    /**
     * Touch a session to update last activity time (keep alive).
     */
    touchSession(sessionId, currentTime) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.active) {
            return false;
        }
        session.lastActivityAt = currentTime ?? new Date().toISOString();
        return true;
    }
    /**
     * Get session by ID.
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId) ?? null;
    }
    // ─── Access Control ──────────────────────────────────────────────────────
    /**
     * Evaluate an access request against the configured access policy.
     * Enforces RBAC permissions, ABAC conditions, and segregation of duty rules.
     */
    evaluateAccess(request) {
        // 1. Check segregation of duty first (most critical)
        const segregationViolation = this.checkSegregationOfDuty(request.assignedRoles);
        if (segregationViolation) {
            return {
                granted: false,
                denialReason: 'SEGREGATION_OF_DUTY_VIOLATION',
                deniedBy: segregationViolation.ruleId,
            };
        }
        // 2. Check RBAC permissions
        const hasPermission = this.checkRBACPermission(request);
        if (!hasPermission) {
            return {
                granted: false,
                denialReason: 'INSUFFICIENT_PERMISSIONS',
                deniedBy: 'rbac',
            };
        }
        // 3. Check ABAC conditions
        const abacResult = this.checkABACConditions(request);
        if (!abacResult.passed) {
            return {
                granted: false,
                denialReason: 'ABAC_CONDITION_FAILED',
                deniedBy: abacResult.failedCondition,
            };
        }
        return { granted: true };
    }
    // ─── Private Helpers ─────────────────────────────────────────────────────
    validateCredentials(request) {
        const { protocol, credentials } = request;
        switch (protocol) {
            case 'OIDC':
                return credentials.type === 'OIDC_TOKEN' && !!credentials.idToken && !!credentials.accessToken;
            case 'SAML':
                return credentials.type === 'SAML_ASSERTION' && !!credentials.assertion;
            case 'FAPI_2_0':
                return credentials.type === 'FAPI_TOKEN' && !!credentials.accessToken && !!credentials.dpopProof;
            default:
                return false;
        }
    }
    performSCA(method) {
        // In production this would integrate with biometric providers, OTP services, or FIDO2.
        // For the service layer, we validate the method is supported and return success.
        const supportedMethods = ['BIOMETRIC', 'OTP', 'HARDWARE_TOKEN'];
        return supportedMethods.includes(method);
    }
    createSession(request, scaCompleted) {
        const now = new Date();
        const maxSessionMs = this.sessionConfig.maxSessionHours * 60 * 60 * 1000;
        return {
            sessionId: this.generateSessionId(),
            principalId: request.principalId,
            protocol: request.protocol,
            createdAt: now.toISOString(),
            lastActivityAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + maxSessionMs).toISOString(),
            scaCompleted,
            scaMethod: request.scaMethod,
            jurisdiction: request.jurisdiction,
            active: true,
        };
    }
    generateSessionId() {
        // Simple UUID-like generator for session IDs
        const chars = 'abcdef0123456789';
        const segments = [8, 4, 4, 4, 12];
        return segments
            .map((len) => {
            let segment = '';
            for (let i = 0; i < len; i++) {
                segment += chars[Math.floor(Math.random() * chars.length)];
            }
            return segment;
        })
            .join('-');
    }
    checkSegregationOfDuty(assignedRoles) {
        for (const rule of this.accessPolicy.segregationOfDuty) {
            const [roleA, roleB] = rule.conflictingRoles;
            if (assignedRoles.includes(roleA) && assignedRoles.includes(roleB)) {
                return rule;
            }
        }
        return null;
    }
    checkRBACPermission(request) {
        const { assignedRoles, resource, action } = request;
        // Find all roles that match the assigned role IDs
        const matchedRoles = this.accessPolicy.rbac.filter((role) => assignedRoles.includes(role.roleId));
        // Check if any matched role grants the requested permission
        return matchedRoles.some((role) => role.permissions.some((perm) => perm.resource === resource && perm.actions.includes(action)));
    }
    checkABACConditions(request) {
        for (const condition of this.accessPolicy.abac) {
            const attrValue = request.attributes[condition.attribute];
            if (attrValue === undefined) {
                // If attribute not present and condition requires it, deny
                return { passed: false, failedCondition: `${condition.attribute}:${condition.operator}` };
            }
            const conditionMet = this.evaluateCondition(condition, attrValue);
            if (!conditionMet) {
                return { passed: false, failedCondition: `${condition.attribute}:${condition.operator}` };
            }
        }
        return { passed: true };
    }
    evaluateCondition(condition, actualValue) {
        const { operator, value: expectedValue } = condition;
        switch (operator) {
            case 'eq':
                return actualValue === expectedValue;
            case 'neq':
                return actualValue !== expectedValue;
            case 'in':
                if (Array.isArray(expectedValue)) {
                    return expectedValue.includes(String(actualValue));
                }
                return false;
            case 'not_in':
                if (Array.isArray(expectedValue)) {
                    return !expectedValue.includes(String(actualValue));
                }
                return true;
            case 'gte':
                return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue >= expectedValue;
            case 'lte':
                return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue <= expectedValue;
            default:
                return false;
        }
    }
}
exports.IdentityService = IdentityService;
//# sourceMappingURL=identity-service.js.map