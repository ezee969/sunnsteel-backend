import { Injectable, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import {
  REPORTS_PER_DAY_MAX,
  type CreateReportRequest,
  type CreateReportResponse,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';

/**
 * PROF-10's report path. A report is **recorded and acknowledged, not acted
 * on**: `TRUST-04` owns the queue, the review actions and the enforcement
 * record. Nothing here reads these rows, which is exactly why the response
 * says only that the report was filed.
 */
@Injectable()
export class MemberReportsService {
  constructor(private readonly db: DatabaseService) {}

  async create(
    reporterId: string,
    request: CreateReportRequest,
  ): Promise<CreateReportResponse> {
    const subjectId = request.subjectId.trim();
    if (!subjectId) throw new NotFoundException('Subject not found');

    // The subject must exist, so the queue TRUST-04 builds is not seeded with
    // reports about nothing. A session share is checked by its token, because
    // that is the only identity a reader of one ever has.
    await this.assertSubjectExists(request.subjectKind, subjectId);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.db.memberReport.count({
      where: { reporterId, createdAt: { gte: since } },
    });
    if (recent >= REPORTS_PER_DAY_MAX) {
      throw new HttpException(
        `You can file at most ${REPORTS_PER_DAY_MAX} reports a day.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const report = await this.db.memberReport.create({
      data: {
        reporterId,
        subjectKind: request.subjectKind,
        subjectId,
        reason: request.reason,
        details: request.details?.trim() || null,
      },
      select: { id: true, createdAt: true },
    });
    return { id: report.id, createdAt: report.createdAt.toISOString() };
  }

  private async assertSubjectExists(
    kind: CreateReportRequest['subjectKind'],
    subjectId: string,
  ): Promise<void> {
    // A switch rather than a chain of ternaries: the previous shape had an
    // unnamed final branch, so SOC-06's `COMMENT` silently fell through to the
    // session-share lookup and every comment report answered 404. A switch
    // over the union makes the compiler name the next kind that is added.
    const found = await this.countSubject(kind, subjectId);
    if (!found) throw new NotFoundException('Subject not found');
  }

  private countSubject(
    kind: CreateReportRequest['subjectKind'],
    subjectId: string,
  ): Promise<number> {
    switch (kind) {
      case 'MEMBER':
        return this.db.user.count({
          where: {
            OR: [{ id: subjectId }, { username: subjectId.toLowerCase() }],
          },
        });
      case 'ROUTINE':
        return this.db.routine.count({ where: { id: subjectId } });
      case 'SESSION':
        return this.db.sessionShare.count({ where: { token: subjectId } });
      case 'COMMENT':
        return this.db.activityComment.count({ where: { id: subjectId } });
    }
  }
}
