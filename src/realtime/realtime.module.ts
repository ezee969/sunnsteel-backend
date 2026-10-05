import { Module } from "@nestjs/common";
import { RealtimeController } from "./realtime.controller";
import { RealtimeService } from "./realtime.service";

/** MSG-06: the one realtime transport every live surface reads. */
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
