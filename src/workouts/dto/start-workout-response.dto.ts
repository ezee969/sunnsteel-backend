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
  // Indicates whether an existing active session was reused instead of creating a new one
  reused!: boolean;
}
