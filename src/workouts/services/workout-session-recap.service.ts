import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkoutSessionStatus } from '@prisma/client';
import type {
  PreviousSessionRecap,
  WorkoutSessionRecap,
} from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import { readProgressionEvents } from '../analytics/progression-events';
import { readSnapshot } from '../analytics/session-snapshot';
import { buildSessionRecapRecords, summarizeRecapSets } from '../session-recap';
import { dayNameFrom } from '../workout-session.selects';

@Injectable()
export class WorkoutSessionRecapService {
  constructor(private readonly db: DatabaseService) {}

  async getSessionRecap(
    userId: string,
    sessionId: string,
  ): Promise<WorkoutSessionRecap> {
    const session = await this.db.workoutSession.findFirst({
      where: { id: sessionId, userId },
      select: {
        id: true,
        status: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
        totalVolumeKg: true,
        completedSets: true,
        notes: true,
        sourceRoutineDayId: true,
        routineDayId: true,
        snapshot: { select: { payload: true } },
        routine: { select: { name: true } },
        routineDay: { select: { dayOfWeek: true } },
        setLogs: {
          where: { isCompleted: true },
          select: {
            id: true,
            exerciseId: true,
            setNumber: true,
            reps: true,
            weight: true,
            isCompleted: true,
            completedAt: true,
            exercise: { select: { name: true } },
          },
          orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!session) throw new NotFoundException('Workout session not found');
    if (session.status !== WorkoutSessionStatus.COMPLETED || !session.endedAt) {
      throw new BadRequestException(
        'Session recap requires a completed session',
      );
    }

    const snapshot = session.snapshot
      ? readSnapshot(session.snapshot.payload)
      : null;
    const routineDayId = session.sourceRoutineDayId ?? session.routineDayId;
    const exerciseIds = [
      ...new Set(session.setLogs.map((set) => set.exerciseId)),
    ];

    const [previousSession, historicalSets, progressionChanges] =
      await Promise.all([
        routineDayId
          ? this.db.workoutSession.findFirst({
              where: {
                userId,
                status: WorkoutSessionStatus.COMPLETED,
                endedAt: { lt: session.startedAt },
                OR: [
                  { sourceRoutineDayId: routineDayId },
                  { sourceRoutineDayId: null, routineDayId },
                ],
              },
              orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
              select: {
                id: true,
                endedAt: true,
                durationSec: true,
                totalVolumeKg: true,
                completedSets: true,
                setLogs: {
                  where: { isCompleted: true },
                  select: {
                    reps: true,
                    weight: true,
                    isCompleted: true,
                  },
                },
              },
            })
          : Promise.resolve(null),
        exerciseIds.length
          ? this.db.setLog.findMany({
              where: {
                exerciseId: { in: exerciseIds },
                isCompleted: true,
                reps: { gt: 0 },
                session: {
                  userId,
                  status: WorkoutSessionStatus.COMPLETED,
                  endedAt: { lt: session.startedAt },
                },
              },
              select: {
                exerciseId: true,
                reps: true,
                weight: true,
                isCompleted: true,
              },
            })
          : Promise.resolve([]),
        readProgressionEvents(
          this.db,
          session.id,
          (snapshot?.routineDay.exercises ?? []).map((exercise) => exercise.id),
        ),
      ]);

    const currentMetrics = summarizeRecapSets(session.setLogs);
    const totalVolumeKg = session.totalVolumeKg ?? currentMetrics.totalVolumeKg;
    const completedSets = session.completedSets ?? currentMetrics.completedSets;
    const durationSec =
      session.durationSec ??
      Math.max(
        0,
        Math.round(
          (session.endedAt.getTime() - session.startedAt.getTime()) / 1000,
        ),
      );
    const records = buildSessionRecapRecords(
      session.setLogs.map((set) => ({
        ...set,
        exerciseName: set.exercise.name,
      })),
      historicalSets,
      session.endedAt,
    );

    let previous: PreviousSessionRecap | null = null;
    if (previousSession?.endedAt) {
      const fallback = summarizeRecapSets(previousSession.setLogs);
      const previousDuration = previousSession.durationSec ?? 0;
      const previousVolume =
        previousSession.totalVolumeKg ?? fallback.totalVolumeKg;
      const previousCompleted =
        previousSession.completedSets ?? fallback.completedSets;
      previous = {
        sessionId: previousSession.id,
        endedAt: previousSession.endedAt.toISOString(),
        durationSec: previousDuration,
        totalVolumeKg: previousVolume,
        completedSets: previousCompleted,
        durationDeltaSec: durationSec - previousDuration,
        volumeDeltaKg: totalVolumeKg - previousVolume,
        completedSetsDelta: completedSets - previousCompleted,
      };
    }

    const dayOfWeek =
      snapshot?.routineDay.dayOfWeek ?? session.routineDay?.dayOfWeek;
    return {
      sessionId: session.id,
      routineName: snapshot?.routine.name ?? session.routine?.name ?? 'Workout',
      dayName: typeof dayOfWeek === 'number' ? dayNameFrom(dayOfWeek) : null,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      durationSec,
      totalVolumeKg,
      completedSets,
      notes: session.notes,
      records,
      progressionChanges,
      previousSession: previous,
    };
  }
}
