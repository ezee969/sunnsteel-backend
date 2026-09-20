import { PrismaClient } from '@prisma/client';

/**
 * TRUST-04: grant the moderator flag to one account, named by email.
 *
 * It is a script rather than a migration because the owner's account id is
 * environment data, not schema: the same migration runs against a database
 * where that email does not exist. It is idempotent, it grants to exactly one
 * account, and it refuses rather than guessing when the email matches nothing.
 *
 *   npm run db:seed:moderator -- eze.olivero96@gmail.com
 *
 * Passing `--revoke` takes the flag away again, because the way to stop being
 * a moderator must be as ordinary as the way to become one.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const revoke = args.includes('--revoke');
  const email = args.find((arg) => !arg.startsWith('--'));

  if (!email) {
    throw new Error(
      'Usage: npm run db:seed:moderator -- <email> [--revoke]',
    );
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, username: true, isModerator: true },
    });
    if (!user) {
      throw new Error(`No account with the email ${email}`);
    }

    const isModerator = !revoke;
    if (user.isModerator === isModerator) {
      console.log(
        `@${user.username} is already ${isModerator ? 'a moderator' : 'not a moderator'}; nothing to do.`,
      );
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isModerator },
    });
    console.log(
      `@${user.username} is now ${isModerator ? 'a moderator' : 'not a moderator'}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
