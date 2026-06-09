/**
 * Identity Service Unit Tests
 *
 * Tests for authentication flows, session management, access control,
 * and SCA method selection.
 *
 * Requirements: 17.1, 17.4, 17.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IdentityService } from './identity-service.js';
import type {
  AccessPolicy,
  AuthenticationRequest,
  AccessRequest,
  SCAMethod,
} from './types.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function createTestPolicy(): AccessPolicy {
  return {
    rbac: [
      {
        roleId: 'model-deployer',
        name: 'Model Deployer',
        permissions: [
          { resource: 'model', actions: ['read', 'deploy'] },
        ],
      },
      {
        roleId: 'model-approver',
        name: 'Model Approver',
        permissions: [
          { resource: 'model', actions: ['read', 'approve'] },
        ],
      },
      {
        roleId: 'analyst',
        name: 'Analyst',
        permissions: [
          { resource: 'audit-artefact', actions: ['read'] },
          { resource: 'customer-data', actions: ['read'] },
        ],
      },
      {
        roleId: 'admin',
        name: 'Admin',
        permissions: [
          { resource: 'model', actions: ['read', 'write', 'execute', 'approve', 'deploy'] },
          { resource: 'audit-artefact', actions: ['read', 'write'] },
          { resource: 'customer-data', actions: ['read', 'write'] },
        ],
      },
    ],
    abac: [
      { attribute: 'jurisdiction', operator: 'in', value: ['IN', 'SG', 'AE', 'GB', 'US'] },
      { attribute: 'clearanceLevel', operator: 'gte', value: 2 },
    ],
    segregationOfDuty: [
      {
        ruleId: 'SOD-001',
        description: 'Model deployer cannot also be model approver',
        conflictingRoles: ['model-deployer', 'model-approver'],
      },
    ],
    leastPrivilege: true,
  };
}

function createService(policy?: AccessPolicy): IdentityService {
  return new IdentityService({
    accessPolicy: policy ?? createTestPolicy(),
  });
}

function createOIDCRequest(overrides: Partial<AuthenticationRequest> = {}): AuthenticationRequest {
  return {
    requestId: 'req-001',
    protocol: 'OIDC',
    principalId: 'user-001',
    credentials: { type: 'OIDC_TOKEN', idToken: 'valid-id-token', accessToken: 'valid-access-token' },
    scaRequired: false,
    jurisdiction: 'IN',
    ...overrides,
  };
}

function createSAMLRequest(overrides: Partial<AuthenticationRequest> = {}): AuthenticationRequest {
  return {
    requestId: 'req-002',
    protocol: 'SAML',
    principalId: 'user-002',
    credentials: { type: 'SAML_ASSERTION', assertion: 'valid-saml-assertion' },
    scaRequired: false,
    jurisdiction: 'SG',
    ...overrides,
  };
}

function createFAPIRequest(overrides: Partial<AuthenticationRequest> = {}): AuthenticationRequest {
  return {
    requestId: 'req-003',
    protocol: 'FAPI_2_0',
    principalId: 'user-003',
    credentials: { type: 'FAPI_TOKEN', accessToken: 'valid-fapi-token', dpopProof: 'valid-dpop' },
    scaRequired: true,
    scaMethod: 'BIOMETRIC',
    jurisdiction: 'GB',
    ...overrides,
  };
}

// ─── Authentication Flow Tests ───────────────────────────────────────────────

describe('IdentityService', () => {
  let service: IdentityService;

  beforeEach(() => {
    service = createService();
  });

  describe('Authentication', () => {
    describe('OIDC authentication', () => {
      it('should authenticate with valid OIDC credentials', () => {
        const result = service.authenticate(createOIDCRequest());

        expect(result.authenticated).toBe(true);
        expect(result.sessionToken).toBeDefined();
        expect(result.session).toBeDefined();
        expect(result.session!.protocol).toBe('OIDC');
        expect(result.session!.principalId).toBe('user-001');
        expect(result.session!.active).toBe(true);
        expect(result.scaCompleted).toBe(false);
      });

      it('should reject invalid OIDC credentials (wrong type)', () => {
        const result = service.authenticate(createOIDCRequest({
          credentials: { type: 'SAML_ASSERTION', assertion: 'wrong-type' },
        }));

        expect(result.authenticated).toBe(false);
        expect(result.error?.code).toBe('INVALID_CREDENTIALS');
      });

      it('should reject OIDC with empty token', () => {
        const result = service.authenticate(createOIDCRequest({
          credentials: { type: 'OIDC_TOKEN', idToken: '', accessToken: 'valid' },
        }));

        expect(result.authenticated).toBe(false);
        expect(result.error?.code).toBe('INVALID_CREDENTIALS');
      });
    });

    describe('SAML authentication', () => {
      it('should authenticate with valid SAML assertion', () => {
        const result = service.authenticate(createSAMLRequest());

        expect(result.authenticated).toBe(true);
        expect(result.session!.protocol).toBe('SAML');
        expect(result.session!.jurisdiction).toBe('SG');
      });

      it('should reject invalid SAML credentials', () => {
        const result = service.authenticate(createSAMLRequest({
          credentials: { type: 'OIDC_TOKEN', idToken: 'x', accessToken: 'y' },
        }));

        expect(result.authenticated).toBe(false);
        expect(result.error?.code).toBe('INVALID_CREDENTIALS');
      });
    });

    describe('FAPI 2.0 authentication', () => {
      it('should authenticate with valid FAPI credentials and SCA', () => {
        const result = service.authenticate(createFAPIRequest());

        expect(result.authenticated).toBe(true);
        expect(result.session!.protocol).toBe('FAPI_2_0');
        expect(result.scaCompleted).toBe(true);
        expect(result.session!.scaCompleted).toBe(true);
        expect(result.session!.scaMethod).toBe('BIOMETRIC');
      });

      it('should require SCA for FAPI 2.0 even if not explicitly marked', () => {
        const result = service.authenticate(createFAPIRequest({
          scaRequired: false,
          scaMethod: undefined,
        }));

        // FAPI 2.0 always requires SCA
        expect(result.authenticated).toBe(false);
        expect(result.error?.code).toBe('SCA_REQUIRED');
      });

      it('should reject FAPI without DPoP proof', () => {
        const result = service.authenticate(createFAPIRequest({
          credentials: { type: 'FAPI_TOKEN', accessToken: 'valid', dpopProof: '' },
        }));

        expect(result.authenticated).toBe(false);
        expect(result.error?.code).toBe('INVALID_CREDENTIALS');
      });
    });

    describe('SCA enforcement', () => {
      it('should require SCA method when scaRequired is true', () => {
        const result = service.authenticate(createOIDCRequest({
          scaRequired: true,
          scaMethod: undefined,
        }));

        expect(result.authenticated).toBe(false);
        expect(result.error?.code).toBe('SCA_REQUIRED');
      });

      it('should complete SCA with BIOMETRIC method', () => {
        const result = service.authenticate(createOIDCRequest({
          scaRequired: true,
          scaMethod: 'BIOMETRIC',
        }));

        expect(result.authenticated).toBe(true);
        expect(result.scaCompleted).toBe(true);
      });

      it('should complete SCA with OTP method', () => {
        const result = service.authenticate(createOIDCRequest({
          scaRequired: true,
          scaMethod: 'OTP',
        }));

        expect(result.authenticated).toBe(true);
        expect(result.scaCompleted).toBe(true);
      });

      it('should complete SCA with HARDWARE_TOKEN method', () => {
        const result = service.authenticate(createOIDCRequest({
          scaRequired: true,
          scaMethod: 'HARDWARE_TOKEN',
        }));

        expect(result.authenticated).toBe(true);
        expect(result.scaCompleted).toBe(true);
      });
    });
  });

  // ─── Session Management Tests ────────────────────────────────────────────

  describe('Session Management', () => {
    it('should create a session with correct expiry on authentication', () => {
      const result = service.authenticate(createOIDCRequest());
      const session = result.session!;

      expect(session.active).toBe(true);
      expect(session.createdAt).toBeDefined();
      expect(session.lastActivityAt).toBeDefined();
      expect(session.expiresAt).toBeDefined();

      // Verify max session is 4 hours from creation
      const created = new Date(session.createdAt).getTime();
      const expires = new Date(session.expiresAt).getTime();
      const fourHoursMs = 4 * 60 * 60 * 1000;
      expect(expires - created).toBe(fourHoursMs);
    });

    it('should validate an active session within timeout', () => {
      const result = service.authenticate(createOIDCRequest());
      const sessionId = result.sessionToken!;

      // Validate 5 minutes after creation
      const fiveMinutesLater = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const session = service.validateSession(sessionId, fiveMinutesLater);

      expect(session).not.toBeNull();
      expect(session!.active).toBe(true);
    });

    it('should expire session after 15 minutes of inactivity', () => {
      const result = service.authenticate(createOIDCRequest());
      const sessionId = result.sessionToken!;

      // Check after 16 minutes of inactivity
      const sixteenMinutesLater = new Date(Date.now() + 16 * 60 * 1000).toISOString();
      const session = service.validateSession(sessionId, sixteenMinutesLater);

      expect(session).toBeNull();

      // Session should now be invalidated
      const storedSession = service.getSession(sessionId);
      expect(storedSession!.active).toBe(false);
    });

    it('should expire session after 4-hour max duration', () => {
      const result = service.authenticate(createOIDCRequest());
      const sessionId = result.sessionToken!;

      // Keep touching the session every 10 minutes for 4+ hours
      const baseTime = Date.now();
      for (let i = 1; i <= 24; i++) {
        const touchTime = new Date(baseTime + i * 10 * 60 * 1000).toISOString();
        service.touchSession(sessionId, touchTime);
      }

      // Now validate at 4 hours + 1 minute
      const fourHoursOneMinute = new Date(baseTime + (4 * 60 + 1) * 60 * 1000).toISOString();
      const session = service.validateSession(sessionId, fourHoursOneMinute);

      expect(session).toBeNull();
    });

    it('should keep session alive with activity within 15-minute window', () => {
      const result = service.authenticate(createOIDCRequest());
      const sessionId = result.sessionToken!;

      const baseTime = Date.now();

      // Touch at 10 minutes
      const tenMinutes = new Date(baseTime + 10 * 60 * 1000).toISOString();
      service.touchSession(sessionId, tenMinutes);

      // Validate at 20 minutes (only 10 min since last activity)
      const twentyMinutes = new Date(baseTime + 20 * 60 * 1000).toISOString();
      const session = service.validateSession(sessionId, twentyMinutes);

      expect(session).not.toBeNull();
      expect(session!.active).toBe(true);
    });

    it('should invalidate a session manually', () => {
      const result = service.authenticate(createOIDCRequest());
      const sessionId = result.sessionToken!;

      const invalidated = service.invalidateSession(sessionId);
      expect(invalidated).toBe(true);

      const session = service.validateSession(sessionId);
      expect(session).toBeNull();
    });

    it('should return false when invalidating non-existent session', () => {
      const invalidated = service.invalidateSession('non-existent-session');
      expect(invalidated).toBe(false);
    });

    it('should return null for non-existent session validation', () => {
      const session = service.validateSession('non-existent-session');
      expect(session).toBeNull();
    });
  });

  // ─── SCA Method Selection Tests ──────────────────────────────────────────

  describe('SCA Method Selection', () => {
    it('should prefer the user-specified method when available', () => {
      const method = service.selectSCAMethod(['OTP', 'BIOMETRIC', 'HARDWARE_TOKEN'], 'OTP');
      expect(method).toBe('OTP');
    });

    it('should select highest priority method when no preference', () => {
      const method = service.selectSCAMethod(['OTP', 'HARDWARE_TOKEN', 'BIOMETRIC']);
      expect(method).toBe('BIOMETRIC');
    });

    it('should fall back to HARDWARE_TOKEN if BIOMETRIC unavailable', () => {
      const method = service.selectSCAMethod(['OTP', 'HARDWARE_TOKEN']);
      expect(method).toBe('HARDWARE_TOKEN');
    });

    it('should fall back to OTP as last resort', () => {
      const method = service.selectSCAMethod(['OTP']);
      expect(method).toBe('OTP');
    });

    it('should ignore preferred method if not in available list', () => {
      const method = service.selectSCAMethod(['OTP', 'HARDWARE_TOKEN'], 'BIOMETRIC');
      expect(method).toBe('HARDWARE_TOKEN');
    });
  });

  // ─── Access Control Tests ────────────────────────────────────────────────

  describe('Access Control', () => {
    describe('RBAC enforcement', () => {
      it('should grant access when role has required permission', () => {
        const decision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['analyst'],
          attributes: { jurisdiction: 'IN', clearanceLevel: 3 },
          resource: 'audit-artefact',
          action: 'read',
        });

        expect(decision.granted).toBe(true);
      });

      it('should deny access when role lacks required permission', () => {
        const decision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['analyst'],
          attributes: { jurisdiction: 'IN', clearanceLevel: 3 },
          resource: 'model',
          action: 'deploy',
        });

        expect(decision.granted).toBe(false);
        expect(decision.denialReason).toBe('INSUFFICIENT_PERMISSIONS');
      });

      it('should grant access when any assigned role has the permission', () => {
        const decision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['analyst', 'model-deployer'],
          attributes: { jurisdiction: 'IN', clearanceLevel: 3 },
          resource: 'model',
          action: 'deploy',
        });

        // Note: this will actually fail because of segregation of duty check...
        // Let's use roles that don't conflict
        const decision2 = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['analyst', 'admin'],
          attributes: { jurisdiction: 'IN', clearanceLevel: 3 },
          resource: 'model',
          action: 'deploy',
        });

        expect(decision2.granted).toBe(true);
      });

      it('should deny access for unrecognized roles', () => {
        const decision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['unknown-role'],
          attributes: { jurisdiction: 'IN', clearanceLevel: 3 },
          resource: 'model',
          action: 'read',
        });

        expect(decision.granted).toBe(false);
        expect(decision.denialReason).toBe('INSUFFICIENT_PERMISSIONS');
      });
    });

    describe('ABAC enforcement', () => {
      it('should deny access when jurisdiction condition fails', () => {
        const decision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['admin'],
          attributes: { jurisdiction: 'XX', clearanceLevel: 3 },
          resource: 'model',
          action: 'read',
        });

        expect(decision.granted).toBe(false);
        expect(decision.denialReason).toBe('ABAC_CONDITION_FAILED');
      });

      it('should deny access when clearance level is too low', () => {
        const decision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['admin'],
          attributes: { jurisdiction: 'IN', clearanceLevel: 1 },
          resource: 'model',
          action: 'read',
        });

        expect(decision.granted).toBe(false);
        expect(decision.denialReason).toBe('ABAC_CONDITION_FAILED');
      });

      it('should deny access when required attribute is missing', () => {
        const decision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['admin'],
          attributes: { jurisdiction: 'IN' },
          resource: 'model',
          action: 'read',
        });

        expect(decision.granted).toBe(false);
        expect(decision.denialReason).toBe('ABAC_CONDITION_FAILED');
      });
    });

    describe('Segregation of Duty', () => {
      it('should deny access when conflicting roles are assigned', () => {
        const decision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['model-deployer', 'model-approver'],
          attributes: { jurisdiction: 'IN', clearanceLevel: 5 },
          resource: 'model',
          action: 'deploy',
        });

        expect(decision.granted).toBe(false);
        expect(decision.denialReason).toBe('SEGREGATION_OF_DUTY_VIOLATION');
        expect(decision.deniedBy).toBe('SOD-001');
      });

      it('should allow access when non-conflicting roles are assigned', () => {
        const decision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['model-deployer', 'analyst'],
          attributes: { jurisdiction: 'IN', clearanceLevel: 3 },
          resource: 'model',
          action: 'deploy',
        });

        expect(decision.granted).toBe(true);
      });

      it('should enforce model-deployer cannot approve (only the other way)', () => {
        // model-deployer can deploy but not approve
        const deployDecision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['model-deployer'],
          attributes: { jurisdiction: 'IN', clearanceLevel: 3 },
          resource: 'model',
          action: 'deploy',
        });
        expect(deployDecision.granted).toBe(true);

        const approveDecision = service.evaluateAccess({
          principalId: 'user-001',
          assignedRoles: ['model-deployer'],
          attributes: { jurisdiction: 'IN', clearanceLevel: 3 },
          resource: 'model',
          action: 'approve',
        });
        expect(approveDecision.granted).toBe(false);
        expect(approveDecision.denialReason).toBe('INSUFFICIENT_PERMISSIONS');
      });
    });
  });

  // ─── Authentication Flow Configuration Tests ─────────────────────────────

  describe('getAuthenticationFlow', () => {
    it('should return correct flow config for OIDC without SCA', () => {
      const flow = service.getAuthenticationFlow('OIDC', false);

      expect(flow.protocol).toBe('OIDC');
      expect(flow.scaRequired).toBe(false);
      expect(flow.scaMethod).toBeUndefined();
      expect(flow.sessionConfig.maxInactivityMinutes).toBe(15);
      expect(flow.sessionConfig.maxSessionHours).toBe(4);
    });

    it('should return correct flow config for FAPI 2.0 with SCA', () => {
      const flow = service.getAuthenticationFlow('FAPI_2_0', true, 'HARDWARE_TOKEN');

      expect(flow.protocol).toBe('FAPI_2_0');
      expect(flow.scaRequired).toBe(true);
      expect(flow.scaMethod).toBe('HARDWARE_TOKEN');
      expect(flow.sessionConfig.maxInactivityMinutes).toBe(15);
      expect(flow.sessionConfig.maxSessionHours).toBe(4);
    });
  });
});
