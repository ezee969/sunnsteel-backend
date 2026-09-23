import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkoutSessionStatus } from '@prisma/client';
import {
  SESSION_SHARE_FIELDS,
  SESSION_SHARE_MAX_ACTIVE_LINKS,
  SessionShare,
  SessionShareField,
  SessionShareListResponse,
  SharedSessionOwner,
  SharedSessionRecap,
  WeightUnit,
  WorkoutSessionRecap,
} from '@sunsteel/contracts';

import { DatabaseService } from '../database/database.service';
import { WorkoutSessionRecapService } from './services';

const SHARE_FIELD_SET = new Set<string>(SESSION_SHARE_FIELDS);
// base64url of 18 random bytes is 24 characters; anything else is not a token.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;

const shareSelect = {
  id: true,
  sessionId: true,
  token: true,
  fields: true,
  createdAt: true,
  // TRUST-04: reported to the owner on their own list, so a link that opens
  // for nobody does not sit there looking live.
  moderationHiddenAt: true,
} as const;

/** 144 bits of randomness: the token is the only credential for a share. */
export function createShareToken(): string {
  return randomBytes(18).toString('base64url');
}

/** Drops unknown values and returns the canonical order used everywhere. */
export function normalizeShareFields(
  fields: readonly string[],
): SessionShareField[] {
  const chosen = new Set(fields.filter((field) => SHARE_FIELD_SET.has(field)));
  return SESSION_SHARE_FIELDS.filter((field) => chosen.has(field));
}

/**
 * Serialization boundary for the unauthenticated read: a field the owner did
 * not select is omitted from the response entirely, never nulled or zeroed.
 */
export function projectSharedRecap(
  recap: WorkoutSessionRecap,
  fields: SessionShareField[],
  owner: SharedSessionOwner,
  weightUnit: WeightUnit,
): SharedSessionRecap {
  const has = (field: SessionShareField) => fields.includes(field);
  return {
    fields,
    owner,
    weightUnit,
    routineName: recap.routineName,
    dayName: recap.dayName ?? null,
    endedAt: recap.endedAt,
    ...(has('duration') ? { durationSec: recap.durationSec } : {}),
    ...(has('volume') ? { totalVolumeKg: recap.totalVolumeKg } : {}),
    ...(has('completedSets') ? { completedSets: recap.completedSets } : {}),
    ...(has('records') ? { records: recap.records } : {}),
    ...(has('progression')
      ? { progressionChanges: recap.progressionChanges }
      : {}),
    ...(has('notes')
      ? { notes: recap.notes ?? null, exerciseNotes: recap.exerciseNotes ?? [] }
      : {}),
  };
}

@Injectable()
export class WorkoutSessionShareService {
  constructor(
    private readonly db: DatabaseService,
    private readonly recaps: WorkoutSessionRecapService,
  ) {}

  async create(
    userId: string,
    sessionId: string,
    requestedFields: readonly string[],
  ): Promise<SessionShare> {
    const fields = normalizeShareFields(requestedFields);
    if (fields.length === 0) {
      throw new BadRequestException(
        'Choose at least one part of the recap to share',
      );
    }
    const session = await this.db.workoutSession.findFirst({
      where: { id: sessionId, userId },
      select: { status: true },
    });
    if (!session) throw new NotFoundException('Workout session not found');
    if (session.status !== WorkoutSessionStatus.COMPLETED) {
      throw new BadRequestException('Only completed sessions can be shared');
    }
    const activeLinks = await this.db.sessionShare.count({
      where: { sessionId, userId, revokedAt: null },
    });
    if (activeLinks >= SESSION_SHARE_MAX_ACTIVE_LINKS) {
      throw new BadRequestException(
        `A session can have at most ${SESSION_SHARE_MAX_ACTIVE_LINKS} active share links`,
      );
    }
    const share = await this.db.sessionShare.create({
      data: { token: createShareToken(), sessionId, userId, fields },
      select: shareSelect,
    });
    return this.mapShare(share);
  }

  async list(
    userId: string,
    sessionId: string,
  ): Promise<SessionShareListResponse> {
    const session = await this.db.workoutSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Workout session not found');
    const shares = await this.db.sessionShare.findMany({
      where: { sessionId, userId, revokedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: shareSelect,
    });
    return { items: shares.map((share) => this.mapShare(share)) };
  }

  async revoke(
    userId: string,
    sessionId: string,
    shareId: string,
  ): Promise<void> {
    const { count } = await this.db.sessionShare.updateMany({
      where: { id: shareId, sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Share link not found');
  }

  /** Unguarded read: the token alone authorizes it, and only while active. */
  async getShared(token: string): Promise<SharedSessionRecap> {
    if (!TOKEN_PATTERN.test(token)) {
      throw new NotFoundException('Shared session not found');
    }
    // TRUST-04: a hidden share stops resolving. `revokedAt` is untouched, so
    // the owner still sees an active link -- flagged as hidden -- and a
    // restore puts it back rather than forcing them to issue a new one.
    const share = await this.db.sessionShare.findFirst({
      where: { token, revokedAt: null, moderationHiddenAt: null },
      select: {
        sessionId: true,
        userId: true,
        fields: true,
        user: {
          select: {
            username: true,
            name: true,
            lastName: true,
            avatarUrl: true,
            weightUnit: true,
          },
        },
      },
    });
    if (!share) throw new NotFoundException('Shared session not found');

    let recap: WorkoutSessionRecap;
    try {
      recap = await this.recaps.getSessionRecap(share.userId, share.sessionId);
    } catch (error) {
      // A share of a session that no longer yields a recap is simply gone.
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw new NotFoundException('Shared session not found');
      }
      throw error;
    }

    const { weightUnit, ...owner } = share.user;
    return projectSharedRecap(
      recap,
      normalizeShareFields(share.fields),
      owner,
      weightUnit,
    );
  }

  private mapShare(share: {
    id: string;
    sessionId: string;
    token: string;
    fields: string[];
    createdAt: Date;
    moderationHiddenAt: Date | null;
  }): SessionShare {
    return {
      id: share.id,
      sessionId: share.sessionId,
      token: share.token,
      fields: normalizeShareFields(share.fields),
      createdAt: share.createdAt.toISOString(),
      isHiddenByModeration: share.moderationHiddenAt !== null,
    };
  }
}
