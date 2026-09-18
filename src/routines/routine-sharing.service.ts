import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CLONE_ROUTINE_REFUSALS,
  ROUTINE_SHARE_MAX_ACTIVE_LINKS,
  type CloneRoutineRequest,
  type MemberRoutinesResponse,
  type Routine,
  type RoutineShare,
  type RoutineShareListResponse,
  type RoutineVisibility,
  type SharedRoutine,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { blockPairWhere } from '../users/member-blocks';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { readCloneSource, setupToClonedRoutine } from './routine-cloning';
import { ROUTINE_WITH_DAYS_SELECT } from './routine.selects';
import {
  ROUTINE_SUMMARY_SELECT,
  toSharedRoutineSummary,
} from './routine-summary';
import { captureRoutineSetup, setupExerciseIds } from './routine-versions';
import { canViewRoutine } from './routine-visibility';
import { RoutinesService } from './routines.service';

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
  constructor(
    private readonly db: DatabaseService,
    private readonly routines: RoutinesService,
  ) {}

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
    // PROF-10: a blocked member's routines are not listed, and the refusal is
    // the one a missing member gets.
    if (viewerId && viewerId !== ownerId) {
      const blocked = await this.db.userBlock.count({
        where: blockPairWhere(viewerId, ownerId),
      });
      if (blocked > 0) throw new NotFoundException('Member not found');
    }

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
      select: ROUTINE_SUMMARY_SELECT,
    });

    const visible = routines.filter((routine) =>
      canViewRoutine(owner.routinesVisibility, routine.visibility, {
        isOwner,
        isFollower,
      }),
    );

    return { routines: visible.map(toSharedRoutineSummary) };
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

  /**
   * One visible routine in full, for a member browsing without a link. When
   * `ownerId` is given the routine must belong to that member, so a profile
   * route cannot be used to read somebody else's routine through it.
   */
  async readVisibleRoutine(
    viewerId: string | null,
    routineId: string,
    ownerId?: string,
  ): Promise<SharedRoutine> {
    const routine = await this.db.routine.findUnique({
      where: { id: routineId },
      select: {
        ...ROUTINE_WITH_DAYS_SELECT,
        user: { select: { ...OWNER_SELECT, id: true, routinesVisibility: true } },
      },
    });
    if (!routine) throw new NotFoundException('Routine not found');
    if (ownerId && routine.user.id !== ownerId) {
      throw new NotFoundException('Routine not found');
    }

    const isOwner = viewerId === routine.user.id;
    if (viewerId && !isOwner) {
      const blocked = await this.db.userBlock.count({
        where: blockPairWhere(viewerId, routine.user.id),
      });
      // PROF-10: indistinguishable from a routine that does not exist.
      if (blocked > 0) throw new NotFoundException('Routine not found');
    }
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

  /**
   * ROUT-05. Clone a routine this viewer was allowed to read into one of their
   * own. The two sources are the two reads that already exist, so the clone
   * can never see more than a reader can: a link ignores visibility because
   * the owner handed it out, and a routine id goes through `canViewRoutine`,
   * which answers 404 when it may not be read.
   *
   * What is copied is `SharedRoutine.setup` and nothing else. The new routine
   * starts `PRIVATE` with no links, no versions and no favourite or completed
   * state, because inheriting a `PUBLIC` setting would republish somebody
   * else's programme without anyone choosing to. It is independent from the
   * moment it exists; recording where it came from is `ROUT-06`.
   */
  async cloneRoutine(
    userId: string,
    request: CloneRoutineRequest,
  ): Promise<Routine> {
    const source = readCloneSource(request);
    const shared =
      source.kind === 'LINK'
        ? await this.readByToken(source.token)
        : await this.readVisibleRoutine(userId, source.routineId);

    // The setup names catalog exercises by id, exactly as a stored version
    // does, so a routine sharing an exercise that has since been withdrawn is
    // refused by name rather than created with a day that cannot be trained.
    const ids = setupExerciseIds(shared.setup);
    const known = await this.db.exercise.count({ where: { id: { in: ids } } });
    if (known !== ids.length) {
      throw new ConflictException(
        `${CLONE_ROUTINE_REFUSALS.UNKNOWN_EXERCISE}: an exercise in this routine is no longer in the catalog`,
      );
    }

    const clone = await this.routines.create(
      userId,
      setupToClonedRoutine(shared.setup) as unknown as CreateRoutineDto,
    );
    // ROUT-06: what it was cloned from, recorded on the clone only. The source
    // is never told it was copied. The author is stored beside the routine id
    // so the lineage survives the source being deleted.
    const sourceRoutine = await this.db.routine.findUnique({
      where: { id: shared.routineId },
      select: { userId: true },
    });
    await this.db.routine.update({
      where: { id: clone.id },
      data: {
        clonedFromRoutineId: shared.routineId,
        clonedFromUserId: sourceRoutine?.userId ?? null,
        clonedAt: new Date(),
      },
    });
    return this.routines.findOne(userId, clone.id);
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
