import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { MessagesController } from "./messages.controller";
import { MessagesService } from "./messages.service";

/** MSG-01: one-to-one conversations of text. */
@Module({
  imports: [DatabaseModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
