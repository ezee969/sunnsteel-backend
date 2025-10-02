import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { WorkoutSessionStatus } from '@prisma/client';

/**
 * Periodic maintenance for workout sessions:
 * - Auto-abort stale IN_PROGRESS sessions that exceed timeout window
 */
@Injectable()
export class WorkoutMaintenanceService {
  private readonly logger = new Logger(WorkoutMaintenanceService.name);
  private timeoutHours: number;
  private sweepIntervalMin: number;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {
    this.timeoutHours = Number(
      this.config.get('WORKOUT_SESSION_TIMEOUT_HOURS') ?? 48,
    );
    this.sweepIntervalMin = Number(
      this.config.get('WORKOUT_SESSION_SWEEP_INTERVAL_MIN') ?? 30,
    );
  }

  // Run every sweepIntervalMin (fallback 30). Nest's @Interval needs a static number; we use 60s tick and internal gate.
  private lastRun = 0;
  @Interval(60_000)
  async sweep() {
    const intervalMs =
      Math.max(5, Number(this.sweepIntervalMin || 30)) * 60_000;
    const now = Date.now();
    if (now - this.lastRun < intervalMs) return;
    this.lastRun = now;
    const cutoff = new Date(Date.now() - this.timeoutHours * 3600_000);
    try {
      const result = await this.db.workoutSession.updateMany({
        where: {
          status: WorkoutSessionStatus.IN_PROGRESS,
          OR: [
            { lastActivityAt: { lt: cutoff } },
            { AND: [{ lastActivityAt: null }, { startedAt: { lt: cutoff } }] },
          ],
        },
        data: { status: WorkoutSessionStatus.ABORTED, endedAt: new Date() },
      });
      if (result.count > 0) {
        this.logger.log(
          `Auto-aborted ${result.count} stale sessions (> ${this.timeoutHours}h)`,
        );
      }
    } catch (e) {
      this.logger.error('Failed sweeping stale workout sessions', e);
    }
  }
}
