import {
  BASELINE_DAY_WEEKDAYS_SELECT,
  PLAN_BLOCKS_SELECT,
  toPlanBlocks,
} from '../routines/routine-plan';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  TRAINING_PARTNER_REQUESTS_PER_DAY_MAX,
  TRAINING_PARTNER_ENCOURAGEMENTS_PER_24_HOURS_MAX,
  TRAINING_PARTNERS_MAX,
  type SendTrainingPartnerEncouragementResponse,
  type TrainingPartnerEncouragementKind,
  type TrainingPartnerPermissions,
  type TrainingPartnerScheduleResponse,
  type TrainingPartnership,
  type TrainingPartnershipsResponse,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { localClock } from '../notifications/push/local-time';
import { routinesPlannedOn } from '../notifications/push/training-days';
import { isHiddenFromViewer } from './member-blocks';
import {
  NO_TRAINING_PARTNER_PERMISSIONS,
  trainingPartnerPairKey,
} from './training-partner-access';

const MEMBER_SELECT = {
  id: true,
  username: true,
  name: true,
  lastName: true,
  avatarUrl: true,
} as const;

const PARTNERSHIP_SELECT = {
  id: true,
  requesterId: true,
  recipientId: true,
  status: true,
  createdAt: true,
  acceptedAt: true,
  requester: { select: MEMBER_SELECT },
  recipient: { select: MEMBER_SELECT },
  grants: {
    select: {
      grantorId: true,
      schedule: true,
      progress: true,
      activity: true,
      routines: true,
      encouragement: true,
    },
  },
} as const;

type PartnershipRow = Prisma.TrainingPartnershipGetPayload<{
  select: typeof PARTNERSHIP_SELECT;
}>;

const grantPermissions = (
  grant: PartnershipRow['grants'][number] | undefined,
): TrainingPartnerPermissions =>
  grant
    ? {
        schedule: grant.schedule,
        progress: grant.progress,
        activity: grant.activity,
        routines: grant.routines,
        encouragement: grant.encouragement,
      }
    : { ...NO_TRAINING_PARTNER_PERMISSIONS };

export function mapTrainingPartnership(
  row: PartnershipRow,
  viewerId: string,
): TrainingPartnership {
  const requestedByMe = row.requesterId === viewerId;
  const member = requestedByMe ? row.recipient : row.requester;
  return {
    id: row.id,
    status: row.status,
    member,
    requestedByMe,
    permissionsGrantedByMe: grantPermissions(
      row.grants.find((grant) => grant.grantorId === viewerId),
    ),
    permissionsGrantedToMe: grantPermissions(
      row.grants.find((grant) => grant.grantorId === member.id),
    ),
    createdAt: row.createdAt.toISOString(),
    ...(row.acceptedAt
      ? { acceptedAt: row.acceptedAt.toISOString() }
      : {}),
  };
}

const addUtcDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const ENCOURAGEMENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const SERIALIZABLE_RETRIES = 3;

@Injectable()
export class TrainingPartnersService {
  constructor(private readonly db: DatabaseService) {}

  async list(viewerId: string): Promise<TrainingPartnershipsResponse> {
    const rows = await this.db.trainingPartnership.findMany({
      where: { OR: [{ requesterId: viewerId }, { recipientId: viewerId }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: PARTNERSHIP_SELECT,
    });
    return { items: rows.map((row) => mapTrainingPartnership(row, viewerId)) };
  }

  async request(
    requesterId: string,
    targetIdentifier: string,
    now = new Date(),
  ): Promise<TrainingPartnership> {
    const target = await this.resolve(targetIdentifier);
    if (target.id === requesterId) {
      throw new BadRequestException(
        'You cannot send a training-partner request to yourself',
      );
    }
    if (await isHiddenFromViewer(this.db, requesterId, target.id)) {
      throw new NotFoundException('Member not found');
    }
    await this.assertPartnerCapacity(requesterId);

    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const requestsToday = await this.db.trainingPartnership.count({
      where: { requesterId, createdAt: { gte: dayStart } },
    });
    if (requestsToday >= TRAINING_PARTNER_REQUESTS_PER_DAY_MAX) {
      throw new ConflictException(
        `You can send at most ${TRAINING_PARTNER_REQUESTS_PER_DAY_MAX} training-partner requests per day.`,
      );
    }

    try {
      const row = await this.db.trainingPartnership.create({
        data: {
          pairKey: trainingPartnerPairKey(requesterId, target.id),
          requesterId,
          recipientId: target.id,
        },
        select: PARTNERSHIP_SELECT,
      });
      return mapTrainingPartnership(row, requesterId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A training-partner relationship already exists with this member.',
        );
      }
      throw error;
    }
  }

  async accept(
    viewerId: string,
    partnershipId: string,
    now = new Date(),
  ): Promise<TrainingPartnership> {
    const row = await this.db.trainingPartnership.findFirst({
      where: { id: partnershipId, recipientId: viewerId, status: 'PENDING' },
      select: { requesterId: true },
    });
    if (!row) throw new NotFoundException('Training-partner request not found');
    if (await isHiddenFromViewer(this.db, viewerId, row.requesterId)) {
      throw new NotFoundException('Training-partner request not found');
    }
    await Promise.all([
      this.assertPartnerCapacity(viewerId),
      this.assertPartnerCapacity(row.requesterId),
    ]);

    await this.db.$transaction(async (tx) => {
      const changed = await tx.trainingPartnership.updateMany({
        where: { id: partnershipId, recipientId: viewerId, status: 'PENDING' },
        data: { status: 'ACTIVE', acceptedAt: now },
      });
      if (changed.count === 0) {
        throw new NotFoundException('Training-partner request not found');
      }
      await tx.trainingPartnerGrant.createMany({
        data: [
          { partnershipId, grantorId: viewerId },
          { partnershipId, grantorId: row.requesterId },
        ],
        skipDuplicates: true,
      });
    });
    return this.getForViewer(viewerId, partnershipId);
  }

  async remove(
    viewerId: string,
    partnershipId: string,
  ): Promise<TrainingPartnershipsResponse> {
    const removed = await this.db.trainingPartnership.deleteMany({
      where: {
        id: partnershipId,
        OR: [{ requesterId: viewerId }, { recipientId: viewerId }],
      },
    });
    if (removed.count === 0) {
      throw new NotFoundException('Training-partner relationship not found');
    }
    return this.list(viewerId);
  }

  async updatePermissions(
    viewerId: string,
    partnershipId: string,
    permissions: TrainingPartnerPermissions,
  ): Promise<TrainingPartnership> {
    const partnership = await this.db.trainingPartnership.findFirst({
      where: {
        id: partnershipId,
        status: 'ACTIVE',
        OR: [{ requesterId: viewerId }, { recipientId: viewerId }],
      },
      select: { id: true },
    });
    if (!partnership) {
      throw new NotFoundException('Training partnership not found');
    }
    await this.db.trainingPartnerGrant.upsert({
      where: { partnershipId_grantorId: { partnershipId, grantorId: viewerId } },
      update: permissions,
      create: { partnershipId, grantorId: viewerId, ...permissions },
    });
    return this.getForViewer(viewerId, partnershipId);
  }

  async schedule(
    viewerId: string,
    partnershipId: string,
    now = new Date(),
  ): Promise<TrainingPartnerScheduleResponse> {
    const partnership = await this.db.trainingPartnership.findFirst({
      where: {
        id: partnershipId,
        status: 'ACTIVE',
        OR: [{ requesterId: viewerId }, { recipientId: viewerId }],
      },
      select: {
        requesterId: true,
        recipientId: true,
        grants: {
          where: { schedule: true },
          select: { grantorId: true },
        },
      },
    });
    if (!partnership) {
      throw new NotFoundException('Shared schedule not found');
    }
    const ownerId =
      partnership.requesterId === viewerId
        ? partnership.recipientId
        : partnership.requesterId;
    if (!partnership.grants.some((grant) => grant.grantorId === ownerId)) {
      throw new NotFoundException('Shared schedule not found');
    }

    const owner = await this.db.user.findUnique({
      where: { id: ownerId },
      select: { timeZone: true },
    });
    if (!owner) throw new NotFoundException('Shared schedule not found');
    const timeZone = owner.timeZone ?? 'UTC';
    const today = localClock(now, timeZone).date;
    const dates = Array.from({ length: 7 }, (_, index) =>
      addUtcDays(today, index),
    );
    const to = dates.at(-1)!;

    const [routines, overrides, sessions] = await Promise.all([
      this.db.routine.findMany({
        where: { userId: ownerId },
        select: {
          id: true,
          name: true,
          scheduleMode: true,
          isCompleted: true,
          createdAt: true,
          restDays: true,
          rotationWeekdays: true,
          days: BASELINE_DAY_WEEKDAYS_SELECT,
          trainingBlocks: PLAN_BLOCKS_SELECT,
        },
      }),
      this.db.scheduleOverride.findMany({
        where: {
          userId: ownerId,
          OR: [
            { date: { gte: today, lte: to } },
            { toDate: { gte: today, lte: to } },
          ],
        },
        select: { routineId: true, kind: true, date: true, toDate: true },
      }),
      this.db.workoutSession.findMany({
        where: {
          userId: ownerId,
          startedAt: {
            gte: new Date(`${addUtcDays(today, -1)}T00:00:00.000Z`),
            lte: new Date(`${addUtcDays(to, 1)}T23:59:59.999Z`),
          },
        },
        select: { startedAt: true },
      }),
    ]);
    const trainedDates = new Set(
      sessions.map((session) => localClock(session.startedAt, timeZone).date),
    );
    const normalizedRoutines = routines.map((routine) => ({
      ...routine,
      scheduleMode: routine.scheduleMode as 'WEEKLY' | 'ROTATION',
      trainingBlocks: toPlanBlocks(routine.trainingBlocks),
    }));
    const normalizedOverrides = overrides.map((override) => ({
      ...override,
      kind: override.kind as 'MOVE' | 'SKIP',
    }));

    return {
      timeZone,
      days: dates.map((date) => ({
        date,
        plannedWorkoutCount: routinesPlannedOn({
          date,
          routines: normalizedRoutines,
          overrides: normalizedOverrides,
          routineIdsTrainedOnDate: [],
        }).length,
        trained: trainedDates.has(date),
      })),
    };
  }

  /**
   * SOC-09: the notification row is the prompt and the rate-limit evidence.
   * There is deliberately no message or conversation model beside it.
   */
  async encourage(
    viewerId: string,
    partnershipId: string,
    kind: TrainingPartnerEncouragementKind,
    now = new Date(),
  ): Promise<SendTrainingPartnerEncouragementResponse> {
    for (let attempt = 0; attempt < SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const partnership = await tx.trainingPartnership.findFirst({
              where: {
                id: partnershipId,
                status: 'ACTIVE',
                OR: [{ requesterId: viewerId }, { recipientId: viewerId }],
              },
              select: {
                requesterId: true,
                recipientId: true,
                grants: {
                  where: { encouragement: true },
                  select: { grantorId: true },
                },
              },
            });
            if (!partnership) {
              throw new NotFoundException('Training partnership not found');
            }
            const recipientId =
              partnership.requesterId === viewerId
                ? partnership.recipientId
                : partnership.requesterId;
            if (
              !partnership.grants.some(
                (grant) => grant.grantorId === recipientId,
              ) ||
              (await isHiddenFromViewer(tx, viewerId, recipientId))
            ) {
              throw new NotFoundException('Training partnership not found');
            }

            const since = new Date(now.getTime() - ENCOURAGEMENT_WINDOW_MS);
            const sent = await tx.notification.count({
              where: {
                userId: recipientId,
                actorId: viewerId,
                kind: 'TRAINING_PARTNER_ENCOURAGEMENT',
                createdAt: { gte: since },
              },
            });
            if (sent >= TRAINING_PARTNER_ENCOURAGEMENTS_PER_24_HOURS_MAX) {
              throw new HttpException(
                `You can send this partner at most ${TRAINING_PARTNER_ENCOURAGEMENTS_PER_24_HOURS_MAX} encouragements in 24 hours.`,
                HttpStatus.TOO_MANY_REQUESTS,
              );
            }

            const notification = await tx.notification.create({
              data: {
                userId: recipientId,
                actorId: viewerId,
                kind: 'TRAINING_PARTNER_ENCOURAGEMENT',
                sourceKey: `encouragement:${randomUUID()}`,
                payload: { encouragementKind: kind },
                createdAt: now,
              },
              select: { id: true, createdAt: true },
            });
            return {
              notificationId: notification.id,
              sentAt: notification.createdAt.toISOString(),
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          if (attempt + 1 < SERIALIZABLE_RETRIES) continue;
          throw new ConflictException('Please retry the encouragement.');
        }
        throw error;
      }
    }
    throw new ConflictException('Please retry the encouragement.');
  }

  private async getForViewer(
    viewerId: string,
    partnershipId: string,
  ): Promise<TrainingPartnership> {
    const row = await this.db.trainingPartnership.findFirst({
      where: {
        id: partnershipId,
        OR: [{ requesterId: viewerId }, { recipientId: viewerId }],
      },
      select: PARTNERSHIP_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Training-partner relationship not found');
    }
    return mapTrainingPartnership(row, viewerId);
  }

  private async assertPartnerCapacity(userId: string): Promise<void> {
    const active = await this.db.trainingPartnership.count({
      where: {
        status: 'ACTIVE',
        OR: [{ requesterId: userId }, { recipientId: userId }],
      },
    });
    if (active >= TRAINING_PARTNERS_MAX) {
      throw new ConflictException(
        `An account can have at most ${TRAINING_PARTNERS_MAX} training partners.`,
      );
    }
  }

  private async resolve(identifier: string) {
    const member = await this.db.user.findFirst({
      where: { OR: [{ id: identifier }, { username: identifier.toLowerCase() }] },
      select: MEMBER_SELECT,
    });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }
}
