import {
  IsIn,
  IsUUID,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import {
  ACHIEVEMENT_DEFINITIONS,
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

/** MSG-12: a milestone is named by its catalog id (`sessions:10`). */
const ACHIEVEMENT_IDS = ACHIEVEMENT_DEFINITIONS.map(({ id }) => id);

/** MSG-13: a comeback's id names its two completion events. */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const COMEBACK_ID = new RegExp(`^comeback:${UUID}:${UUID}:v1$`);

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

  /** MSG-10: one of the sender's own finished workouts. */
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  /** MSG-11: one of the sender's own personal records, by its event. */
  @IsOptional()
  @IsUUID()
  recordEventId?: string;

  /** MSG-12: one of the sender's own earned milestones, by its id. */
  @IsOptional()
  @IsIn(ACHIEVEMENT_IDS)
  achievementId?: string;

  /** MSG-13: one of the sender's own comebacks, by its recognition id. */
  @IsOptional()
  @Matches(COMEBACK_ID)
  comebackId?: string;
}

export class SendMessageDto implements SendMessageRequest {
  @IsOptional()
  @IsString()
  @MaxLength(BODY_REQUEST_MAX)
  body?: string;

  @IsOptional()
  @IsUUID()
  routineId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  /** MSG-11: one of the sender's own personal records, by its event. */
  @IsOptional()
  @IsUUID()
  recordEventId?: string;

  /** MSG-12: one of the sender's own earned milestones, by its id. */
  @IsOptional()
  @IsIn(ACHIEVEMENT_IDS)
  achievementId?: string;

  /** MSG-13: one of the sender's own comebacks, by its recognition id. */
  @IsOptional()
  @Matches(COMEBACK_ID)
  comebackId?: string;
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
