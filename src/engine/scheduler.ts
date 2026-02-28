import type { LoadPlan } from "../plan/loadPlan.js";
import type { DeterministicRandom } from "../plan/templating.js";

export interface ScheduledTask {
  plannedTimeMs: number;
  phaseIndex: number;
  phaseName: string;
  endpointName: string;
}

interface WeightedEndpoint {
  name: string;
  cumulativeWeight: number;
}

export class PoissonScheduler {
  private readonly startTimeMs: number;

  private readonly phases: LoadPlan["phases"];

  private readonly random: DeterministicRandom;

  private readonly endpoints: WeightedEndpoint[];

  private readonly totalWeight: number;

  private phaseIndex = 0;

  private phaseElapsedSec = 0;

  private phaseStartTimeMs: number;

  constructor(startTimeMs: number, plan: LoadPlan, random: DeterministicRandom) {
    this.startTimeMs = startTimeMs;
    this.phaseStartTimeMs = startTimeMs;
    this.phases = plan.phases;
    this.random = random;
    let cumulative = 0;
    this.endpoints = plan.endpoints.map((endpoint) => {
      cumulative += endpoint.weight;
      return { name: endpoint.name, cumulativeWeight: cumulative };
    });
    this.totalWeight = cumulative;
  }

  nextTask(): ScheduledTask | null {
    while (this.phaseIndex < this.phases.length) {
      const phase = this.phases[this.phaseIndex];
      if (!phase || phase.targetRps <= 0) {
        this.advancePhase(phase?.durationSec ?? 0);
        continue;
      }
      const interArrivalSec = -Math.log(1 - this.random.float()) / phase.targetRps;
      this.phaseElapsedSec += interArrivalSec;
      if (this.phaseElapsedSec >= phase.durationSec) {
        this.advancePhase(phase.durationSec);
        continue;
      }
      return {
        phaseIndex: this.phaseIndex,
        phaseName: phase.name,
        plannedTimeMs: this.phaseStartTimeMs + this.phaseElapsedSec * 1000,
        endpointName: this.selectEndpointName()
      };
    }
    return null;
  }

  getCurrentPhase(nowMs: number): { name: string; elapsedSec: number; remainingSec: number; targetRps: number } | null {
    let cursor = this.startTimeMs;
    for (const phase of this.phases) {
      const end = cursor + phase.durationSec * 1000;
      if (nowMs < end) {
        const elapsedSec = Math.max(0, (nowMs - cursor) / 1000);
        return {
          name: phase.name,
          elapsedSec,
          remainingSec: Math.max(0, phase.durationSec - elapsedSec),
          targetRps: phase.targetRps
        };
      }
      cursor = end;
    }
    return null;
  }

  private advancePhase(durationSec: number): void {
    this.phaseStartTimeMs += durationSec * 1000;
    this.phaseIndex += 1;
    this.phaseElapsedSec = 0;
  }

  private selectEndpointName(): string {
    const draw = this.random.float() * this.totalWeight;
    for (const endpoint of this.endpoints) {
      if (draw < endpoint.cumulativeWeight) {
        return endpoint.name;
      }
    }
    return this.endpoints[this.endpoints.length - 1]?.name ?? "unknown";
  }
}
