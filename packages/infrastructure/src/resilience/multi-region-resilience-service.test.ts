import { describe, it, expect, beforeEach } from 'vitest';
import {
  MultiRegionResilienceService,
  getDeploymentMode,
} from './multi-region-resilience-service.js';
import {
  DEFAULT_RECOVERY_TARGETS,
  DEFAULT_GPU_SCALING_CONFIG,
} from './types.js';
import type {
  RegionConfig,
  GpuScalingMetrics,
  GpuScalingConfig,
  ScheduledPeak,
} from './types.js';

// ─── Helper Factories ───────────────────────────────────────────────────────

function makeRegion(overrides: Partial<RegionConfig> = {}): RegionConfig {
  return {
    regionId: 'in-mumbai',
    jurisdiction: 'IN',
    health: 'HEALTHY',
    role: 'PRIMARY',
    latencyMs: 5,
    availableCapacityPercent: 80,
    acceptingTraffic: true,
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<GpuScalingMetrics> = {}): GpuScalingMetrics {
  return {
    queueDepth: 50,
    gpuUtilisationPercent: 60,
    tokenThroughput: 1000,
    timestamp: '2024-06-15T10:00:00Z',
    ...overrides,
  };
}

// ─── Deployment Topology Tests ──────────────────────────────────────────────

describe('getDeploymentMode', () => {
  it('returns ACTIVE_ACTIVE for stateless services', () => {
    expect(getDeploymentMode('STATELESS')).toBe('ACTIVE_ACTIVE');
  });

  it('returns ACTIVE_PASSIVE for stateful services', () => {
    expect(getDeploymentMode('STATEFUL')).toBe('ACTIVE_PASSIVE');
  });
});

describe('MultiRegionResilienceService - Deployment Topology', () => {
  let service: MultiRegionResilienceService;

  beforeEach(() => {
    service = new MultiRegionResilienceService();
  });

  it('registers a stateless service with active-active deployment mode', () => {
    const result = service.registerService('fraud-service', 'STATELESS', [
      'in-mumbai',
      'in-hyderabad',
    ]);

    expect(result.serviceId).toBe('fraud-service');
    expect(result.serviceType).toBe('STATELESS');
    expect(result.deploymentMode).toBe('ACTIVE_ACTIVE');
    expect(result.deployedRegions).toEqual(['in-mumbai', 'in-hyderabad']);
  });

  it('registers a stateful service with active-passive deployment mode', () => {
    const result = service.registerService('audit-store', 'STATEFUL', [
      'in-mumbai',
      'in-hyderabad',
    ]);

    expect(result.serviceId).toBe('audit-store');
    expect(result.serviceType).toBe('STATEFUL');
    expect(result.deploymentMode).toBe('ACTIVE_PASSIVE');
  });

  it('replaces existing service registration on re-register', () => {
    service.registerService('fraud-service', 'STATELESS', ['in-mumbai']);
    service.registerService('fraud-service', 'STATELESS', ['in-mumbai', 'sg']);

    const topology = service.getTopology();
    expect(topology.services.filter((s) => s.serviceId === 'fraud-service')).toHaveLength(1);
    expect(topology.services[0].deployedRegions).toEqual(['in-mumbai', 'sg']);
  });

  it('updates region configuration', () => {
    const region = makeRegion({ regionId: 'in-mumbai' });
    service.updateRegionConfig(region);

    const topology = service.getTopology();
    expect(topology.regions).toHaveLength(1);
    expect(topology.regions[0].regionId).toBe('in-mumbai');

    // Update existing
    service.updateRegionConfig({ ...region, health: 'DEGRADED' });
    expect(service.getTopology().regions).toHaveLength(1);
    expect(service.getTopology().regions[0].health).toBe('DEGRADED');
  });
});

// ─── Regional Failover Tests ────────────────────────────────────────────────

describe('MultiRegionResilienceService - Regional Failover', () => {
  let service: MultiRegionResilienceService;

  beforeEach(() => {
    service = new MultiRegionResilienceService({
      topology: {
        regions: [
          makeRegion({ regionId: 'in-mumbai', role: 'PRIMARY', latencyMs: 5 }),
          makeRegion({ regionId: 'in-hyderabad', role: 'SECONDARY', latencyMs: 15 }),
          makeRegion({ regionId: 'sg', jurisdiction: 'SG', role: 'STANDBY', latencyMs: 50 }),
        ],
        services: [],
      },
    });
  });

  it('returns correct RTO/RPO targets for transactional data', () => {
    const target = service.getRecoveryTarget('TRANSACTIONAL');
    expect(target.rpoMinutes).toBe(1);
    expect(target.rtoMinutes).toBe(5);
  });

  it('returns correct RTO/RPO targets for audit data', () => {
    const target = service.getRecoveryTarget('AUDIT');
    expect(target.rpoMinutes).toBe(15);
    expect(target.rtoMinutes).toBe(60);
  });

  it('executes failover to secondary region within RTO', () => {
    // Transactional RTO is 5 minutes = 300,000ms
    const result = service.executeFailover(
      'in-mumbai',
      'TRANSACTIONAL',
      120_000, // 2 minutes
      '2024-06-15T10:00:00Z'
    );

    expect(result.success).toBe(true);
    expect(result.sourceRegion).toBe('in-mumbai');
    expect(result.targetRegion).toBe('in-hyderabad');
    expect(result.rtoMet).toBe(true);
  });

  it('reports RTO not met when failover exceeds target', () => {
    const result = service.executeFailover(
      'in-mumbai',
      'TRANSACTIONAL',
      400_000, // 6.6 minutes — exceeds 5 minute RTO
      '2024-06-15T10:00:00Z'
    );

    expect(result.success).toBe(true);
    expect(result.rtoMet).toBe(false);
  });

  it('fails gracefully when no target region available', () => {
    const isolatedService = new MultiRegionResilienceService({
      topology: {
        regions: [
          makeRegion({ regionId: 'in-mumbai', role: 'PRIMARY', health: 'UNAVAILABLE' }),
          makeRegion({ regionId: 'in-hyderabad', role: 'SECONDARY', health: 'UNAVAILABLE' }),
        ],
        services: [],
      },
    });

    const result = isolatedService.executeFailover(
      'in-mumbai',
      'TRANSACTIONAL',
      100_000,
      '2024-06-15T10:00:00Z'
    );

    expect(result.success).toBe(false);
    expect(result.targetRegion).toBe('NONE');
  });

  it('validates RPO compliance correctly', () => {
    expect(service.validateRpo('TRANSACTIONAL', 0.5)).toBe(true);
    expect(service.validateRpo('TRANSACTIONAL', 2)).toBe(false);
    expect(service.validateRpo('AUDIT', 10)).toBe(true);
    expect(service.validateRpo('AUDIT', 20)).toBe(false);
  });

  it('validates RTO compliance correctly', () => {
    // Transactional RTO is 5 min = 300,000 ms
    expect(service.validateRto('TRANSACTIONAL', 200_000)).toBe(true);
    expect(service.validateRto('TRANSACTIONAL', 400_000)).toBe(false);
    // Audit RTO is 60 min = 3,600,000 ms
    expect(service.validateRto('AUDIT', 3_000_000)).toBe(true);
    expect(service.validateRto('AUDIT', 4_000_000)).toBe(false);
  });
});

// ─── GPU Auto-Scaling Tests ─────────────────────────────────────────────────

describe('MultiRegionResilienceService - GPU Auto-Scaling', () => {
  let service: MultiRegionResilienceService;
  const config: GpuScalingConfig = {
    ...DEFAULT_GPU_SCALING_CONFIG,
    minReplicas: 2,
    maxReplicas: 20,
    cooldownSeconds: 60,
  };

  beforeEach(() => {
    service = new MultiRegionResilienceService({
      gpuConfig: config,
      initialGpuReplicas: 4,
    });
  });

  it('scales up when queue depth exceeds threshold', () => {
    const metrics = makeMetrics({
      queueDepth: 150, // above 100 threshold
      gpuUtilisationPercent: 50,
    });

    const decision = service.computeScalingDecision(metrics, 100_000);

    expect(decision.action).toBe('SCALE_UP');
    expect(decision.reason).toBe('QUEUE_DEPTH_HIGH');
    expect(decision.desiredReplicas).toBeGreaterThan(4);
    expect(decision.desiredReplicas).toBeLessThanOrEqual(config.maxReplicas);
  });

  it('scales up when GPU utilisation exceeds threshold', () => {
    const metrics = makeMetrics({
      queueDepth: 50,
      gpuUtilisationPercent: 90, // above 80% threshold
    });

    const decision = service.computeScalingDecision(metrics, 100_000);

    expect(decision.action).toBe('SCALE_UP');
    expect(decision.reason).toBe('GPU_UTILISATION_HIGH');
  });

  it('scales down when queue depth and GPU utilisation are low', () => {
    const metrics = makeMetrics({
      queueDepth: 5, // below 10 threshold
      gpuUtilisationPercent: 20, // below 30% threshold
      tokenThroughput: 200,
    });

    const decision = service.computeScalingDecision(metrics, 100_000);

    expect(decision.action).toBe('SCALE_DOWN');
    expect(decision.reason).toBe('GPU_UTILISATION_LOW');
    expect(decision.desiredReplicas).toBeLessThan(4);
    expect(decision.desiredReplicas).toBeGreaterThanOrEqual(config.minReplicas);
  });

  it('scales down when token throughput per pod is low', () => {
    const metrics = makeMetrics({
      queueDepth: 5, // below scale-down threshold
      gpuUtilisationPercent: 50, // normal — not triggering utilisation scale-down
      tokenThroughput: 100, // 100/4 = 25 per pod, below 50 threshold
    });

    const decision = service.computeScalingDecision(metrics, 100_000);

    expect(decision.action).toBe('SCALE_DOWN');
    expect(decision.reason).toBe('TOKEN_THROUGHPUT_LOW');
  });

  it('does not change when metrics are normal', () => {
    const metrics = makeMetrics({
      queueDepth: 50, // between thresholds
      gpuUtilisationPercent: 60, // between thresholds
      tokenThroughput: 500, // 500/4 = 125 per pod, above 50
    });

    const decision = service.computeScalingDecision(metrics, 100_000);

    expect(decision.action).toBe('NO_CHANGE');
    expect(decision.reason).toBe('METRICS_NORMAL');
  });

  it('respects cooldown period between scaling actions', () => {
    // First action — scale up
    const metrics1 = makeMetrics({ queueDepth: 150 });
    service.computeScalingDecision(metrics1, 100_000);

    // Second action within cooldown (60s = 60,000ms)
    const metrics2 = makeMetrics({ queueDepth: 200 });
    const decision = service.computeScalingDecision(metrics2, 150_000); // only 50s later

    expect(decision.action).toBe('NO_CHANGE');
    expect(decision.reason).toBe('COOLDOWN_ACTIVE');
  });

  it('allows scaling after cooldown expires', () => {
    // First action
    const metrics1 = makeMetrics({ queueDepth: 150 });
    service.computeScalingDecision(metrics1, 100_000);

    // After cooldown
    const metrics2 = makeMetrics({ queueDepth: 200 });
    const decision = service.computeScalingDecision(metrics2, 200_000); // 100s later

    expect(decision.action).toBe('SCALE_UP');
  });

  it('does not scale below minimum replicas', () => {
    const minService = new MultiRegionResilienceService({
      gpuConfig: config,
      initialGpuReplicas: 2, // already at minimum
    });

    const metrics = makeMetrics({
      queueDepth: 2,
      gpuUtilisationPercent: 10,
    });

    const decision = minService.computeScalingDecision(metrics, 100_000);

    expect(decision.action).toBe('NO_CHANGE');
    expect(decision.reason).toBe('AT_MIN_REPLICAS');
  });

  it('does not scale above maximum replicas', () => {
    const maxService = new MultiRegionResilienceService({
      gpuConfig: config,
      initialGpuReplicas: 20, // already at maximum
    });

    const metrics = makeMetrics({
      queueDepth: 500,
      gpuUtilisationPercent: 95,
    });

    const decision = maxService.computeScalingDecision(metrics, 100_000);

    expect(decision.action).toBe('NO_CHANGE');
    expect(decision.reason).toBe('AT_MAX_REPLICAS');
  });

  it('scales up by 50% (rounded up)', () => {
    // With 4 replicas, 50% = 2, so desired = 6
    const metrics = makeMetrics({ queueDepth: 150 });
    const decision = service.computeScalingDecision(metrics, 100_000);

    expect(decision.currentReplicas).toBe(4);
    expect(decision.desiredReplicas).toBe(6);
  });

  it('scales down by 25% (rounded down)', () => {
    // Start with 8 replicas
    service.setCurrentGpuReplicas(8);
    const metrics = makeMetrics({
      queueDepth: 5,
      gpuUtilisationPercent: 20,
    });

    const decision = service.computeScalingDecision(metrics, 100_000);

    expect(decision.currentReplicas).toBe(8);
    expect(decision.desiredReplicas).toBe(6); // 8 - floor(8*0.25) = 8 - 2 = 6
  });
});

// ─── Pre-Warming Tests ──────────────────────────────────────────────────────

describe('MultiRegionResilienceService - Pre-Warming', () => {
  let service: MultiRegionResilienceService;

  beforeEach(() => {
    service = new MultiRegionResilienceService({
      gpuConfig: { ...DEFAULT_GPU_SCALING_CONFIG, preWarmLeadTimeMinutes: 30 },
      initialGpuReplicas: 4,
    });
  });

  it('triggers pre-warming 30 minutes before scheduled peak', () => {
    const peakStart = '2024-06-15T12:00:00Z'; // Peak at noon
    const peak: ScheduledPeak = {
      peakId: 'salary-day',
      name: 'Salary Day UPI Spike',
      expectedPeakStart: peakStart,
      expectedDurationMinutes: 90,
      trafficMultiplier: 4.5,
      targetReplicas: 32,
      affectedRegions: ['in-mumbai'],
    };

    service.schedulePeak(peak);

    // Check at 11:30 (exactly 30 min before peak)
    const result = service.checkPreWarming('2024-06-15T11:30:00Z');

    expect(result).not.toBeNull();
    expect(result!.peakId).toBe('salary-day');
    expect(result!.initiated).toBe(true);
    expect(result!.targetReplicas).toBe(32);
    expect(result!.currentReplicas).toBe(4);
    expect(service.getCurrentGpuReplicas()).toBe(32);
  });

  it('does not trigger pre-warming when too early', () => {
    const peak: ScheduledPeak = {
      peakId: 'salary-day',
      name: 'Salary Day UPI Spike',
      expectedPeakStart: '2024-06-15T12:00:00Z',
      expectedDurationMinutes: 90,
      trafficMultiplier: 4.5,
      targetReplicas: 32,
      affectedRegions: ['in-mumbai'],
    };

    service.schedulePeak(peak);

    // Check at 11:00 (60 min before peak — too early)
    const result = service.checkPreWarming('2024-06-15T11:00:00Z');

    expect(result).toBeNull();
    expect(service.getCurrentGpuReplicas()).toBe(4);
  });

  it('does not trigger pre-warming after the window passes', () => {
    const peak: ScheduledPeak = {
      peakId: 'salary-day',
      name: 'Salary Day UPI Spike',
      expectedPeakStart: '2024-06-15T12:00:00Z',
      expectedDurationMinutes: 90,
      trafficMultiplier: 4.5,
      targetReplicas: 32,
      affectedRegions: ['in-mumbai'],
    };

    service.schedulePeak(peak);

    // Check at 11:36 (past the 5-min window starting at 11:30)
    const result = service.checkPreWarming('2024-06-15T11:36:00Z');

    expect(result).toBeNull();
  });

  it('caps pre-warmed replicas at max', () => {
    const limitedService = new MultiRegionResilienceService({
      gpuConfig: { ...DEFAULT_GPU_SCALING_CONFIG, maxReplicas: 16, preWarmLeadTimeMinutes: 30 },
      initialGpuReplicas: 4,
    });

    const peak: ScheduledPeak = {
      peakId: 'salary-day',
      name: 'Salary Day UPI Spike',
      expectedPeakStart: '2024-06-15T12:00:00Z',
      expectedDurationMinutes: 90,
      trafficMultiplier: 4.5,
      targetReplicas: 32, // above max of 16
      affectedRegions: ['in-mumbai'],
    };

    limitedService.schedulePeak(peak);
    limitedService.checkPreWarming('2024-06-15T11:30:00Z');

    expect(limitedService.getCurrentGpuReplicas()).toBe(16);
  });

  it('manages multiple scheduled peaks', () => {
    service.schedulePeak({
      peakId: 'salary-day',
      name: 'Salary Day',
      expectedPeakStart: '2024-06-15T12:00:00Z',
      expectedDurationMinutes: 90,
      trafficMultiplier: 4.5,
      targetReplicas: 32,
      affectedRegions: ['in-mumbai'],
    });

    service.schedulePeak({
      peakId: 'month-end',
      name: 'Month End',
      expectedPeakStart: '2024-06-30T18:00:00Z',
      expectedDurationMinutes: 120,
      trafficMultiplier: 3.0,
      targetReplicas: 24,
      affectedRegions: ['in-mumbai', 'sg'],
    });

    expect(service.getScheduledPeaks()).toHaveLength(2);
  });
});

// ─── Traffic Routing Tests ──────────────────────────────────────────────────

describe('MultiRegionResilienceService - Traffic Routing', () => {
  let service: MultiRegionResilienceService;

  beforeEach(() => {
    service = new MultiRegionResilienceService({
      topology: {
        regions: [
          makeRegion({ regionId: 'in-mumbai', jurisdiction: 'IN', latencyMs: 5, availableCapacityPercent: 80, role: 'PRIMARY' }),
          makeRegion({ regionId: 'in-hyderabad', jurisdiction: 'IN', latencyMs: 15, availableCapacityPercent: 70, role: 'SECONDARY' }),
          makeRegion({ regionId: 'sg', jurisdiction: 'SG', latencyMs: 50, availableCapacityPercent: 90, role: 'PRIMARY' }),
          makeRegion({ regionId: 'uk-london', jurisdiction: 'GB', latencyMs: 120, availableCapacityPercent: 60, role: 'PRIMARY' }),
        ],
        services: [],
      },
    });
  });

  it('routes to nearest region with capacity', () => {
    const decision = service.routeTraffic({
      sourceRegion: 'in-mumbai',
      minCapacityPercent: 10,
    });

    expect(decision.targetRegion).toBe('in-mumbai');
    expect(decision.reason).toBe('NEAREST_WITH_CAPACITY');
    expect(decision.latencyMs).toBe(5);
  });

  it('respects jurisdiction constraint', () => {
    const decision = service.routeTraffic({
      sourceRegion: 'in-mumbai',
      requiredJurisdiction: 'SG',
      minCapacityPercent: 10,
    });

    expect(decision.targetRegion).toBe('sg');
    expect(decision.reason).toBe('JURISDICTION_CONSTRAINT');
  });

  it('selects next-best region when primary lacks capacity', () => {
    // Set Mumbai to 0% capacity
    service.updateRegionConfig(
      makeRegion({ regionId: 'in-mumbai', jurisdiction: 'IN', latencyMs: 5, availableCapacityPercent: 0 })
    );

    const decision = service.routeTraffic({
      sourceRegion: 'in-mumbai',
      minCapacityPercent: 50,
    });

    // Should skip mumbai (0% capacity) and pick next lowest latency with enough capacity
    expect(decision.targetRegion).toBe('in-hyderabad');
  });

  it('returns capacity overflow routing when no region meets minimum', () => {
    // Set all regions to low capacity
    service.updateRegionConfig(makeRegion({ regionId: 'in-mumbai', jurisdiction: 'IN', latencyMs: 5, availableCapacityPercent: 5 }));
    service.updateRegionConfig(makeRegion({ regionId: 'in-hyderabad', jurisdiction: 'IN', latencyMs: 15, availableCapacityPercent: 8 }));
    service.updateRegionConfig(makeRegion({ regionId: 'sg', jurisdiction: 'SG', latencyMs: 50, availableCapacityPercent: 3 }));
    service.updateRegionConfig(makeRegion({ regionId: 'uk-london', jurisdiction: 'GB', latencyMs: 120, availableCapacityPercent: 2 }));

    const decision = service.routeTraffic({
      sourceRegion: 'in-mumbai',
      minCapacityPercent: 50, // nothing meets this
    });

    expect(decision.reason).toBe('CAPACITY_OVERFLOW');
    expect(decision.targetRegion).toBe('in-mumbai'); // still nearest with any capacity
  });

  it('returns NO_AVAILABLE_REGION when all regions are unavailable', () => {
    const emptyService = new MultiRegionResilienceService({
      topology: {
        regions: [
          makeRegion({ regionId: 'in-mumbai', health: 'UNAVAILABLE', acceptingTraffic: false }),
          makeRegion({ regionId: 'sg', jurisdiction: 'SG', health: 'UNAVAILABLE', acceptingTraffic: false }),
        ],
        services: [],
      },
    });

    const decision = emptyService.routeTraffic({
      sourceRegion: 'in-mumbai',
      minCapacityPercent: 10,
    });

    expect(decision.targetRegion).toBe('NONE');
    expect(decision.reason).toBe('NO_AVAILABLE_REGION');
  });

  it('returns NO_AVAILABLE_REGION when required jurisdiction has no regions', () => {
    const decision = service.routeTraffic({
      sourceRegion: 'in-mumbai',
      requiredJurisdiction: 'US', // no US region configured
      minCapacityPercent: 10,
    });

    expect(decision.targetRegion).toBe('NONE');
    expect(decision.reason).toBe('NO_AVAILABLE_REGION');
  });

  it('performs failover-aware routing excluding the failed region', () => {
    const decision = service.routeWithFailover(
      {
        sourceRegion: 'in-mumbai',
        minCapacityPercent: 10,
      },
      'in-mumbai' // mumbai failed
    );

    expect(decision.targetRegion).toBe('in-hyderabad');
    expect(decision.reason).toBe('FAILOVER');
  });

  it('lists alternative regions in routing decision', () => {
    const decision = service.routeTraffic({
      sourceRegion: 'in-mumbai',
      minCapacityPercent: 10,
    });

    expect(decision.alternatives.length).toBeGreaterThan(0);
    expect(decision.alternatives).not.toContain(decision.targetRegion);
  });
});

// ─── Default Recovery Targets Tests ─────────────────────────────────────────

describe('DEFAULT_RECOVERY_TARGETS', () => {
  it('defines transactional RPO <1min / RTO <5min', () => {
    expect(DEFAULT_RECOVERY_TARGETS.TRANSACTIONAL.rpoMinutes).toBe(1);
    expect(DEFAULT_RECOVERY_TARGETS.TRANSACTIONAL.rtoMinutes).toBe(5);
  });

  it('defines audit RPO <15min / RTO <1h', () => {
    expect(DEFAULT_RECOVERY_TARGETS.AUDIT.rpoMinutes).toBe(15);
    expect(DEFAULT_RECOVERY_TARGETS.AUDIT.rtoMinutes).toBe(60);
  });

  it('defines model artefact RPO <1h / RTO <4h', () => {
    expect(DEFAULT_RECOVERY_TARGETS.MODEL_ARTEFACT.rpoMinutes).toBe(60);
    expect(DEFAULT_RECOVERY_TARGETS.MODEL_ARTEFACT.rtoMinutes).toBe(240);
  });

  it('defines vector index RPO <4h / RTO <8h', () => {
    expect(DEFAULT_RECOVERY_TARGETS.VECTOR_INDEX.rpoMinutes).toBe(240);
    expect(DEFAULT_RECOVERY_TARGETS.VECTOR_INDEX.rtoMinutes).toBe(480);
  });
});
