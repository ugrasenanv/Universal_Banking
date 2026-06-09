"use strict";
/**
 * Audit artefact types and integrity utilities.
 *
 * Every customer-impacting AI decision emits an immutable audit artefact
 * before returning a response. Artefacts are retained for 7 years with
 * SHA-256 cryptographic integrity verification.
 *
 * Validates: Requirements 28.1, 28.3
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRetentionExpiry = computeRetentionExpiry;
exports.computeIntegrityHash = computeIntegrityHash;
exports.verifyIntegrity = verifyIntegrity;
const node_crypto_1 = require("node:crypto");
/** Retention period for audit artefacts: 7 years in milliseconds. */
const RETENTION_YEARS = 7;
/**
 * Computes the retention expiry date (7 years from the given timestamp).
 */
function computeRetentionExpiry(creationTimestamp) {
    const date = new Date(creationTimestamp);
    date.setFullYear(date.getFullYear() + RETENTION_YEARS);
    return date.toISOString();
}
/**
 * Computes the SHA-256 integrity hash for an audit artefact.
 *
 * The hash covers all content fields (excluding the integrityHash field itself)
 * to enable tamper detection. Fields are serialised in a deterministic order
 * to ensure reproducible hashes.
 *
 * @param artefact - The audit artefact (integrityHash field is excluded from computation)
 * @returns Hex-encoded SHA-256 hash string
 */
function computeIntegrityHash(artefact) {
    const content = buildHashContent(artefact);
    return (0, node_crypto_1.createHash)('sha256').update(content, 'utf8').digest('hex');
}
/**
 * Verifies the integrity of a stored audit artefact by recomputing
 * the hash and comparing against the stored value.
 *
 * @param artefact - The complete audit artefact with stored integrityHash
 * @returns true if the stored hash matches the recomputed hash
 */
function verifyIntegrity(artefact) {
    const { integrityHash, ...content } = artefact;
    const computedHash = computeIntegrityHash(content);
    return computedHash === integrityHash;
}
/**
 * Builds a deterministic string representation of artefact content
 * for hash computation. Uses sorted JSON keys to ensure reproducibility.
 */
function buildHashContent(artefact) {
    const ordered = {
        artefactId: artefact.artefactId,
        timestamp: artefact.timestamp,
        jurisdiction: artefact.jurisdiction,
        serviceId: artefact.serviceId,
        modelVersion: artefact.modelVersion,
        inputFeatures: artefact.inputFeatures,
        prompt: artefact.prompt ?? null,
        retrievedContext: artefact.retrievedContext ?? null,
        modelOutput: artefact.modelOutput,
        confidenceScore: artefact.confidenceScore,
        decision: artefact.decision,
        humanOverride: artefact.humanOverride ?? null,
        explanation: artefact.explanation ?? null,
        retentionExpiryDate: artefact.retentionExpiryDate,
    };
    return JSON.stringify(ordered, null, 0);
}
//# sourceMappingURL=audit.js.map