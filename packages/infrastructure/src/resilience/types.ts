/**
 * Types for multi-region resilience and auto-scaling.
 *
 * Covers:
 * - Active-active / active-passive deployment topology (Req 19.3)
 * - Regional failover with RTO/RPO targets (Req 19.4, 19.5)
 * - GPU pod auto-scaling based on queue depth, GPU utilisation, token throughput (Req 20.2)
 * - Pre-warming for predictable peaks (Req 20.2)
 * - Latency-aware traffic routing (Req 20.5)
 */

import type { Jurisdiction, ISO8601 } from '@afg/shared-types';

// ─── Deployment Topology ────────────────────────────────────────────────────

/** Deployment mode for a service in a given region. */
export type DeploymentMode = 'ACTIVE_ACTIVE' | 'ACTIVE_PASSIVE';

/** Service classification for determining deployment mode. */
export type ServiceType = 'STATELESS' | 'STATEFUL';

/** Health status of a regional deployment. */
export type RegionHealth = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

/** Role of a region for a stateful store. */
export type RegionRole = 'PRIMARY' | 'SECONDARY' | 'STANDBY';

/** Configuration for a single region in the deployment topology. */
export interface RegionConfig {
  /** Region identifier (maps to jurisdiction). */
  regionId: string;

  /** Jurisdiction this region serves. */
  jurisdiction: Jurisdiction;

  /** Region health status. */
  health: RegionHealth;

  /** Role for stateful data stores. */
  role: RegionRole;

  /** Current latency from global load balancer in ms. */
  latencyMs: number;

  /** Available capacity as a percentage (0-100). */
  availableCapacityPercent: number;

  /** Whether the region is currently accepting traffic. */
  acceptingTraffic: boolean;
}

/** Deployment topology for the entire platform. */
export interface DeploymentTopology {
  /** All configured regions. */
  regions: RegionConfig[];

  /** Services and their deployment modes. */
  services: ServiceDeployment[];
}

/** Deployment configuration for a single service. */
export interface ServiceDeployment {
  /** Service identifier. */
  serviceId: string;

  /** Whether the service is stateless or stateful. */
  serviceType: ServiceType;

  /** Derived deployment mode: stateless → active-active, stateful → active-passive. */
  deploymentMode: DeploymentMode;

  /** Regions where this service is deployed. */
  deployedRegions: string[];
}

// ─── RTO/RPO Targets ────────────────────────────────────────────────────────

/** Data classification for RTO/RPO assignment. */
export type DataClass =
  | 'TRANSACTIONAL'
  | 'AUDIT'
  | 'MODEL_ARTEFACT'
  | 'VECTOR_INDEX';

/** Recovery Point Objective / Recovery Time Objective pair. */
export interface RecoveryTarget {
  /** Data classification this target applies to. */
  dataClass: DataClass;

  /** Maximum acceptable data loss in minutes. */
  rpoMinutes: number;

  /** Maximum acceptable recovery time in minutes. */
  rtoMinutes: number;
}

/** Predefined RTO/RPO targets per data class (from Requirement 19.5). */
export const DEFAULT_RECOVERY_TARGETS: Record<DataClass, RecoveryTarget> = {
  TRANSACTIONAL: { dataClass: 'TRANSACTIONAL', rpoMinutes: 1, rtoMinutes: 5 },
  AUDIT: { dataClass: 'AUDIT', rpoMinutes: 15, rtoMinutes: 60 },
  MODEL_ARTEFACT: { dataClass: 'MODEL_ARTEFACT', rpoMinutes: 60, rtoMinutes: 240 },
  VECTOR_INDEX: { dataClass: 'VECTOR_INDEX', rpoMinutes: 240, rtoMinutes: 480 },
};

/** Result of a failover operation. */
export interface FailoverResult {
  /** Whether failover was successful. */
  success: boolean;

  /** Source region that failed. */
  sourceRegion: string;

  /** Target region that took over. */
  targetRegion: string;

  /** Data class involved. */
  dataClass: DataClass;

  /** Actual failover time in milliseconds. */
  failoverTimeMs: number;

  /** Whether RTO was met. */
  rtoMet: boolean;

  /** Timestamp of failover completion. */
  timestamp: ISO8601;
}

// ─── GPU Auto-Scaling ───────────────────────────────────────────────────────

/** Metrics used for GPU pod auto-scaling decisions. */
export interface GpuScalingMetrics {
  /** Number of pending inference requests in the queue. */
  queueDepth: number;

  /** GPU utilisation as a percentage (0-100). */
  gpuUtilisationPercent: number;

  /** Tokens processed per second across all pods. */
  tokenThroughput: number;

  /** Timestamp of metrics collection. */
  timestamp: ISO8601;
}

/** Configuration for GPU auto-scaling behaviour. */
export interface GpuScalingConfig {
  /** Minimum number of GPU pods. */
  minReplicas: number;

  /** Maximum number of GPU pods. */
  maxReplicas: number;

  /** Queue depth threshold to trigger scale-up. */
  queueDepthScaleUpThreshold: number;

  /** Queue depth threshold to trigger scale-down. */
  queueDepthScaleDownThreshold: number;

  /** GPU utilisation percentage above which to scale up. */
  gpuUtilisationScaleUpPercent: number;

  /** GPU utilisation percentage below which to scale down. */
  gpuUtilisationScaleDownPercent: number;

  /** Token throughput per pod below which to scale down (underutilised). */
  tokenThroughputScaleDownPerPod: number;

  /** Cooldown period in seconds between scaling actions. */
  cooldownSeconds: number;

  /** Pre-warm lead time in minutes (default 30). */
  preWarmLeadTimeMinutes: number;
}

/** Default GPU scaling configuration. */
export const DEFAULT_GPU_SCALING_CONFIG: GpuScalingConfig = {
  minReplicas: 2,
  maxReplicas: 64,
  queueDepthScaleUpThreshold: 100,
  queueDepthScaleDownThreshold: 10,
  gpuUtilisationScaleUpPercent: 80,
  gpuUtilisationScaleDownPercent: 30,
  tokenThroughputScaleDownPerPod: 50,
  cooldownSeconds: 60,
  preWarmLeadTimeMinutes: 30,
};

/** Scaling decision output. */
export interface ScalingDecision {
  /** Current number of replicas. */
  currentReplicas: number;

  /** Desired number of replicas after scaling. */
  desiredReplicas: number;

  /** Direction of scaling. */
  action: 'SCALE_UP' | 'SCALE_DOWN' | 'NO_CHANGE';

  /** Primary reason for the scaling decision. */
  reason: ScalingReason;

  /** Timestamp of decision. */
  timestamp: ISO8601;
}

/** Reason for scaling decision. */
export type ScalingReason =
  | 'QUEUE_DEPTH_HIGH'
  | 'QUEUE_DEPTH_LOW'
  | 'GPU_UTILISATION_HIGH'
  | 'GPU_UTILISATION_LOW'
  | 'TOKEN_THROUGHPUT_LOW'
  | 'PRE_WARM'
  | 'COOLDOWN_ACTIVE'
  | 'AT_MIN_REPLICAS'
  | 'AT_MAX_REPLICAS'
  | 'METRICS_NORMAL';

// ─── Pre-Warming ────────────────────────────────────────────────────────────

/** Scheduled peak event for pre-warming. */
export interface ScheduledPeak {
  /** Unique identifier for this peak event. */
  peakId: string;

  /** Human-readable name (e.g., "Salary Day UPI Spike"). */
  name: string;

  /** Expected start time of the peak. */
  expectedPeakStart: ISO8601;

  /** Expected duration in minutes. */
  expectedDurationMinutes: number;

  /** Expected traffic multiplier over baseline. */
  trafficMultiplier: number;

  /** Target number of replicas to pre-warm. */
  targetReplicas: number;

  /** Regions affected. */
  affectedRegions: string[];
}

/** Pre-warming action result. */
export interface PreWarmResult {
  /** Peak event being prepared for. */
  peakId: string;

  /** Whether pre-warming was initiated. */
  initiated: boolean;

  /** Time pre-warming was triggered (30 min before peak). */
  triggeredAt: ISO8601;

  /** Target replicas to warm up to. */
  targetReplicas: number;

  /** Current replicas at trigger time. */
  currentReplicas: number;
}

// ─── Traffic Routing ────────────────────────────────────────────────────────

/** Traffic routing decision for a request. */
export interface TrafficRoutingDecision {
  /** Selected region for processing. */
  targetRegion: string;

  /** Latency to selected region in ms. */
  latencyMs: number;

  /** Reason for selecting this region. */
  reason: RoutingReason;

  /** Alternative regions considered. */
  alternatives: string[];
}

/** Reason for traffic routing decision. */
export type RoutingReason =
  | 'NEAREST_WITH_CAPACITY'
  | 'FAILOVER'
  | 'CAPACITY_OVERFLOW'
  | 'JURISDICTION_CONSTRAINT'
  | 'NO_AVAILABLE_REGION';

/** Traffic routing request. */
export interface TrafficRoutingRequest {
  /** Source location/region of the request. */
  sourceRegion: string;

  /** Required jurisdiction for data residency (if any). */
  requiredJurisdiction?: Jurisdiction;

  /** Minimum capacity percentage required. */
  minCapacityPercent: number;
}
