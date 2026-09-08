import { BadRequestException } from '@nestjs/common';
import type { TrainingLocationPreferenceInput } from '@sunsteel/contracts';

export const normalizeTrainingLocations = (
  locations: TrainingLocationPreferenceInput[],
): TrainingLocationPreferenceInput[] => {
  if (locations.length > 0) {
    const defaultCount = locations.filter(location => location.isDefault).length;
    if (defaultCount !== 1) {
      throw new BadRequestException(
        'Exactly one training location must be the default.',
      );
    }
  }

  const names = new Set<string>();
  const ids = new Set<string>();

  return locations.map(location => {
    const name = location.name.trim();
    const normalizedName = name.toLocaleLowerCase('en-US');
    if (!name || names.has(normalizedName)) {
      throw new BadRequestException('Training location names must be unique.');
    }
    names.add(normalizedName);

    if (location.id) {
      if (ids.has(location.id)) {
        throw new BadRequestException('Training location ids must be unique.');
      }
      ids.add(location.id);
    }

    const plateWeights = new Set<number>();
    const availablePlatePairs = [...location.availablePlatePairs]
      .map(plate => ({
        weightKg: plate.weightKg,
        pairCount: plate.pairCount,
      }))
      .sort((a, b) => b.weightKg - a.weightKg);

    for (const plate of availablePlatePairs) {
      if (plateWeights.has(plate.weightKg)) {
        throw new BadRequestException(
          `Plate weights must be unique within ${name}.`,
        );
      }
      plateWeights.add(plate.weightKg);
    }

    return {
      ...location,
      name,
      availablePlatePairs,
      equipment: Array.from(
        new Set(
          location.equipment
            .map(item => item.trim().toLocaleLowerCase('en-US'))
            .filter(Boolean),
        ),
      ).sort(),
    };
  });
};
