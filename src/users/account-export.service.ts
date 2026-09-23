import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ACCOUNT_EXPORT_FORMAT,
  ACCOUNT_EXPORT_VERSION,
  type AccountExportMember,
  type AccountExportV1,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { ROUTINE_WITH_DAYS_SELECT } from '../routines/routine.selects';
import { toRoutineResponse } from '../routines/routine.mapper';
import { readRoutineSetup } from '../routines/routine-versions';
import { buildWorkoutSessionSelect } from '../workouts/workout-session.selects';
import { toWorkoutSessionResponse } from '../workouts/workout-session.mapper';
import { UsersService } from './users.service';

const MEMBER_SELECT = { username: true, name: true } as const;

/**
 * What the export leaves out on purpose, written into the file so a reader
 * does not have to guess whether something is missing or was never kept.
 */
export const ACCOUNT_EXPORT_OMITTED = [
  "Other members' details beyond their username and name; no email of anyone but you.",
  'Share-link tokens and push-notification device endpoints: they are credentials, not data.',
  'Analytics rollups, the dashboard projection and the notification feed: all are derived from the workouts and events included here.',
  'Moderation records: they are the moderator’s record, not yours.',
] as const;

const iso = (date: Date) => date.toISOString();

/**
 * EXPORT-01. One read-only pass over everything the member owns, mapped
 * through the same selects and mappers the app serves -- `toRoutineResponse`,
 * `toWorkoutSessionResponse`, the profile read -- so the file cannot describe
 * a routine or a workout differently from the screens that showed it.
 *
 * Every query is keyed on the member's id and nothing is written. The member
 * is the only reader, so there is no privacy rule to apply beyond never
 * including anyone else's email or credentials.
 */
@Injectable()
export class AccountExportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly users: UsersService,
  ) {}

  async exportAccount(userId: string): Promise<AccountExportV1> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        timeZone: true,
        plateauMinSessions: true,
        notifyRestAlert: true,
        notifyTrainingReminder: true,
        notifyStreakAtRisk: true,
        quietHoursStartMinute: true,
        quietHoursEndMinute: true,
        reminderMinuteOfDay: true,
      },
    });
    if (!user) throw new NotFoundException('Account not found');
    const account = await this.users.findByEmail(user.email);
    if (!account) throw new NotFoundException('Account not found');

    const [
      routines,
      versions,
      sessions,
      records,
      events,
      goals,
      locations,
      overrides,
      stars,
      following,
      followers,
      blocked,
      partnerships,
      comments,
      reactions,
      reports,
      sharingDefaults,
      entryOverrides,
    ] = await Promise.all([
      this.db.routine.findMany({
        where: { userId },
        select: ROUTINE_WITH_DAYS_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
      this.db.routineVersion.findMany({
        where: { routine: { userId } },
        select: {
          routineId: true,
          number: true,
          name: true,
          kind: true,
          createdAt: true,
          setup: true,
        },
        orderBy: [{ routineId: 'asc' }, { number: 'asc' }],
      }),
      this.db.workoutSession.findMany({
        where: { userId },
        select: buildWorkoutSessionSelect(true),
        orderBy: { startedAt: 'asc' },
      }),
      this.db.personalRecord.findMany({
        where: { userId },
        orderBy: { achievedAt: 'asc' },
      }),
      this.db.trainingEvent.findMany({
        where: { userId },
        select: {
          type: true,
          occurredAt: true,
          sessionId: true,
          schemaVersion: true,
          payload: true,
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
      this.db.measurableGoal.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.trainingLocationPreference.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.scheduleOverride.findMany({
        where: { userId },
        orderBy: { date: 'asc' },
      }),
      this.db.starredExercise.findMany({
        where: { userId },
        select: {
          createdAt: true,
          exercise: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.userFollow.findMany({
        where: { followerId: userId },
        select: { createdAt: true, following: { select: MEMBER_SELECT } },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.userFollow.findMany({
        where: { followingId: userId },
        select: { createdAt: true, follower: { select: MEMBER_SELECT } },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.userBlock.findMany({
        where: { blockerId: userId },
        select: { createdAt: true, blocked: { select: MEMBER_SELECT } },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.trainingPartnership.findMany({
        where: { OR: [{ requesterId: userId }, { recipientId: userId }] },
        select: {
          status: true,
          requesterId: true,
          createdAt: true,
          acceptedAt: true,
          requester: { select: MEMBER_SELECT },
          recipient: { select: MEMBER_SELECT },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.activityComment.findMany({
        where: { userId },
        select: {
          entryKey: true,
          body: true,
          createdAt: true,
          author: { select: MEMBER_SELECT },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.activityEntryReaction.findMany({
        where: { userId },
        select: {
          entryKey: true,
          reaction: true,
          createdAt: true,
          author: { select: MEMBER_SELECT },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.memberReport.findMany({
        where: { reporterId: userId },
        select: {
          subjectKind: true,
          reason: true,
          details: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.activitySharingDefault.findMany({
        where: { userId },
        select: { type: true, audience: true },
        orderBy: { type: 'asc' },
      }),
      this.db.activityEntryOverride.findMany({
        where: { userId },
        select: { entryKey: true, audience: true },
        orderBy: { entryKey: 'asc' },
      }),
    ]);

    const member = (m: {
      username: string;
      name: string;
    }): AccountExportMember => ({
      username: m.username,
      name: m.name,
    });
    const versionsByRoutine = new Map<string, typeof versions>();
    for (const version of versions) {
      const list = versionsByRoutine.get(version.routineId) ?? [];
      list.push(version);
      versionsByRoutine.set(version.routineId, list);
    }

    return {
      format: ACCOUNT_EXPORT_FORMAT,
      formatVersion: ACCOUNT_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      weightsAreKilograms: true,
      account,
      preferences: {
        notifications: {
          restAlert: user.notifyRestAlert,
          trainingReminder: user.notifyTrainingReminder,
          streakAtRisk: user.notifyStreakAtRisk,
          quietHours:
            user.quietHoursStartMinute !== null &&
            user.quietHoursEndMinute !== null
              ? {
                  startMinute: user.quietHoursStartMinute,
                  endMinute: user.quietHoursEndMinute,
                }
              : null,
          reminderMinuteOfDay: user.reminderMinuteOfDay,
        },
        timeZone: user.timeZone,
        plateauMinSessions: user.plateauMinSessions,
        activitySharingDefaults: sharingDefaults,
        activityEntryAudiences: entryOverrides,
      },
      routines: routines.map((routine) => ({
        routine: toRoutineResponse(routine),
        versions: (versionsByRoutine.get(routine.id) ?? []).map((version) => ({
          number: version.number,
          name: version.name,
          kind: version.kind,
          createdAt: iso(version.createdAt),
          setup: readRoutineSetup(version.setup),
        })),
      })),
      workouts: sessions.map((session) => toWorkoutSessionResponse(session)),
      personalRecords: records.map((record) => ({
        exerciseId: record.exerciseId,
        exerciseName: record.exerciseName,
        weightKg: record.weight,
        reps: record.reps,
        estimated1rmKg: record.estimated1rm,
        achievedAt: iso(record.achievedAt),
        sessionId: record.sessionId,
      })),
      trainingEvents: events.map((event) => ({
        type: event.type,
        occurredAt: iso(event.occurredAt),
        sessionId: event.sessionId,
        schemaVersion: event.schemaVersion,
        payload: event.payload,
      })),
      goals: goals.map((goal) => ({
        type: goal.type,
        direction: goal.direction,
        targetValue: goal.targetValue,
        exerciseId: goal.exerciseId,
        createdAt: iso(goal.createdAt),
      })),
      trainingLocations: locations.map((location) => ({
        name: location.name,
        isDefault: location.isDefault,
        barWeightKg: location.barWeightKg,
        availablePlatePairs: location.availablePlatePairs,
        equipment: location.equipment,
      })),
      scheduleOverrides: overrides.map((override) => ({
        routineId: override.routineId,
        date: override.date,
        kind: override.kind,
        toDate: override.toDate,
      })),
      exercises: {
        starred: stars.map((star) => ({
          exerciseId: star.exercise.id,
          name: star.exercise.name,
          starredAt: iso(star.createdAt),
        })),
      },
      social: {
        following: following.map((row) => ({
          ...member(row.following),
          since: iso(row.createdAt),
        })),
        followers: followers.map((row) => ({
          ...member(row.follower),
          since: iso(row.createdAt),
        })),
        blocked: blocked.map((row) => ({
          ...member(row.blocked),
          since: iso(row.createdAt),
        })),
        trainingPartners: partnerships.map((row) => {
          const requestedByMe = row.requesterId === userId;
          return {
            member: member(requestedByMe ? row.recipient : row.requester),
            status: row.status,
            requestedByMe,
            since: iso(row.acceptedAt ?? row.createdAt),
          };
        }),
        commentsWritten: comments.map((comment) => ({
          onActivityOf: member(comment.author),
          entryKey: comment.entryKey,
          body: comment.body,
          createdAt: iso(comment.createdAt),
        })),
        reactionsGiven: reactions.map((reaction) => ({
          onActivityOf: member(reaction.author),
          entryKey: reaction.entryKey,
          reaction: reaction.reaction,
          createdAt: iso(reaction.createdAt),
        })),
        reportsFiled: reports.map((report) => ({
          subjectKind: report.subjectKind,
          reason: report.reason,
          details: report.details,
          status: report.status,
          createdAt: iso(report.createdAt),
        })),
      },
      omitted: [...ACCOUNT_EXPORT_OMITTED],
    };
  }
}
