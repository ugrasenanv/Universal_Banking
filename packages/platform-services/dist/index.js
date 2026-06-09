"use strict";
/**
 * @afg/platform-services
 *
 * Platform infrastructure services including Identity, Streaming Backbone,
 * Feature Store, Audit Service, Guardrails Engine, and LLM Gateway.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IcebergAuditStore = exports.AuditService = exports.IdentityService = void 0;
// Identity Service
var index_js_1 = require("./identity/index.js");
Object.defineProperty(exports, "IdentityService", { enumerable: true, get: function () { return index_js_1.IdentityService; } });
// Audit Service
var index_js_2 = require("./audit/index.js");
Object.defineProperty(exports, "AuditService", { enumerable: true, get: function () { return index_js_2.AuditService; } });
Object.defineProperty(exports, "IcebergAuditStore", { enumerable: true, get: function () { return index_js_2.IcebergAuditStore; } });
//# sourceMappingURL=index.js.map