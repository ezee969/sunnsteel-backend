import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ROUTINE_SHARE_MAX_ACTIVE_LINKS,
  type MemberRoutinesResponse,
  type RoutineShare,
  type RoutineShareListResponse,
  type RoutineVisibility,
  type SharedRoutine,
  type SharedRoutineSummary,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { ROUTINE_WITH_DAYS_SELECT } from './routine.selects';
import { captureRoutineSetup } from './routine-versions';
import { canViewRoutine } from './routine-visibility';

// base64url of 18 random bytes is 24 characters; anything else is not a token.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;

const shareSelect = {
  id: true,
  routineId: true,
  token: true,
  createdAt: true,
} as const;

/** 144 bits of randomness: the token is the only credential for a link. */
export function createRoutineShareToken(): string {
  return randomBytes(18).toString('base64url');
}

const OWNER_SELECT = {
  username: true,
  name: true,
  lastName: true,
  avatarUrl: true,
} as const;

/**
 * ROUT-04. Sharing exposes the **prescription** and nothing else: the payload
 * is `captureRoutineSetup`, the same shape `ROUT-08` versions store, which has
 * no place to put a session, a record or a log even by accident. Reusing it is
 * the safeguard — a hand-written projection could drift into carrying training.
 */
@Injectable()
export class RoutineSharingService {
  constructor(private readonly db: DatabaseService) {}

  async setVisibility(
    userId: string,
    routineId: string,
    visibility: RoutineVisibility,
  ): Promise<{ visibility: RoutineVisibility }> {
    await this.assertOwned(userId, routineId);
    const routine = await this.db.routine.update({
      where: { id: routineId },
      data: { visibility },
      select: { visibility: true },
    });
    return { visibility: routine.visibility };
  }

  async createShare(userId: string, routineId: string): Promise<RoutineShare> {
    await this.assertOwned(userId, routineId);
    const active = await this.db.routineShare.count({
      where: { routineId, revokedAt: null },
    });
    if (active >= ROUTINE_SHARE_MAX_ACTIVE_LINKS) {
      throw new ConflictException(
        `A routine keeps at most ${ROUTINE_SHARE_MAX_ACTIVE_LINKS} active links.`,
      );
    }
    const share = await this.db.routineShare.create({
      data: { routineId, userId, token: createRoutineShareToken() },
      select: shareSelect,
    });
    return this.mapShare(share);
  }

  async listShares(
    userId: string,
    routineId: string,
  ): Promise<RoutineShareListResponse> {
    await this.assertOwned(userId, routineId);
    const items = await this.db.routineShare.findMany({
      where: { routineId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: shareSelect,
    });
    return { items: items.map((item) => this.mapShare(item)) };
  }

  /** Revocation is permanent, as in SOC-07; a link is never re-enabled. */
  async revokeShare(
    userId: string,
    routineId: string,
    shareId: string,
  ): Promise<RoutineShareListResponse> {
    await this.assertOwned(userId, routineId);
    await this.db.routineShare.updateMany({
      where: { id: shareId, routineId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return this.listShares(userId, routineId);
  }

  /**
   * The unauthenticated read. A link is the owner's explicit consent for this
   * one routine, so it ignores visibility entirely — exactly as a session
   * share does. Revoking is what withdraws it.
   */
  async readByToken(token: string): Promise<SharedRoutine> {
    if (!TOKEN_PATTERN.test(token)) throw new NotFoundException('Link not found');
    const share = await this.db.routineShare.findFirst({
      where: { token, revokedAt: null },
      select: {
        routine: { select: ROUTINE_WITH_DAYS_SELECT },
        user: { select: OWNER_SELECT },
      },
    });
    if (!share?.routine) throw new NotFoundException('Link not found');

    return {
      routineId: share.routine.id,
      setup: captureRoutineSetup(share.routine),
      owner: {
        username: share.user.username ?? '',
        name: share.user.name,
        lastName: share.user.lastName,
        avatarUrl: share.user.avatarUrl,
      },
      source: 'LINK',
      updatedAt: share.routine.updatedAt.toISOString(),
    };
  }

  /**
   * One member's routines as a viewer may see them. Both rules are applied by
   * `canViewRoutine`, which takes the narrower — a per-routine switch can only
   * narrow the account's `PROF-06` routines rule, never widen it.
   */
  async listVisibleRoutines(
    viewerId: string | null,
    ownerId: string,
  ): Promise<MemberRoutinesResponse> {
    const owner = await this.db.user.findUnique({
      where: { id: ownerId },
      select: { routinesVisibility: true },
    });
    if (!owner) throw new NotFoundException('Member not found');

    const isOwner = viewerId === ownerId;
    const isFollower = isOwner
      ? false
      : viewerId !== null &&
        (await this.db.userFollow.count({
          where: { followerId: viewerId, followingId: ownerId },
        })) > 0;

    const routines = await this.db.routine.findMany({
      where: { userId: ownerId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        scheduleMode: true,
        visibility: true,
        updatedAt: true,
        days: { select: { _count: { select: { exercises: true } } } },
      },
    });

    const visible = routines.filter((routine) =>
      canViewRoutine(owner.routinesVisibility, routine.visibility, {
        isOwner,
        isFollower,
      }),
    );

    return {
      routines: visible.map(
        (routine): SharedRoutineSummary => ({
          routineId: routine.id,
          name: routine.name,
          description: routine.description ?? null,
          scheduleMode: routine.scheduleMode,
          dayCount: routine.days.length,
          exerciseCount: routine.days.reduce(
            (total, day) => total + day._count.exercises,
            0,
          ),
          updatedAt: routine.updatedAt.toISOString(),
        }),
      ),
    };
  }

  /** An identifier is a uuid or a username, as everywhere else on profiles. */
  async resolveOwnerId(identifier: string): Promise<string> {
    const owner = await this.db.user.findFirst({
      where: { OR: [{ id: identifier }, { username: identifier.toLowerCase() }] },
      select: { id: true },
    });
    if (!owner) throw new NotFoundException('Member not found');
    return owner.id;
  }

  /** One visible routine in full, for a member browsing without a link. */
  async readVisibleRoutine(
    viewerId: string | null,
    routineId: string,
  ): Promise<SharedRoutine> {
    const routine = await this.db.routine.findUnique({
      where: { id: routineId },
      select: {
        ...ROUTINE_WITH_DAYS_SELECT,
        user: { select: { ...OWNER_SELECT, id: true, routinesVisibility: true } },
      },
    });
    if (!routine) throw new NotFoundException('Routine not found');

    const isOwner = viewerId === routine.user.id;
    const isFollower = isOwner
      ? false
      : viewerId !== null &&
        (await this.db.userFollow.count({
          where: { followerId: viewerId, followingId: routine.user.id },
        })) > 0;

    if (
      !canViewRoutine(routine.user.routinesVisibility, routine.visibility, {
        isOwner,
        isFollower,
      })
    ) {
      // Not "forbidden": a routine the viewer may not read must not be
      // distinguishable from one that does not exist.
      throw new NotFoundException('Routine not found');
    }

    return {
      routineId: routine.id,
      setup: captureRoutineSetup(routine),
      owner: {
        username: routine.user.username ?? '',
        name: routine.user.name,
        lastName: routine.user.lastName,
        avatarUrl: routine.user.avatarUrl,
      },
      source: 'VISIBILITY',
      updatedAt: routine.updatedAt.toISOString(),
    };
  }

  private mapShare(row: {
    id: string;
    routineId: string;
    token: string;
    createdAt: Date;
  }): RoutineShare {
    return {
      id: row.id,
      routineId: row.routineId,
      token: row.token,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async assertOwned(userId: string, routineId: string): Promise<void> {
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: { id: true },
    });
    if (!routine) throw new NotFoundException('Routine not found');
  }
}
