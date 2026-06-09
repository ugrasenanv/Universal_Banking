/**
 * Multi-Region Resilience and Auto-Scaling Service.
 *
 * Implements:
 * - Active-active for stateless services, active-passive for stateful stores (Req 19.3)
 * - Regional failover per RTO/RPO targets (Req 19.4, 19.5)
 * - GPU pod auto-scaling based on queue depth, GPU utilisation, token throughput (Req 20.1, 20.2)
 * - Pre-warming for predictable peaks, 30 minutes before expected spike (Req 20.2)
 * - Latency-aware traffic routing to nearest region with capacity (Req 20.4, 20.5)
 */

import type { Jurisdiction, ISO8601 } from '@afg/shared-types';
import type {
  RegionConfig,
  DeploymentTopology,
  ServiceDeployment,
  ServiceType,
  DeploymentMode,
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
import { DEFAULT_RECOVERY_TARGETS, DEFAULT_GPU_SCALING_CONFIG } from './types.js';

/**
 * Determines the deployment mode for a service based on its type.
 * Stateless services use active-active; stateful stores use active-passive.
 */
export function getDeploymentMode(serviceType: ServiceType): DeploymentMode {
  return serviceType === 'STATELESS' ? 'ACTIVE_ACTIVE' : 'ACTIVE_PASSIVE';
}

/**
 * Multi-Region Resilience Service.
 *
 * Manages regional failover, GPU auto-scaling, pre-warming,
 * and latency-aware traffic routing across the platform.
 */
export class MultiRegionResilienceService {
  private topology: DeploymentTopology;
  private recoveryTargets: Record<DataClass, RecoveryTarget>;
  private gpuConfig: GpuScalingConfig;
  private currentGpuReplicas: number;
  private lastScalingActionTimestamp: number = 0;
  private scheduledPeaks: ScheduledPeak[] = [];

  constructor(options?: {
    topology?: DeploymentTopology;
    recoveryTargets?: Record<DataClass, RecoveryTarget>;
    gpuConfig?: GpuScalingConfig;
    initialGpuReplicas?: number;
  }) {
    this.topology = options?.topology ?? { regions: [], services: [] };
    this.recoveryTargets = options?.recoveryTargets ?? DEFAULT_RECOVERY_TARGETS;
    this.gpuConfig = options?.gpuConfig ?? DEFAULT_GPU_SCALING_CONFIG;
    this.currentGpuReplicas = options?.initialGpuReplicas ?? this.gpuConfig.minReplicas;
  }

  // ─── Deployment Topology ──────────────────────────────────────────────────

  /**
   * Registers a service in the deployment topology.
   * Automatically assigns deployment mode based on service type.
   */
  registerService(
    serviceId: string,
    serviceType: ServiceType,
    deployedRegions: string[]
  ): ServiceDeployment {
    const deployment: ServiceDeployment = {
      serviceId,
      serviceType,
      deploymentMode: getDeploymentMode(serviceType),
      deployedRegions,
    };

    // Remove existing registration if present
    this.topology.services = this.topology.services.filter(
      (s) => s.serviceId !== serviceId
    );
    this.topology.services.push(deployment);
    return deployment;
  }

  /**
   * Updates region health and configuration.
   */
  updateRegionConfig(config: RegionConfig): void {
    const idx = this.topology.regions.findIndex(
      (r) => r.regionId === config.regionId
    );
    if (idx >= 0) {
      this.topology.regions[idx] = config;
    } else {
      this.topology.regions.push(config);
    }
  }

  /**
   * Gets the deployment topology.
   */
  getTopology(): DeploymentTopology {
    return this.topology;
  }

  // ─── Regional Failover ────────────────────────────────────────────────────

  /**
   * Gets the RTO/RPO targets for a given data class.
   */
  getRecoveryTarget(dataClass: DataClass): RecoveryTarget {
    return this.recoveryTargets[dataClass];
  }

  /**
   * Executes a regional failover for a given data class.
   * Selects the best secondary region and verifies RTO compliance.
   */
  executeFailover(
    failedRegionId: string,
    dataClass: DataClass,
    failoverTimeMs: number,
    now?: ISO8601
  ): FailoverResult {
    const target = this.recoveryTargets[dataClass];
    const rtoMs = target.rtoMinutes * 60 * 1000;

    // Find the best target region: healthy, secondary/standby role, accepting traffic
    const candidateRegions = this.topology.regions.filter(
      (r) =>
        r.regionId !== failedRegionId &&
        r.health !== 'UNAVAILABLE' &&
        r.acceptingTraffic &&
        r.availableCapacityPercent > 0
    );

    // Sort by: primary/secondary preference, then lowest latency
    candidateRegions.sort((a, b) => {
      if (a.role === 'SECONDARY' && b.role !== 'SECONDARY') return -1;
      if (b.role === 'SECONDARY' && a.role !== 'SECONDARY') return 1;
      return a.latencyMs - b.latencyMs;
    });

    const targetRegion = candidateRegions[0];

    if (!targetRegion) {
      return {
        success: false,
        sourceRegion: failedRegionId,
        targetRegion: 'NONE',
        dataClass,
        failoverTimeMs,
        rtoMet: false,
        timestamp: now ?? new Date().toISOString(),
      };
    }

    const rtoMet = failoverTimeMs <= rtoMs;

    return {
      success: true,
      sourceRegion: failedRegionId,
      targetRegion: targetRegion.regionId,
      dataClass,
      failoverTimeMs,
      rtoMet,
      timestamp: now ?? new Date().toISOString(),
    };
  }

  /**
   * Validates whether a failover time meets the RTO target for a data class.
   */
  validateRto(dataClass: DataClass, actualTimeMs: number): boolean {
    const target = this.recoveryTargets[dataClass];
    return actualTimeMs <= target.rtoMinutes * 60 * 1000;
  }

  /**
   * Validates whether data loss is within the RPO target for a data class.
   */
  validateRpo(dataClass: DataClass, dataLossMinutes: number): boolean {
    const target = this.recoveryTargets[dataClass];
    return dataLossMinutes <= target.rpoMinutes;
  }

  // ─── GPU Auto-Scaling ─────────────────────────────────────────────────────

  /**
   * Computes the desired number of GPU replicas based on current metrics.
   * Scaling decision considers queue depth, GPU utilisation, and token throughput.
   */
  computeScalingDecision(
    metrics: GpuScalingMetrics,
    nowMs?: number
  ): ScalingDecision {
    const now = nowMs ?? Date.now();
    const config = this.gpuConfig;
    const current = this.currentGpuReplicas;

    // Check cooldown
    const timeSinceLastAction = now - this.lastScalingActionTimestamp;
    if (timeSinceLastAction < config.cooldownSeconds * 1000 && this.lastScalingActionTimestamp > 0) {
      return {
        currentReplicas: current,
        desiredReplicas: current,
        action: 'NO_CHANGE',
        reason: 'COOLDOWN_ACTIVE',
        timestamp: metrics.timestamp,
      };
    }

    // Check for scale-up conditions (priority order)
    if (metrics.queueDepth > config.queueDepthScaleUpThreshold) {
      return this.buildScaleUpDecision(current, 'QUEUE_DEPTH_HIGH', metrics.timestamp, now);
    }

    if (metrics.gpuUtilisationPercent > config.gpuUtilisationScaleUpPercent) {
      return this.buildScaleUpDecision(current, 'GPU_UTILISATION_HIGH', metrics.timestamp, now);
    }

    // Check for scale-down conditions
    if (metrics.queueDepth < config.queueDepthScaleDownThreshold &&
        metrics.gpuUtilisationPercent < config.gpuUtilisationScaleDownPercent) {
      return this.buildScaleDownDecision(current, 'GPU_UTILISATION_LOW', metrics.timestamp, now);
    }

    if (current > config.minReplicas) {
      const throughputPerPod = metrics.tokenThroughput / current;
      if (throughputPerPod < config.tokenThroughputScaleDownPerPod &&
          metrics.queueDepth < config.queueDepthScaleDownThreshold) {
        return this.buildScaleDownDecision(current, 'TOKEN_THROUGHPUT_LOW', metrics.timestamp, now);
      }
    }

    return {
      currentReplicas: current,
      desiredReplicas: current,
      action: 'NO_CHANGE',
      reason: 'METRICS_NORMAL',
      timestamp: metrics.timestamp,
    };
  }

  private buildScaleUpDecision(
    current: number,
    reason: ScalingReason,
    timestamp: ISO8601,
    nowMs: number
  ): ScalingDecision {
    const config = this.gpuConfig;
    if (current >= config.maxReplicas) {
      return {
        currentReplicas: current,
        desiredReplicas: current,
        action: 'NO_CHANGE',
        reason: 'AT_MAX_REPLICAS',
        timestamp,
      };
    }

    // Scale up by 50% (rounded up), capped at max
    const increment = Math.max(1, Math.ceil(current * 0.5));
    const desired = Math.min(current + increment, config.maxReplicas);

    this.currentGpuReplicas = desired;
    this.lastScalingActionTimestamp = nowMs;

    return {
      currentReplicas: current,
      desiredReplicas: desired,
      action: 'SCALE_UP',
      reason,
      timestamp,
    };
  }

  private buildScaleDownDecision(
    current: number,
    reason: ScalingReason,
    timestamp: ISO8601,
    nowMs: number
  ): ScalingDecision {
    const config = this.gpuConfig;
    if (current <= config.minReplicas) {
      return {
        currentReplicas: current,
        desiredReplicas: current,
        action: 'NO_CHANGE',
        reason: 'AT_MIN_REPLICAS',
        timestamp,
      };
    }

    // Scale down by 25% (rounded down), floor at min
    const decrement = Math.max(1, Math.floor(current * 0.25));
    const desired = Math.max(current - decrement, config.minReplicas);

    this.currentGpuReplicas = desired;
    this.lastScalingActionTimestamp = nowMs;

    return {
      currentReplicas: current,
      desiredReplicas: desired,
      action: 'SCALE_DOWN',
      reason,
      timestamp,
    };
  }

  /**
   * Gets the current GPU replica count.
   */
  getCurrentGpuReplicas(): number {
    return this.currentGpuReplicas;
  }

  /**
   * Sets the current GPU replica count (for testing/external reconciliation).
   */
  setCurrentGpuReplicas(count: number): void {
    this.currentGpuReplicas = Math.max(
      this.gpuConfig.minReplicas,
      Math.min(count, this.gpuConfig.maxReplicas)
    );
  }

  // ─── Pre-Warming ──────────────────────────────────────────────────────────

  /**
   * Schedules a peak event for pre-warming.
   */
  schedulePeak(peak: ScheduledPeak): void {
    // Remove existing with same ID
    this.scheduledPeaks = this.scheduledPeaks.filter((p) => p.peakId !== peak.peakId);
    this.scheduledPeaks.push(peak);
  }

  /**
   * Gets all scheduled peaks.
   */
  getScheduledPeaks(): ScheduledPeak[] {
    return [...this.scheduledPeaks];
  }

  /**
   * Checks if pre-warming should be triggered for any scheduled peak.
   * Pre-warming initiates 30 minutes (configurable) before the expected spike.
   */
  checkPreWarming(nowIso: ISO8601): PreWarmResult | null {
    const now = new Date(nowIso).getTime();
    const leadTimeMs = this.gpuConfig.preWarmLeadTimeMinutes * 60 * 1000;

    for (const peak of this.scheduledPeaks) {
      const peakStart = new Date(peak.expectedPeakStart).getTime();
      const preWarmTriggerTime = peakStart - leadTimeMs;

      // Trigger if we are within a 5-minute window of the pre-warm time
      const windowMs = 5 * 60 * 1000;
      if (now >= preWarmTriggerTime && now < preWarmTriggerTime + windowMs) {
        const result: PreWarmResult = {
          peakId: peak.peakId,
          initiated: true,
          triggeredAt: nowIso,
          targetReplicas: peak.targetReplicas,
          currentReplicas: this.currentGpuReplicas,
        };

        // Execute the pre-warming
        this.currentGpuReplicas = Math.min(
          peak.targetReplicas,
          this.gpuConfig.maxReplicas
        );

        return result;
      }
    }

    return null;
  }

  // ─── Traffic Routing ──────────────────────────────────────────────────────

  /**
   * Routes traffic to the nearest region with available capacity.
   * Respects jurisdiction constraints for data residency.
   */
  routeTraffic(request: TrafficRoutingRequest): TrafficRoutingDecision {
    let candidates = this.topology.regions.filter(
      (r) => r.health !== 'UNAVAILABLE' && r.acceptingTraffic
    );

    // Apply jurisdiction constraint
    if (request.requiredJurisdiction) {
      const jurisdictionCandidates = candidates.filter(
        (r) => r.jurisdiction === request.requiredJurisdiction
      );
      if (jurisdictionCandidates.length > 0) {
        candidates = jurisdictionCandidates;
      } else {
        // No region in required jurisdiction is available
        return {
          targetRegion: 'NONE',
          latencyMs: Infinity,
          reason: 'NO_AVAILABLE_REGION',
          alternatives: [],
        };
      }
    }

    // Filter by capacity
    const withCapacity = candidates.filter(
      (r) => r.availableCapacityPercent >= request.minCapacityPercent
    );

    if (withCapacity.length === 0) {
      // Fall back to any candidate with some capacity
      const anyCandidates = candidates.filter(
        (r) => r.availableCapacityPercent > 0
      );
      if (anyCandidates.length === 0) {
        return {
          targetRegion: 'NONE',
          latencyMs: Infinity,
          reason: 'NO_AVAILABLE_REGION',
          alternatives: [],
        };
      }
      // Route to best available (capacity overflow scenario)
      anyCandidates.sort((a, b) => a.latencyMs - b.latencyMs);
      const selected = anyCandidates[0];
      return {
        targetRegion: selected.regionId,
        latencyMs: selected.latencyMs,
        reason: 'CAPACITY_OVERFLOW',
        alternatives: anyCandidates.slice(1).map((r) => r.regionId),
      };
    }

    // Sort by latency (nearest first)
    withCapacity.sort((a, b) => a.latencyMs - b.latencyMs);

    const selected = withCapacity[0];
    const reason: RoutingReason = request.requiredJurisdiction
      ? 'JURISDICTION_CONSTRAINT'
      : 'NEAREST_WITH_CAPACITY';

    return {
      targetRegion: selected.regionId,
      latencyMs: selected.latencyMs,
      reason,
      alternatives: withCapacity.slice(1).map((r) => r.regionId),
    };
  }

  /**
   * Performs failover-aware routing when a region becomes unavailable.
   */
  routeWithFailover(
    request: TrafficRoutingRequest,
    failedRegionId: string
  ): TrafficRoutingDecision {
    // Temporarily mark the failed region as unavailable
    const region = this.topology.regions.find((r) => r.regionId === failedRegionId);
    const originalHealth = region?.health;
    if (region) {
      region.health = 'UNAVAILABLE';
      region.acceptingTraffic = false;
    }

    const decision = this.routeTraffic(request);

    // Restore original state
    if (region && originalHealth) {
      region.health = originalHealth;
      region.acceptingTraffic = true;
    }

    // Adjust reason if we rerouted due to failover
    if (decision.targetRegion !== 'NONE') {
      return {
        ...decision,
        reason: 'FAILOVER',
      };
    }

    return decision;
  }
}
