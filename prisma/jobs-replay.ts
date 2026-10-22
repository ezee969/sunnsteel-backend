import { createBoss } from '../src/jobs/jobs.service';
import { deadLetterQueue } from '../src/jobs/outbox';

/**
 * PLAT-01: send a topic's dead letters back to it, the way `db:grant:plan`
 * grants a plan by hand. A message lands in `<topic>.dead` once its retries
 * run out; once the cause is fixed, this redrives it, and the consumer's
 * receipt still keeps its effect to one.
 *
 *   npm run jobs:replay -- <topic> [--preview] [--limit=100]
 *
 * `--preview` says how many would move and changes nothing. Without a limit at
 * most 1000 move per run, oldest first.
 */
function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const topic = args.find((arg) => !arg.startsWith('--'));
  if (!topic) throw new Error('Usage: npm run jobs:replay -- <topic> [--preview] [--limit=N]');
  const limitText = option(args, 'limit');
  const limit = limitText === undefined ? undefined : Number(limitText);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit takes a whole number');
  }

  const dead = deadLetterQueue(topic);
  const boss = createBoss({ supervise: false, schedule: false, max: 1 });
  await boss.start();
  try {
    if (!(await boss.getQueue(dead))) {
      console.log(`${dead} does not exist: nothing of ${topic} has been dead-lettered`);
      return;
    }
    if (args.includes('--preview')) {
      const preview = await boss.previewRedrive(dead, { destination: topic, limit });
      console.log(`${preview.total} dead letter(s) in ${dead} would go back to ${topic}`);
      return;
    }
    const moved = await boss.redrive(dead, { destination: topic, limit });
    console.log(`Sent ${moved} dead letter(s) from ${dead} back to ${topic}`);
  } finally {
    await boss.stop({ graceful: false });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
