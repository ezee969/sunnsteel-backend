import {
  IsIn,
  IsUUID,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import {
  CONVERSATION_BOXES,
  type ConversationBox,
  MESSAGE_BODY_MAX,
  MESSAGE_PERMISSIONS,
  type MarkConversationReadRequest,
  type MessagePermission,
  type SendMessageRequest,
  type StartConversationRequest,
  type UpdateMessagePermissionRequest,
} from "@sunsteel/contracts";

/**
 * A body may arrive longer than `MESSAGE_BODY_MAX` UTF-16 units and still be
 * within the limit -- an emoji is two units and one character -- so the DTO
 * only bounds the request, and `normalizeMessageBody` refuses with a code.
 */
const BODY_REQUEST_MAX = MESSAGE_BODY_MAX * 2 + 200;

export class StartConversationDto implements StartConversationRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  recipient!: string;

  /** MSG-07: optional beside a routine; the service refuses an empty message. */
  @IsOptional()
  @IsString()
  @MaxLength(BODY_REQUEST_MAX)
  body?: string;

  @IsOptional()
  @IsUUID()
  routineId?: string;
}

export class SendMessageDto implements SendMessageRequest {
  @IsOptional()
  @IsString()
  @MaxLength(BODY_REQUEST_MAX)
  body?: string;

  @IsOptional()
  @IsUUID()
  routineId?: string;
}

export class PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export class UpdateMessagePermissionDto implements UpdateMessagePermissionRequest {
  @IsIn(MESSAGE_PERMISSIONS)
  messagePermission!: MessagePermission;
}

/** MSG-03: the newest message the reader has on screen. */
export class MarkConversationReadDto implements MarkConversationReadRequest {
  @IsUUID()
  through!: string;
}

/** MSG-02: the inbox, or the requests waiting for the viewer. */
export class ListConversationsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(CONVERSATION_BOXES as unknown as string[])
  box?: ConversationBox;
}
