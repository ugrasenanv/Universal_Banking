"use strict";
/**
 * @afg/shared-types
 *
 * Shared domain types and interfaces for the AFG Enterprise AI/ML Banking Platform.
 * All types use open-standards-based interfaces (Requirement 22.1).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNextDegradationTier = exports.DEFAULT_CIRCUIT_BREAKER_CONFIG = exports.DEGRADATION_ORDER = exports.computeRetentionExpiry = exports.verifyIntegrity = exports.computeIntegrityHash = void 0;
var audit_js_1 = require("./audit.js");
Object.defineProperty(exports, "computeIntegrityHash", { enumerable: true, get: function () { return audit_js_1.computeIntegrityHash; } });
Object.defineProperty(exports, "verifyIntegrity", { enumerable: true, get: function () { return audit_js_1.verifyIntegrity; } });
Object.defineProperty(exports, "computeRetentionExpiry", { enumerable: true, get: function () { return audit_js_1.computeRetentionExpiry; } });
var circuit_breaker_js_1 = require("./circuit-breaker.js");
Object.defineProperty(exports, "DEGRADATION_ORDER", { enumerable: true, get: function () { return circuit_breaker_js_1.DEGRADATION_ORDER; } });
Object.defineProperty(exports, "DEFAULT_CIRCUIT_BREAKER_CONFIG", { enumerable: true, get: function () { return circuit_breaker_js_1.DEFAULT_CIRCUIT_BREAKER_CONFIG; } });
Object.defineProperty(exports, "getNextDegradationTier", { enumerable: true, get: function () { return circuit_breaker_js_1.getNextDegradationTier; } });
//# sourceMappingURL=index.js.map