const { PrismaClient } = require('@prisma/client');

async function getExercises() {
  const prisma = new PrismaClient();
  
  try {
    const exercises = await prisma.exercise.findMany({
      where: {
        name: {
          in: ['Bench Press', 'Lateral Raises', 'Squat']
        }
      },
      select: {
        id: true,
        name: true
      }
    });
    
    console.log(JSON.stringify(exercises, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

getExercises();