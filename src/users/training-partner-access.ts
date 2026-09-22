import type { TrainingPartnerPermissions } from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';

export const NO_TRAINING_PARTNER_PERMISSIONS: TrainingPartnerPermissions = {
  schedule: false,
  progress: false,
  activity: false,
  routines: false,
  encouragement: false,
};

export const trainingPartnerPairKey = (a: string, b: string): string =>
  [a, b].sort().join(':');

/**
 * SOC-08. What the profile owner explicitly grants this viewer through an
 * active partnership. Missing, pending and ended relationships grant nothing.
 */
export async function trainingPartnerPermissions(
  db: DatabaseService,
  viewerId: string | null,
  ownerId: string,
): Promise<TrainingPartnerPermissions> {
  if (!viewerId || viewerId === ownerId) {
    return { ...NO_TRAINING_PARTNER_PERMISSIONS };
  }
  // Focused service tests provide only the Prisma delegates their subject
  // uses. The real DatabaseService always has this generated delegate; an old
  // test double means no partnership, never implicit access.
  const grants = (db as Partial<DatabaseService>).trainingPartnerGrant;
  if (!grants) return { ...NO_TRAINING_PARTNER_PERMISSIONS };
  const grant = await grants.findFirst({
    where: {
      grantorId: ownerId,
      partnership: {
        status: 'ACTIVE',
        OR: [
          { requesterId: viewerId, recipientId: ownerId },
          { requesterId: ownerId, recipientId: viewerId },
        ],
      },
    },
    select: {
      schedule: true,
      progress: true,
      activity: true,
      routines: true,
      encouragement: true,
    },
  });
  return grant ?? { ...NO_TRAINING_PARTNER_PERMISSIONS };
}
