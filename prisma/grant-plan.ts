import { EntitlementSource, PrismaClient } from '@prisma/client';
import { isPlanId, planFromGrants } from '@sunsteel/contracts';
import { grantPlan, grantWindows, revokePlan } from '../src/billing/entitlement-grants';

/**
 * BILL-01: grant or revoke a plan for one account, named by email, the way
 * `db:seed:moderator` grants the moderator flag. It writes through the same
 * functions the product will, so a grant given by hand replaces that source's
 * last one exactly as any other grant does.
 *
 *   npm run db:grant:plan -- <email> [--plan=PRO] [--days=30 | --until=2026-12-31]
 *                                    [--source=ADMIN|PROMO] [--note="Founding member"]
 *   npm run db:grant:plan -- <email> --revoke [--source=ADMIN|PROMO|SUBSCRIPTION|ALL]
 *
 * Without `--days` or `--until` a grant never expires. The source defaults to
 * ADMIN; a SUBSCRIPTION grant is the provider's to give and is refused here.
 */
function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function expiry(args: string[]): Date | null {
  const days = option(args, 'days');
  const until = option(args, 'until');
  if (days !== undefined && until !== undefined) {
    throw new Error('Pass --days or --until, not both');
  }
  if (days !== undefined) {
    const count = Number(days);
    if (!Number.isInteger(count) || count < 1) throw new Error('--days takes a whole number of days');
    return new Date(Date.now() + count * 24 * 60 * 60 * 1000);
  }
  if (until !== undefined) {
    const date = new Date(until);
    if (Number.isNaN(date.getTime())) throw new Error('--until takes a date, such as 2026-12-31');
    return date;
  }
  return null;
}

function sourceOf(value: string | undefined, revoking: boolean): EntitlementSource | null {
  if (value === undefined) return EntitlementSource.ADMIN;
  if (revoking && value === 'ALL') return null;
  if (!(value in EntitlementSource)) throw new Error(`Unknown source ${value}`);
  const source = value as EntitlementSource;
  if (!revoking && source === EntitlementSource.SUBSCRIPTION) {
    throw new Error('A subscription grant comes from the payment provider, not from this script');
  }
  return source;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = args.find((arg) => !arg.startsWith('--'));
  const revoking = args.includes('--revoke');
  if (!email) {
    throw new Error('Usage: npm run db:grant:plan -- <email> [--plan=PRO] [--days=N | --until=DATE] [--source=ADMIN|PROMO] [--note=TEXT] [--revoke]');
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, username: true },
    });
    if (!user) throw new Error(`No account with the email ${email}`);
    const source = sourceOf(option(args, 'source'), revoking);

    if (revoking) {
      const count = await revokePlan(prisma, user.id, source);
      console.log(`Revoked ${count} open ${source ?? 'any'} grant(s) of @${user.username}.`);
    } else {
      const planId = option(args, 'plan') ?? 'PRO';
      if (!isPlanId(planId)) throw new Error(`Unknown plan ${planId}`);
      const grant = await grantPlan(prisma, {
        userId: user.id,
        planId,
        source: source ?? EntitlementSource.ADMIN,
        expiresAt: expiry(args),
        note: option(args, 'note') ?? null,
      });
      console.log(
        `Granted ${grant.planId} to @${user.username} (${grant.source}, ${grant.expiresAt ? `until ${grant.expiresAt.toISOString()}` : 'no expiry'}).`,
      );
    }

    const open = await prisma.entitlementGrant.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    console.log(`@${user.username} is now on ${planFromGrants(grantWindows(open))}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
