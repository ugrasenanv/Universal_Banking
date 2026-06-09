/**
 * @afg/platform-services
 *
 * Platform infrastructure services including Identity, Streaming Backbone,
 * Feature Store, Audit Service, Guardrails Engine, and LLM Gateway.
 */
export { IdentityService } from './identity/index.js';
export type { IdentityServiceConfig, AuthProtocol, SCAMethod, SessionConfig, AuthenticationFlow, AuthenticationRequest, AuthenticationResult, AuthenticationError, AuthCredentials, Session, Role, Permission, AttributeCondition, SegregationRule, AccessPolicy, AccessRequest, AccessDecision, } from './identity/index.js';
export { AuditService, IcebergAuditStore } from './audit/index.js';
export type { AuditArtefactInput, AuditQueryRequest, AuditQueryResponse, AuditStore, IntegrityVerificationResult, PartitionSpec, } from './audit/index.js';
//# sourceMappingURL=index.d.ts.map