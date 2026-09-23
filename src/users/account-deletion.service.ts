import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  matchesDeletionConfirmation,
  type DeleteAccountResponse,
} from '@sunsteel/contracts';
import { SupabaseService } from '../auth/supabase.service';
import { DatabaseService } from '../database/database.service';

/**
 * How long the deletion transaction may stay open. It holds the account's row
 * lock across the Supabase call, which normally takes a few hundred
 * milliseconds; past this Prisma rolls back and nothing is deleted.
 */
const DELETION_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * TRUST-01. Deleting an account is immediate and complete.
 *
 * The order is what makes a failure safe. Stored avatars go first: if that
 * fails nothing else has happened, and if a later step fails the member has
 * only lost a picture. Then one transaction deletes the local account -- every
 * row the member owns cascades from it -- and, before committing, the Supabase
 * sign-in. If Supabase refuses, the transaction rolls back and the account is
 * exactly as it was. If Supabase succeeds and the commit then fails, the
 * member's unexpired token still resolves this account (the lookup hits), so
 * repeating the request finishes the job; `deleteAuthUser` treats an already
 * removed sign-in as removed for exactly that reason.
 *
 * What stays is what was never the member's to take: a routine someone else
 * cloned is theirs, and keeps only "original unavailable" (`SET NULL`).
 * Reports the member filed go with the account, as their personal data; the
 * moderation record keeps its rows, which name subjects by id.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly supabase: SupabaseService,
  ) {}

  async deleteAccount(
    userId: string,
    confirmUsername: string,
  ): Promise<DeleteAccountResponse> {
    // Read fresh rather than from the request: the moderator flag in
    // particular must be the stored one, as `ModeratorGuard` reads it.
    const account = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        isModerator: true,
        supabaseUserId: true,
      },
    });
    if (!account) throw new NotFoundException('Account not found');
    if (!matchesDeletionConfirmation(confirmUsername, account.username)) {
      throw new BadRequestException(
        'Type your username exactly as it appears to confirm.',
      );
    }
    // The moderation record is append-only and every row names its
    // moderator; deleting that member would cascade the record away.
    if (account.isModerator) {
      throw new ConflictException(
        'A moderator account cannot be deleted while it holds moderator access.',
      );
    }

    await this.supabase.removeStoredAvatars(account.supabaseUserId);

    await this.db.$transaction(
      async (tx) => {
        await tx.user.delete({ where: { id: account.id } });
        if (account.supabaseUserId) {
          await this.supabase.deleteAuthUser(account.supabaseUserId);
        }
      },
      { timeout: DELETION_TRANSACTION_TIMEOUT_MS },
    );

    this.logger.log(`Deleted account ${account.id}`);
    return { deletedAt: new Date().toISOString() };
  }
}
