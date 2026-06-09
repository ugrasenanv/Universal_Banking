"use strict";
/**
 * Audit Service module.
 *
 * Provides immutable, append-only audit storage with cryptographic
 * integrity verification for all AI/ML platform decisions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IcebergAuditStore = exports.AuditService = void 0;
var audit_service_js_1 = require("./audit-service.js");
Object.defineProperty(exports, "AuditService", { enumerable: true, get: function () { return audit_service_js_1.AuditService; } });
var iceberg_store_js_1 = require("./iceberg-store.js");
Object.defineProperty(exports, "IcebergAuditStore", { enumerable: true, get: function () { return iceberg_store_js_1.IcebergAuditStore; } });
//# sourceMappingURL=index.js.map