import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  PlatePairInventory,
  TrainingLocationPreference,
  TrainingLocationPreferenceInput,
} from '@sunsteel/contracts';
import { Prisma } from '@prisma/client';

import { DatabaseService } from '../database/database.service';
import { normalizeTrainingLocations } from './training-location-preferences.logic';

const trainingLocationSelect = {
  id: true,
  name: true,
  isDefault: true,
  barWeightKg: true,
  availablePlatePairs: true,
  equipment: true,
  createdAt: true,
  updatedAt: true,
} as const;

type TrainingLocationRecord = Prisma.TrainingLocationPreferenceGetPayload<{
  select: typeof trainingLocationSelect;
}>;

const mapTrainingLocation = (
  location: TrainingLocationRecord,
): TrainingLocationPreference => ({
  ...location,
  availablePlatePairs:
    location.availablePlatePairs as unknown as PlatePairInventory[],
  createdAt: location.createdAt.toISOString(),
  updatedAt: location.updatedAt.toISOString(),
});

@Injectable()
export class TrainingLocationPreferencesService {
  constructor(private readonly db: DatabaseService) {}

  async list(userId: string): Promise<TrainingLocationPreference[]> {
    const locations = await this.db.trainingLocationPreference.findMany({
      where: { userId },
      select: trainingLocationSelect,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return locations.map(mapTrainingLocation);
  }

  async replace(
    userId: string,
    input: TrainingLocationPreferenceInput[],
  ): Promise<TrainingLocationPreference[]> {
    const locations = normalizeTrainingLocations(input);
    const incomingIds = locations.flatMap(location =>
      location.id ? [location.id] : [],
    );

    return this.db.$transaction(async transaction => {
      if (incomingIds.length > 0) {
        const ownedCount = await transaction.trainingLocationPreference.count({
          where: { userId, id: { in: incomingIds } },
        });
        if (ownedCount !== incomingIds.length) {
          throw new BadRequestException(
            'One or more training locations do not belong to this account.',
          );
        }
      }

      await transaction.trainingLocationPreference.deleteMany({
        where: {
          userId,
          ...(incomingIds.length > 0 ? { id: { notIn: incomingIds } } : {}),
        },
      });

      for (const location of locations.filter(location => location.id)) {
        await transaction.trainingLocationPreference.update({
          where: { id: location.id },
          data: { name: `__pref_update__${location.id}` },
        });
      }

      for (const location of locations) {
        const data = {
          name: location.name,
          isDefault: location.isDefault,
          barWeightKg: location.barWeightKg,
          availablePlatePairs:
            location.availablePlatePairs as unknown as Prisma.InputJsonValue,
          equipment: location.equipment,
        };

        if (location.id) {
          await transaction.trainingLocationPreference.update({
            where: { id: location.id },
            data,
          });
        } else {
          await transaction.trainingLocationPreference.create({
            data: { ...data, userId },
          });
        }
      }

      const saved = await transaction.trainingLocationPreference.findMany({
        where: { userId },
        select: trainingLocationSelect,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
      return saved.map(mapTrainingLocation);
    });
  }
}
