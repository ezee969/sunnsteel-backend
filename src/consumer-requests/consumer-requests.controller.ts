import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CONSUMER_REQUEST_DETAILS_MAX,
  CONSUMER_REQUEST_EMAIL_MAX,
  CONSUMER_REQUEST_KINDS,
  CONSUMER_REQUEST_NAME_MAX,
  CONSUMER_REQUEST_REFERENCE_MAX,
  type ConsumerRequestKind,
  type ConsumerRequestReceipt,
  type ConsumerRequestSummary,
  type ConsumerRequestsResponse,
  type CreateConsumerRequest,
} from '@sunsteel/contracts';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import { ModeratorGuard } from '../moderation/moderator.guard';
import { ConsumerRequestsService } from './consumer-requests.service';

/**
 * The body as sent. Lengths here are a loose outer bound in UTF-16 units;
 * the shared `consumerRequestProblems` decides in code points after trimming.
 */
export class CreateConsumerRequestDto implements CreateConsumerRequest {
  @IsIn(CONSUMER_REQUEST_KINDS as unknown as string[])
  kind!: ConsumerRequestKind;

  @IsString()
  @MaxLength(CONSUMER_REQUEST_NAME_MAX * 2)
  name!: string;

  @IsString()
  @MaxLength(CONSUMER_REQUEST_EMAIL_MAX)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONSUMER_REQUEST_REFERENCE_MAX * 2)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONSUMER_REQUEST_DETAILS_MAX * 2)
  details?: string;
}

/**
 * BILL-07: unguarded on purpose -- the law lets a consumer revoke or cancel
 * without signing in. The throttle is what keeps the form from being a way
 * to flood the moderators' notifications.
 */
@Controller('consumer-requests')
export class ConsumerRequestsController {
  constructor(private readonly requests: ConsumerRequestsService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ long: { limit: 5, ttl: 3_600_000 } })
  create(@Body() body: CreateConsumerRequestDto): Promise<ConsumerRequestReceipt> {
    return this.requests.create(body);
  }
}

/** BILL-07: what a moderator reads and settles; anyone else meets a 404. */
@UseGuards(SupabaseJwtGuard, ModeratorGuard)
@Controller('moderation/consumer-requests')
export class ConsumerRequestsModerationController {
  constructor(private readonly requests: ConsumerRequestsService) {}

  @Get()
  async list(): Promise<ConsumerRequestsResponse> {
    return { requests: await this.requests.list() };
  }

  @Post(':id/done')
  @HttpCode(200)
  markDone(@Param('id', ParseUUIDPipe) id: string): Promise<ConsumerRequestSummary> {
    return this.requests.markDone(id);
  }
}
