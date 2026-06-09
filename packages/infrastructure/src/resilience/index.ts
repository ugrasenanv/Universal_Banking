/**
 * Multi-Region Resilience and Auto-Scaling module.
 *
 * Provides:
 * - Active-active / active-passive deployment topology management
 * - Regional failover with RTO/RPO compliance
 * - GPU pod auto-scaling based on queue depth, utilisation, and throughput
 * - Pre-warming for predictable traffic peaks
 * - Latency-aware traffic routing
 */

export type {
  DeploymentMode,
  ServiceType,
  RegionHealth,
  RegionRole,
  RegionConfig,
  DeploymentTopology,
  ServiceDeployment,
  DataClass,
  RecoveryTarget,
  FailoverResult,
  GpuScalingMetrics,
  GpuScalingConfig,
  ScalingDecision,
  ScalingReason,
  ScheduledPeak,
  PreWarmResult,
  TrafficRoutingDecision,
  TrafficRoutingRequest,
  RoutingReason,
} from './types.js';

export { DEFAULT_RECOVERY_TARGETS, DEFAULT_GPU_SCALING_CONFIG } from './types.js';

export { MultiRegionResilienceService, getDeploymentMode } from './multi-region-resilience-service.js';
