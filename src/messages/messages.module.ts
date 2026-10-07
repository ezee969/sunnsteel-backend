import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { WorkoutSessionRecapService } from "../workouts/services/workout-session-recap.service";
import { MessagesController } from "./messages.controller";
import { MessagesService } from "./messages.service";

/** MSG-01: one-to-one conversations of text. */
@Module({
  imports: [DatabaseModule],
  controllers: [MessagesController],
  // MSG-10: a shared workout's records are its owner's recap, as SOC-07's are.
  providers: [MessagesService, WorkoutSessionRecapService],
})
export class MessagesModule {}
