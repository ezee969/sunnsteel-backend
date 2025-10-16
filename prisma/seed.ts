import { PrismaClient, MuscleGroup } from '@prisma/client';

const prisma = new PrismaClient();

type ExerciseSeed = {
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: string;
};

const exercises: ExerciseSeed[] = [
  // Chest
  {
    name: 'Bench Press',
    primaryMuscles: [MuscleGroup.PECTORAL],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS, MuscleGroup.TRICEPS],
    equipment: 'barbell',
  },
  {
    name: 'Incline Bench Press',
    primaryMuscles: [MuscleGroup.PECTORAL],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS, MuscleGroup.TRICEPS],
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Bench Press',
    primaryMuscles: [MuscleGroup.PECTORAL],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS, MuscleGroup.TRICEPS],
    equipment: 'dumbbell',
  },
  {
    name: 'Incline Dumbbell Press',
    primaryMuscles: [MuscleGroup.PECTORAL],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS, MuscleGroup.TRICEPS],
    equipment: 'dumbbell',
  },
  {
    name: 'Push-ups',
    primaryMuscles: [MuscleGroup.PECTORAL],
    secondaryMuscles: [
      MuscleGroup.ANTERIOR_DELTOIDS,
      MuscleGroup.TRICEPS,
      MuscleGroup.CORE,
    ],
    equipment: 'bodyweight',
  },
  {
    name: 'Chest Dips',
    primaryMuscles: [MuscleGroup.PECTORAL],
    secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'bodyweight',
  },
  {
    name: 'Cable Fly',
    primaryMuscles: [MuscleGroup.PECTORAL],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'cable',
  },

  // Back
  {
    name: 'Deadlift',
    primaryMuscles: [
      MuscleGroup.ERECTOR_SPINAE,
      MuscleGroup.HAMSTRINGS,
      MuscleGroup.GLUTES,
    ],
    secondaryMuscles: [
      MuscleGroup.LATISSIMUS_DORSI,
      MuscleGroup.TRAPEZIUS,
      MuscleGroup.QUADRICEPS,
    ],
    equipment: 'barbell',
  },
  {
    name: 'Pull-ups',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI],
    secondaryMuscles: [
      MuscleGroup.BICEPS,
      MuscleGroup.REAR_DELTOIDS,
      MuscleGroup.TERES_MAJOR_MINOR,
    ],
    equipment: 'bodyweight',
  },
  {
    name: 'Chin-ups',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI, MuscleGroup.BICEPS],
    secondaryMuscles: [
      MuscleGroup.REAR_DELTOIDS,
      MuscleGroup.TERES_MAJOR_MINOR,
    ],
    equipment: 'bodyweight',
  },
  {
    name: 'Bent-over Row',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI, MuscleGroup.TRAPEZIUS],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.REAR_DELTOIDS],
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Row',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI],
    secondaryMuscles: [
      MuscleGroup.BICEPS,
      MuscleGroup.REAR_DELTOIDS,
      MuscleGroup.TRAPEZIUS,
    ],
    equipment: 'dumbbell',
  },
  {
    name: 'T-Bar Row',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI, MuscleGroup.TRAPEZIUS],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.REAR_DELTOIDS],
    equipment: 'machine',
  },
  {
    name: 'Lat Pulldown',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.REAR_DELTOIDS],
    equipment: 'cable',
  },
  {
    name: 'Cable Row',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI, MuscleGroup.TRAPEZIUS],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.REAR_DELTOIDS],
    equipment: 'cable',
  },

  // Shoulders
  {
    name: 'Overhead Press',
    primaryMuscles: [
      MuscleGroup.ANTERIOR_DELTOIDS,
      MuscleGroup.MEDIAL_DELTOIDS,
    ],
    secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.CORE],
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Shoulder Press',
    primaryMuscles: [
      MuscleGroup.ANTERIOR_DELTOIDS,
      MuscleGroup.MEDIAL_DELTOIDS,
    ],
    secondaryMuscles: [MuscleGroup.TRICEPS, MuscleGroup.CORE],
    equipment: 'dumbbell',
  },
  {
    name: 'Lateral Raises',
    primaryMuscles: [MuscleGroup.MEDIAL_DELTOIDS],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'dumbbell',
  },
  {
    name: 'Front Raises',
    primaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS],
    secondaryMuscles: [MuscleGroup.MEDIAL_DELTOIDS],
    equipment: 'dumbbell',
  },
  {
    name: 'Rear Delt Fly',
    primaryMuscles: [MuscleGroup.REAR_DELTOIDS],
    secondaryMuscles: [MuscleGroup.TRAPEZIUS],
    equipment: 'dumbbell',
  },
  {
    name: 'Upright Row',
    primaryMuscles: [MuscleGroup.MEDIAL_DELTOIDS, MuscleGroup.TRAPEZIUS],
    secondaryMuscles: [MuscleGroup.BICEPS],
    equipment: 'barbell',
  },

  // Arms - Biceps
  {
    name: 'Barbell Curl',
    primaryMuscles: [MuscleGroup.BICEPS],
    secondaryMuscles: [MuscleGroup.FOREARMS],
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Curl',
    primaryMuscles: [MuscleGroup.BICEPS],
    secondaryMuscles: [MuscleGroup.FOREARMS],
    equipment: 'dumbbell',
  },
  {
    name: 'Hammer Curl',
    primaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.FOREARMS],
    secondaryMuscles: [],
    equipment: 'dumbbell',
  },
  {
    name: 'Preacher Curl',
    primaryMuscles: [MuscleGroup.BICEPS],
    secondaryMuscles: [MuscleGroup.FOREARMS],
    equipment: 'barbell',
  },
  {
    name: 'Cable Curl',
    primaryMuscles: [MuscleGroup.BICEPS],
    secondaryMuscles: [MuscleGroup.FOREARMS],
    equipment: 'cable',
  },

  // Arms - Triceps
  {
    name: 'Close-Grip Bench Press',
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [MuscleGroup.PECTORAL, MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'barbell',
  },
  {
    name: 'Tricep Dips',
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [MuscleGroup.PECTORAL, MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'bodyweight',
  },
  {
    name: 'Overhead Tricep Extension',
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [MuscleGroup.CORE],
    equipment: 'dumbbell',
  },
  {
    name: 'Tricep Pushdown',
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [],
    equipment: 'cable',
  },
  {
    name: 'Diamond Push-ups',
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [
      MuscleGroup.PECTORAL,
      MuscleGroup.ANTERIOR_DELTOIDS,
      MuscleGroup.CORE,
    ],
    equipment: 'bodyweight',
  },

  // Legs - Quadriceps
  {
    name: 'Squat',
    primaryMuscles: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondaryMuscles: [
      MuscleGroup.HAMSTRINGS,
      MuscleGroup.CORE,
      MuscleGroup.CALVES,
    ],
    equipment: 'barbell',
  },
  {
    name: 'Front Squat',
    primaryMuscles: [MuscleGroup.QUADRICEPS],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.CORE],
    equipment: 'barbell',
  },
  {
    name: 'Leg Press',
    primaryMuscles: [MuscleGroup.QUADRICEPS],
    secondaryMuscles: [MuscleGroup.GLUTES],
    equipment: 'machine',
  },
  {
    name: 'Leg Extension',
    primaryMuscles: [MuscleGroup.QUADRICEPS],
    secondaryMuscles: [],
    equipment: 'machine',
  },
  {
    name: 'Bulgarian Split Squat',
    primaryMuscles: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondaryMuscles: [
      MuscleGroup.HAMSTRINGS,
      MuscleGroup.CORE,
      MuscleGroup.CALVES,
    ],
    equipment: 'dumbbell',
  },
  {
    name: 'Lunges',
    primaryMuscles: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondaryMuscles: [
      MuscleGroup.HAMSTRINGS,
      MuscleGroup.CORE,
      MuscleGroup.CALVES,
    ],
    equipment: 'bodyweight',
  },

  // Legs - Hamstrings
  {
    name: 'Romanian Deadlift',
    primaryMuscles: [MuscleGroup.HAMSTRINGS, MuscleGroup.GLUTES],
    secondaryMuscles: [MuscleGroup.ERECTOR_SPINAE],
    equipment: 'barbell',
  },
  {
    name: 'Leg Curl',
    primaryMuscles: [MuscleGroup.HAMSTRINGS],
    secondaryMuscles: [],
    equipment: 'machine',
  },
  {
    name: 'Good Morning',
    primaryMuscles: [MuscleGroup.HAMSTRINGS, MuscleGroup.ERECTOR_SPINAE],
    secondaryMuscles: [MuscleGroup.GLUTES],
    equipment: 'barbell',
  },
  {
    name: 'Stiff Leg Deadlift',
    primaryMuscles: [MuscleGroup.HAMSTRINGS],
    secondaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.ERECTOR_SPINAE],
    equipment: 'dumbbell',
  },

  // Legs - Glutes
  {
    name: 'Hip Thrust',
    primaryMuscles: [MuscleGroup.GLUTES],
    secondaryMuscles: [MuscleGroup.HAMSTRINGS],
    equipment: 'barbell',
  },
  {
    name: 'Glute Bridge',
    primaryMuscles: [MuscleGroup.GLUTES],
    secondaryMuscles: [MuscleGroup.HAMSTRINGS, MuscleGroup.CORE],
    equipment: 'bodyweight',
  },
  {
    name: 'Sumo Deadlift',
    primaryMuscles: [MuscleGroup.GLUTES, MuscleGroup.QUADRICEPS],
    secondaryMuscles: [MuscleGroup.HAMSTRINGS, MuscleGroup.ERECTOR_SPINAE],
    equipment: 'barbell',
  },

  // Legs - Calves
  {
    name: 'Calf Raise',
    primaryMuscles: [MuscleGroup.CALVES],
    secondaryMuscles: [],
    equipment: 'bodyweight',
  },
  {
    name: 'Seated Calf Raise',
    primaryMuscles: [MuscleGroup.CALVES],
    secondaryMuscles: [],
    equipment: 'machine',
  },
  {
    name: 'Standing Calf Raise',
    primaryMuscles: [MuscleGroup.CALVES],
    secondaryMuscles: [],
    equipment: 'machine',
  },

  // Core
  {
    name: 'Plank',
    primaryMuscles: [MuscleGroup.CORE],
    secondaryMuscles: [],
    equipment: 'bodyweight',
  },
  {
    name: 'Crunches',
    primaryMuscles: [MuscleGroup.CORE],
    secondaryMuscles: [],
    equipment: 'bodyweight',
  },
  {
    name: 'Russian Twists',
    primaryMuscles: [MuscleGroup.CORE],
    secondaryMuscles: [],
    equipment: 'bodyweight',
  },
  {
    name: 'Mountain Climbers',
    primaryMuscles: [MuscleGroup.CORE],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS, MuscleGroup.QUADRICEPS],
    equipment: 'bodyweight',
  },
  {
    name: 'Dead Bug',
    primaryMuscles: [MuscleGroup.CORE],
    secondaryMuscles: [],
    equipment: 'bodyweight',
  },
  {
    name: 'Hanging Leg Raise',
    primaryMuscles: [MuscleGroup.CORE],
    secondaryMuscles: [MuscleGroup.FOREARMS],
    equipment: 'bodyweight',
  },

  // Additional Back Exercises
  {
    name: 'Chest Supported T-Bar Row',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI, MuscleGroup.TRAPEZIUS],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.REAR_DELTOIDS],
    equipment: 'machine',
  },
  {
    name: 'Neutral Grip Lat Pulldown',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.REAR_DELTOIDS],
    equipment: 'cable',
  },
  {
    name: 'Wide Grip Behind-the-Neck Pulldown',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.REAR_DELTOIDS],
    equipment: 'cable',
  },
  {
    name: 'Seated One-Arm Cable Pulldown',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI],
    secondaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.REAR_DELTOIDS],
    equipment: 'cable',
  },
  {
    name: 'One-Arm Cable Pullover',
    primaryMuscles: [MuscleGroup.LATISSIMUS_DORSI],
    secondaryMuscles: [MuscleGroup.PECTORAL],
    equipment: 'cable',
  },

  // Additional Chest Exercises
  {
    name: 'Hammer Chest Press',
    primaryMuscles: [MuscleGroup.PECTORAL],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS, MuscleGroup.TRICEPS],
    equipment: 'machine',
  },
  {
    name: 'Incline Cable Fly (Upper Chest Focus)',
    primaryMuscles: [MuscleGroup.PECTORAL],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'cable',
  },
  {
    name: 'Decline Cable Fly (Lower Chest Focus)',
    primaryMuscles: [MuscleGroup.PECTORAL],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'cable',
  },

  // Additional Shoulder Exercises
  {
    name: 'Cable Lateral Raises',
    primaryMuscles: [MuscleGroup.MEDIAL_DELTOIDS],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'cable',
  },
  {
    name: 'Dumbbell Lateral Raises',
    primaryMuscles: [MuscleGroup.MEDIAL_DELTOIDS],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'dumbbell',
  },
  {
    name: 'Chest Supported Dumbbell Lateral Raises',
    primaryMuscles: [MuscleGroup.MEDIAL_DELTOIDS],
    secondaryMuscles: [MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'dumbbell',
  },
  {
    name: 'Seated AD Press',
    primaryMuscles: [
      MuscleGroup.ANTERIOR_DELTOIDS,
      MuscleGroup.MEDIAL_DELTOIDS,
    ],
    secondaryMuscles: [MuscleGroup.TRICEPS],
    equipment: 'machine',
  },

  // Additional Triceps Exercises
  {
    name: 'Smith Machine JM Press',
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [MuscleGroup.PECTORAL, MuscleGroup.ANTERIOR_DELTOIDS],
    equipment: 'machine',
  },
  {
    name: 'Overhead Rope Triceps Extension',
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [MuscleGroup.CORE],
    equipment: 'cable',
  },
  {
    name: 'One-Arm Overhead Triceps Extension',
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [MuscleGroup.CORE],
    equipment: 'dumbbell',
  },
  {
    name: 'Seated Cable Triceps Pushdown',
    primaryMuscles: [MuscleGroup.TRICEPS],
    secondaryMuscles: [],
    equipment: 'cable',
  },

  // Additional Biceps Exercises
  {
    name: 'Incline Dumbbell Curl',
    primaryMuscles: [MuscleGroup.BICEPS],
    secondaryMuscles: [MuscleGroup.FOREARMS],
    equipment: 'dumbbell',
  },
  {
    name: 'One-Arm Machine Preacher Curl',
    primaryMuscles: [MuscleGroup.BICEPS],
    secondaryMuscles: [MuscleGroup.FOREARMS],
    equipment: 'machine',
  },
  {
    name: 'One-Arm Bayesian Curl',
    primaryMuscles: [MuscleGroup.BICEPS],
    secondaryMuscles: [MuscleGroup.FOREARMS],
    equipment: 'cable',
  },
  {
    name: 'EZ Bar Reverse Curl',
    primaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.FOREARMS],
    secondaryMuscles: [],
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Hammer Curl',
    primaryMuscles: [MuscleGroup.BICEPS, MuscleGroup.FOREARMS],
    secondaryMuscles: [],
    equipment: 'dumbbell',
  },

  // Additional Leg Exercises
  {
    name: 'Smith Machine Squat',
    primaryMuscles: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondaryMuscles: [
      MuscleGroup.HAMSTRINGS,
      MuscleGroup.CORE,
      MuscleGroup.CALVES,
    ],
    equipment: 'machine',
  },
  {
    name: 'Hack Squat',
    primaryMuscles: [MuscleGroup.QUADRICEPS],
    secondaryMuscles: [MuscleGroup.GLUTES],
    equipment: 'machine',
  },
  {
    name: 'Seated Leg Curl',
    primaryMuscles: [MuscleGroup.HAMSTRINGS],
    secondaryMuscles: [],
    equipment: 'machine',
  },
  {
    name: 'Seated Leg Extension',
    primaryMuscles: [MuscleGroup.QUADRICEPS],
    secondaryMuscles: [],
    equipment: 'machine',
  },
  {
    name: 'Dumbbell Bulgarian Split Squat',
    primaryMuscles: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondaryMuscles: [
      MuscleGroup.HAMSTRINGS,
      MuscleGroup.CORE,
      MuscleGroup.CALVES,
    ],
    equipment: 'dumbbell',
  },
];

async function main() {
  console.log('🌱 Starting seed...');

  // Upsert exercises to preserve existing IDs and maintain referential integrity
  let created = 0;
  let updated = 0;

  for (const exercise of exercises) {
    const result = await prisma.exercise.upsert({
      where: { name: exercise.name },
      update: {
        primaryMuscles: exercise.primaryMuscles,
        secondaryMuscles: exercise.secondaryMuscles,
        equipment: exercise.equipment,
      },
      create: exercise,
    });

    // Check if this was a create or update by checking if createdAt === updatedAt
    const isNew = result.createdAt.getTime() === result.updatedAt.getTime();
    if (isNew) {
      created++;
    } else {
      updated++;
    }
  }

  console.log(`✅ Seeding completed: ${created} created, ${updated} updated`);
  console.log(`📊 Total exercises: ${exercises.length}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
