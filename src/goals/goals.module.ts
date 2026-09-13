import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { MeasurableGoalsService } from "./measurable-goals.service";

@Module({
  imports: [DatabaseModule],
  providers: [MeasurableGoalsService],
  exports: [MeasurableGoalsService],
})
export class GoalsModule {}
