import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  bodyMeasurementProblems,
  isBodyMeasurementDate,
  type BodyMeasurement,
  type BodyProgressResponse,
  type UpsertBodyMeasurementRequest,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { localDate } from '../notifications/push/local-time';
import {
  BODY_MEASUREMENT_SELECT,
  buildBodyProgress,
  columnDate,
  entryValues,
  isAllowedEntryDate,
  parseBodyProgressRange,
  toBodyMeasurement,
} from './body-measurement-rules';
import { syncCurrentWeight } from './body-weight-sync';
import { isHiddenFromViewer } from './member-blocks';
import { canViewProfileSection } from './profile-privacy';

/**
 * PROG-12: dated body weight and measurements. The owner reads and writes
 * their own; another member reads them only when the owner's `bodyProgress`
 * visibility allows it, and a refusal is the 404 a missing member gets.
 */
@Injectable()
export class BodyMeasurementsService {
  constructor(private readonly db: DatabaseService) {}

  async ownProgress(
    userId: string,
    rangeInput?: string,
  ): Promise<BodyProgressResponse> {
    const range = this.range(rangeInput);
    const owner = await this.db.user.findUnique({
      where: { id: userId },
      select: { timeZone: true },
    });
    return this.progressOf(userId, range, owner?.timeZone ?? null);
  }

  async memberProgress(
    viewerId: string | null,
    identifier: string,
    rangeInput?: string,
  ): Promise<BodyProgressResponse> {
    const range = this.range(rangeInput);
    const owner = await this.db.user.findFirst({
      where: {
        OR: [{ id: identifier }, { username: identifier.toLowerCase() }],
      },
      select: {
        id: true,
        timeZone: true,
        bodyProgressVisibility: true,
        moderationHiddenAt: true,
      },
    });
    if (!owner) throw new NotFoundException('Member not found');
    const isOwner = viewerId === owner.id;
    if (!isOwner) {
      // TRUST-04 and PROF-10: a hidden or blocked member reads as missing.
      const hidden =
        viewerId === null
          ? owner.moderationHiddenAt !== null
          : await isHiddenFromViewer(this.db, viewerId, owner.id);
      if (hidden) throw new NotFoundException('Member not found');
    }
    const isFollower =
      !isOwner &&
      viewerId !== null &&
      (await this.db.userFollow.count({
        where: { followerId: viewerId, followingId: owner.id },
      })) > 0;
    // Like body metrics, a training partner's grants never widen this.
    if (
      !canViewProfileSection(owner.bodyProgressVisibility, {
        isOwner,
        isFollower,
      })
    ) {
      throw new NotFoundException('Member not found');
    }
    return this.progressOf(owner.id, range, owner.timeZone);
  }

  async upsert(
    userId: string,
    date: string,
    input: UpsertBodyMeasurementRequest,
  ): Promise<BodyMeasurement> {
    const today = await this.todayOf(userId);
    this.assertDate(date, today);
    const problems = bodyMeasurementProblems(input);
    if (problems.length > 0) {
      throw new BadRequestException(problems.map((problem) => problem.message));
    }
    const values = entryValues(input);
    return this.db.$transaction(async (tx) => {
      const row = await tx.bodyMeasurement.upsert({
        where: { userId_date: { userId, date: columnDate(date) } },
        create: { userId, date: columnDate(date), ...values },
        update: values,
        select: BODY_MEASUREMENT_SELECT,
      });
      await syncCurrentWeight(tx, userId);
      return toBodyMeasurement(row);
    });
  }

  async remove(userId: string, date: string): Promise<void> {
    if (!isBodyMeasurementDate(date)) {
      throw new BadRequestException('Date must be YYYY-MM-DD');
    }
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.bodyMeasurement.deleteMany({
        where: { userId, date: columnDate(date) },
      });
      if (count === 0) throw new NotFoundException('No entry on that date');
      await syncCurrentWeight(tx, userId);
    });
  }

  private range(input: string | undefined) {
    const range = parseBodyProgressRange(input);
    if (!range) throw new BadRequestException('Range must be 30D, 90D, 1Y or ALL');
    return range;
  }

  private assertDate(date: string, today: string) {
    if (!isBodyMeasurementDate(date)) {
      throw new BadRequestException('Date must be YYYY-MM-DD');
    }
    if (!isAllowedEntryDate(date, today)) {
      throw new BadRequestException('An entry cannot be dated in the future');
    }
  }

  private async todayOf(userId: string): Promise<string> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { timeZone: true },
    });
    return localDate(new Date(), user?.timeZone ?? 'UTC');
  }

  private async progressOf(
    userId: string,
    range: ReturnType<BodyMeasurementsService['range']>,
    timeZone: string | null,
  ): Promise<BodyProgressResponse> {
    const rows = await this.db.bodyMeasurement.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      select: BODY_MEASUREMENT_SELECT,
    });
    return buildBodyProgress(rows, range, localDate(new Date(), timeZone ?? 'UTC'));
  }
}
