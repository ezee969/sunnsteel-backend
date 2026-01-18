import {
  StartWorkoutResponse,
  WorkoutSessionStatus,
} from '@sunsteel/contracts';

export class StartWorkoutResponseDto implements StartWorkoutResponse {
  id!: string;
  routineId!: string;
  routineDayId!: string;
  status!: WorkoutSessionStatus;
  startedAt!: string;
  endedAt?: string | null;
  // Optional RtF program payload (present when routine is programmed)
  program?: {
    currentWeek: number;
    durationWeeks: number;
    withDeloads: boolean;
    isDeloadWeek: boolean;
    startDate: string;
    endDate: string;
    timeZone: string;
  };
  rtfPlans?: Array<any>;
  // Indicates whether an existing active session was reused instead of creating a new one
  reused!: boolean;
}
