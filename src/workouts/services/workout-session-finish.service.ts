import { apiError } from "@sunsteel/contracts";
import { progressionRuns } from "../session-training-block";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ProgressionChange } from "@sunsteel/contracts";
import { DatabaseService } from "../../database/database.service";
import { lockTrainingAccount } from "../analytics/analytics-lock";
import {
  applyContribution,
  summarizeSession,
} from "../analytics/analytics-writer";
import {
  readProgressionEvents,
  writeProgressionEvents,
} from "../analytics/progression-events";
import { ensureSessionSnapshot } from "../analytics/session-snapshot";
import { FinishWorkoutDto } from "../dto/finish-workout.dto";
import {
  buildProgressionOutcome,
  type ProgressionLog,
} from "../progression-changes";
import {
  excludeSubstitutedSlots,
  readSubstitutions,
} from "../session-substitutions";
import { buildWorkoutSessionSelect } from "../workout-session.selects";
import { syncFollowingWarmUps } from "../../routines/warm-up-follow";
import {
  finishedBlock,
  linearBlockChangesJson,
  moveLinearSlot,
  notifyFinishedBlock,
  plannedLinearChanges,
  readLinearBlockChanges,
} from "../linear-block-advance";
import type { LinearBlockChange } from "@sunsteel/contracts";

@Injectable()
export class WorkoutSessionFinishService {
  constructor(private readonly db: DatabaseService) {}

  async finishSession(userId: string, id: string, dto: FinishWorkoutDto) {
    return this.db.$transaction(
      async (tx) => {
        await lockTrainingAccount(tx, userId);
        const session = await tx.workoutSession.findFirst({
          where: { id, userId },
        });
        if (!session)
          throw new NotFoundException(apiError("WORKOUT_SESSION_NOT_FOUND"));
        const status = dto.status === "ABORTED" ? "ABORTED" : "COMPLETED";

        if (session.status !== "IN_PROGRESS") {
          if (session.status !== status)
            throw new BadRequestException(apiError("SESSION_ALREADY_FINISHED"));
          const progressionChanges =
            status === "COMPLETED"
              ? await readProgressionEvents(
                  tx,
                  id,
                  (
                    (await ensureSessionSnapshot(tx, id)).routineDay
                      .exercises ?? []
                  ).map((exercise) => exercise.id),
                )
              : [];
          return {
            session: await tx.workoutSession.findUniqueOrThrow({
              where: { id },
              select: buildWorkoutSessionSelect(),
            }),
            progressionChanges,
            linearBlockChanges: readLinearBlockChanges(
              session.linearBlockChanges,
            ),
          };
        }

        const now = new Date();
        const claimed = await tx.workoutSession.updateMany({
          where: { id, userId, status: "IN_PROGRESS" },
          data: {
            status,
            endedAt: now,
            durationSec: Math.max(
              0,
              Math.round((now.getTime() - session.startedAt.getTime()) / 1000),
            ),
            notes: dto.notes,
          },
        });
        if (claimed.count !== 1)
          throw new BadRequestException("Session transition was not claimed");

        const snapshot = await ensureSessionSnapshot(tx, id);
        let progressionChanges: ProgressionChange[] = [];
        const linearBlockChanges: LinearBlockChange[] = [];
        if (status === "COMPLETED") {
          const logs = await tx.setLog.findMany({ where: { sessionId: id } });
          const progressionLogs: ProgressionLog[] = logs.flatMap((log) => {
            const routineExerciseId =
              log.sourceRoutineExerciseId ?? log.routineExerciseId;
            if (!routineExerciseId) return [];
            return [
              {
                routineExerciseId,
                setNumber: log.setNumber,
                reps: log.reps ?? null,
                weight: typeof log.weight === "number" ? log.weight : null,
                isCompleted: log.isCompleted,
                kind: log.kind,
              },
            ];
          });
          // ROUT-16: a deload session never advances progression.
          const outcome = progressionRuns(session)
            ? buildProgressionOutcome(
                snapshot.routineDay.exercises ?? [],
                // LIVE-11: a swapped slot was not done with the prescribed exercise.
                excludeSubstitutedSlots(
                  progressionLogs,
                  readSubstitutions(session.exerciseSubstitutions),
                ),
              )
            : { changes: [], updates: [] };
          progressionChanges = outcome.changes;

          await Promise.all(
            outcome.updates.map((update) =>
              tx.routineExerciseSet.update({
                where: {
                  routineExerciseId_setNumber: {
                    routineExerciseId: update.routineExerciseId,
                    setNumber: update.setNumber,
                  },
                },
                data: { weight: update.newWeight },
                select: { id: true },
              }),
            ),
          );
          // ROUT-17/ROUT-18: each LP slot whose sets were all done moves one
          // step, finishing its block after the eighth; a deload or a swap
          // moves nothing, and a slot changed since the start is left alone.
          const planned = plannedLinearChanges(
            snapshot,
            snapshot.routineDay.exercises ?? [],
            progressionLogs,
            {
              sessionId: id,
              finishedAt: now.toISOString(),
              runs: progressionRuns(session),
              substitutedIds: new Set(
                readSubstitutions(session.exerciseSubstitutions).map(
                  (substitution) => substitution.routineExerciseId,
                ),
              ),
            },
          );
          for (const change of planned) {
            if (
              await moveLinearSlot(
                tx,
                change.routineExerciseId,
                change.before,
                change.after,
              )
            ) {
              linearBlockChanges.push(change);
            }
          }
          if (linearBlockChanges.length) {
            await tx.workoutSession.update({
              where: { id },
              data: {
                linearBlockChanges: linearBlockChangesJson(linearBlockChanges),
              },
              select: { id: true },
            });
          }
          for (const change of linearBlockChanges.filter(finishedBlock)) {
            await notifyFinishedBlock(tx, {
              userId,
              sessionId: id,
              routineId: session.routineId ?? snapshot.sourceRoutineId,
              routineName: snapshot.routine?.name ?? "",
              change,
              at: now,
            });
          }
          // LIVE-20: warm-ups that follow the working load move with it.
          await syncFollowingWarmUps(tx, userId, [
            ...outcome.updates.map((update) => update.routineExerciseId),
            ...linearBlockChanges.map((change) => change.routineExerciseId),
          ]);
          await writeProgressionEvents(tx, userId, id, now, progressionChanges);

          const summary = await summarizeSession(tx, id);
          const active = await tx.workoutAnalyticsProjection.findFirst({
            where: { userId, active: true, state: "READY" },
          });
          if (active) await applyContribution(tx, active, summary);
          // BUILDING generations consume this finish through their ordered tail.
        }

        return {
          session: await tx.workoutSession.findUniqueOrThrow({
            where: { id },
            select: buildWorkoutSessionSelect(),
          }),
          progressionChanges,
          linearBlockChanges,
        };
      },
      { timeout: 15000 },
    );
  }
}
