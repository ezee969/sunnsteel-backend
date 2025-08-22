import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const exercises = [
  // Chest
  { name: 'Bench Press', primaryMuscle: 'chest', equipment: 'barbell' },
  { name: 'Incline Bench Press', primaryMuscle: 'chest', equipment: 'barbell' },
  {
    name: 'Dumbbell Bench Press',
    primaryMuscle: 'chest',
    equipment: 'dumbbell',
  },
  {
    name: 'Incline Dumbbell Press',
    primaryMuscle: 'chest',
    equipment: 'dumbbell',
  },
  { name: 'Push-ups', primaryMuscle: 'chest', equipment: 'bodyweight' },
  { name: 'Chest Dips', primaryMuscle: 'chest', equipment: 'bodyweight' },
  { name: 'Cable Fly', primaryMuscle: 'chest', equipment: 'cable' },

  // Back
  { name: 'Deadlift', primaryMuscle: 'back', equipment: 'barbell' },
  { name: 'Pull-ups', primaryMuscle: 'back', equipment: 'bodyweight' },
  { name: 'Chin-ups', primaryMuscle: 'back', equipment: 'bodyweight' },
  { name: 'Bent-over Row', primaryMuscle: 'back', equipment: 'barbell' },
  { name: 'Dumbbell Row', primaryMuscle: 'back', equipment: 'dumbbell' },
  { name: 'T-Bar Row', primaryMuscle: 'back', equipment: 'machine' },
  { name: 'Lat Pulldown', primaryMuscle: 'back', equipment: 'cable' },
  { name: 'Cable Row', primaryMuscle: 'back', equipment: 'cable' },

  // Shoulders
  { name: 'Overhead Press', primaryMuscle: 'shoulders', equipment: 'barbell' },
  {
    name: 'Dumbbell Shoulder Press',
    primaryMuscle: 'shoulders',
    equipment: 'dumbbell',
  },
  { name: 'Lateral Raises', primaryMuscle: 'shoulders', equipment: 'dumbbell' },
  { name: 'Front Raises', primaryMuscle: 'shoulders', equipment: 'dumbbell' },
  { name: 'Rear Delt Fly', primaryMuscle: 'shoulders', equipment: 'dumbbell' },
  { name: 'Upright Row', primaryMuscle: 'shoulders', equipment: 'barbell' },

  // Arms - Biceps
  { name: 'Barbell Curl', primaryMuscle: 'biceps', equipment: 'barbell' },
  { name: 'Dumbbell Curl', primaryMuscle: 'biceps', equipment: 'dumbbell' },
  { name: 'Hammer Curl', primaryMuscle: 'biceps', equipment: 'dumbbell' },
  { name: 'Preacher Curl', primaryMuscle: 'biceps', equipment: 'barbell' },
  { name: 'Cable Curl', primaryMuscle: 'biceps', equipment: 'cable' },

  // Arms - Triceps
  {
    name: 'Close-Grip Bench Press',
    primaryMuscle: 'triceps',
    equipment: 'barbell',
  },
  { name: 'Tricep Dips', primaryMuscle: 'triceps', equipment: 'bodyweight' },
  {
    name: 'Overhead Tricep Extension',
    primaryMuscle: 'triceps',
    equipment: 'dumbbell',
  },
  { name: 'Tricep Pushdown', primaryMuscle: 'triceps', equipment: 'cable' },
  {
    name: 'Diamond Push-ups',
    primaryMuscle: 'triceps',
    equipment: 'bodyweight',
  },

  // Legs - Quadriceps
  { name: 'Squat', primaryMuscle: 'quadriceps', equipment: 'barbell' },
  { name: 'Front Squat', primaryMuscle: 'quadriceps', equipment: 'barbell' },
  { name: 'Leg Press', primaryMuscle: 'quadriceps', equipment: 'machine' },
  { name: 'Leg Extension', primaryMuscle: 'quadriceps', equipment: 'machine' },
  {
    name: 'Bulgarian Split Squat',
    primaryMuscle: 'quadriceps',
    equipment: 'dumbbell',
  },
  { name: 'Lunges', primaryMuscle: 'quadriceps', equipment: 'bodyweight' },

  // Legs - Hamstrings
  {
    name: 'Romanian Deadlift',
    primaryMuscle: 'hamstrings',
    equipment: 'barbell',
  },
  { name: 'Leg Curl', primaryMuscle: 'hamstrings', equipment: 'machine' },
  { name: 'Good Morning', primaryMuscle: 'hamstrings', equipment: 'barbell' },
  {
    name: 'Stiff Leg Deadlift',
    primaryMuscle: 'hamstrings',
    equipment: 'dumbbell',
  },

  // Legs - Glutes
  { name: 'Hip Thrust', primaryMuscle: 'glutes', equipment: 'barbell' },
  { name: 'Glute Bridge', primaryMuscle: 'glutes', equipment: 'bodyweight' },
  { name: 'Sumo Deadlift', primaryMuscle: 'glutes', equipment: 'barbell' },

  // Legs - Calves
  { name: 'Calf Raise', primaryMuscle: 'calves', equipment: 'bodyweight' },
  { name: 'Seated Calf Raise', primaryMuscle: 'calves', equipment: 'machine' },
  {
    name: 'Standing Calf Raise',
    primaryMuscle: 'calves',
    equipment: 'machine',
  },

  // Core
  { name: 'Plank', primaryMuscle: 'core', equipment: 'bodyweight' },
  { name: 'Crunches', primaryMuscle: 'core', equipment: 'bodyweight' },
  { name: 'Russian Twists', primaryMuscle: 'core', equipment: 'bodyweight' },
  { name: 'Mountain Climbers', primaryMuscle: 'core', equipment: 'bodyweight' },
  { name: 'Dead Bug', primaryMuscle: 'core', equipment: 'bodyweight' },
  { name: 'Hanging Leg Raise', primaryMuscle: 'core', equipment: 'bodyweight' },
];

async function main() {
  console.log('🌱 Starting seed...');

  // Clear existing exercises
  await prisma.exercise.deleteMany();
  console.log('🗑️  Cleared existing exercises');

  // Insert exercises
  for (const exercise of exercises) {
    await prisma.exercise.create({
      data: exercise,
    });
  }

  console.log(`✅ Created ${exercises.length} exercises`);
  console.log('🌱 Seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
