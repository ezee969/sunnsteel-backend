import { WorkoutSessionStatus } from '@prisma/client';

export class StartWorkoutResponseDto {
  id!: string;
  routineId!: string;
  routineDayId!: string;
  status!: WorkoutSessionStatus;
  startedAt!: Date;
  endedAt?: Date | null;
  // Optional RtF program payload (present when routine is programmed)
  program?: {
    currentWeek: number;
    durationWeeks: number;
    withDeloads: boolean;
    isDeloadWeek: boolean;
    startDate: Date;
    endDate: Date;
    timeZone: string;
  };
  rtfPlans?: Array<any>;
  // Indicates whether an existing active session was reused instead of creating a new one
  reused!: boolean;
}
