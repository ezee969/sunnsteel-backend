import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SupabaseJwtGuard } from "../auth/guards/supabase-jwt.guard";
import type { RequestWithUser } from "../common/types/request-with-user";
import {
  PageQueryDto,
  SendMessageDto,
  StartConversationDto,
} from "./dto/messages.dto";
import { MessagesService } from "./messages.service";

/** MSG-01: the signed-in member's conversations. */
@UseGuards(SupabaseJwtGuard)
@Controller("conversations")
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(@Req() req: RequestWithUser, @Query() query: PageQueryDto) {
    return this.messages.list(req.user.id, query.cursor);
  }

  @Post()
  start(@Req() req: RequestWithUser, @Body() dto: StartConversationDto) {
    return this.messages.start(req.user.id, dto);
  }

  @Get(":id/messages")
  read(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.messages.messages(req.user.id, id, query.cursor);
  }

  @Post(":id/messages")
  send(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.send(req.user.id, id, dto);
  }

  @Delete(":id/messages/:messageId")
  deleteMessage(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("messageId", ParseUUIDPipe) messageId: string,
  ) {
    return this.messages.deleteMessage(req.user.id, id, messageId);
  }

  @Delete(":id")
  @HttpCode(204)
  async deleteConversation(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.messages.deleteConversation(req.user.id, id);
  }
}
