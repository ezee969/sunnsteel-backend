import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BLOCKED_MEMBERS_MAX,
  type BlockedMembersResponse,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import {
  blockPairWhere,
  blockedIdsWhere,
  otherPartyId,
} from './member-blocks';
import { trainingPartnerPairKey } from './training-partner-access';

const MEMBER_SELECT = {
  id: true,
  username: true,
  name: true,
  lastName: true,
  avatarUrl: true,
} as const;

/**
 * PROF-10's member-facing control. Blocking is immediate and symmetric, and it
 * **removes the follow relation in both directions** rather than leaving it in
 * place and filtering it at read time: a follower count that still includes
 * someone you blocked is the control not working.
 */
@Injectable()
export class MemberBlocksService {
  constructor(private readonly db: DatabaseService) {}

  /** Every id this viewer must not see, and must not be seen by. */
  async blockedIds(viewerId: string): Promise<string[]> {
    const rows = await this.db.userBlock.findMany({
      where: blockedIdsWhere(viewerId),
      select: { blockerId: true, blockedId: true },
    });
    return rows.map((row) => otherPartyId(row, viewerId));
  }

  /** True when either account has blocked the other. */
  async isBlockedPair(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    const count = await this.db.userBlock.count({ where: blockPairWhere(a, b) });
    return count > 0;
  }

  async list(viewerId: string): Promise<BlockedMembersResponse> {
    const rows = await this.db.userBlock.findMany({
      where: { blockerId: viewerId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, blocked: { select: MEMBER_SELECT } },
    });
    return {
      blocks: rows.map((row) => ({
        member: row.blocked,
        blockedAt: row.createdAt.toISOString(),
      })),
    };
  }

  async block(
    viewerId: string,
    targetIdentifier: string,
  ): Promise<BlockedMembersResponse> {
    const target = await this.resolve(targetIdentifier);
    if (target === viewerId) {
      throw new BadRequestException('You cannot block yourself');
    }
    const existing = await this.db.userBlock.count({
      where: { blockerId: viewerId },
    });
    if (existing >= BLOCKED_MEMBERS_MAX) {
      throw new ConflictException(
        `You can block at most ${BLOCKED_MEMBERS_MAX} members.`,
      );
    }

    await this.db.$transaction([
      this.db.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId: viewerId, blockedId: target } },
        create: { blockerId: viewerId, blockedId: target },
        update: {},
      }),
      // Both directions: a block that left them following you would leave them
      // reading whatever followers may read.
      this.db.userFollow.deleteMany({
        where: {
          OR: [
            { followerId: viewerId, followingId: target },
            { followerId: target, followingId: viewerId },
          ],
        },
      }),
      // SOC-08: a block ends the partnership and its grants in the same
      // transaction. Leaving either side's access alive would make the block
      // look effective in lists while it still exposed training data.
      this.db.trainingPartnership.deleteMany({
        where: { pairKey: trainingPartnerPairKey(viewerId, target) },
      }),
    ]);
    return this.list(viewerId);
  }

  /**
   * Unblocking restores nothing. The follows it removed are gone, and either
   * member may follow again; silently re-following would be a relationship
   * neither of them asked for a second time.
   */
  async unblock(
    viewerId: string,
    targetIdentifier: string,
  ): Promise<BlockedMembersResponse> {
    const target = await this.resolve(targetIdentifier);
    await this.db.userBlock.deleteMany({
      where: { blockerId: viewerId, blockedId: target },
    });
    return this.list(viewerId);
  }

  /** An identifier is a uuid or a username, as everywhere else on profiles. */
  private async resolve(identifier: string): Promise<string> {
    const user = await this.db.user.findFirst({
      where: {
        OR: [{ id: identifier }, { username: identifier.toLowerCase() }],
      },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Member not found');
    return user.id;
  }
}
