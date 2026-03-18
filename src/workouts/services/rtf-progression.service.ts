import { Injectable } from '@nestjs/common';
import { RTF_STANDARD_WITH_DELOADS, RTF_HYPERTROPHY_WITH_DELOADS } from '../rtf-schedules';

@Injectable()
export class RtfProgressionService {
  public localDateParts(d: Date, timeZone: string) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });
    const parts = fmt.formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const y = Number(get('year'));
    const m = Number(get('month'));
    const day = Number(get('day'));
    const wk = get('weekday'); // 'Sun'..'Sat'
    const map: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dow = map[wk] ?? 0;
    return { y, m, day, dow };
  }

  public diffLocalDays(a: Date, b: Date, timeZone: string) {
    const ap = this.localDateParts(a, timeZone);
    const bp = this.localDateParts(b, timeZone);
    const aUTC = Date.UTC(ap.y, ap.m - 1, ap.day);
    const bUTC = Date.UTC(bp.y, bp.m - 1, bp.day);
    return Math.floor((aUTC - bUTC) / 86_400_000);
  }

  public getCurrentProgramWeek(
    today: Date,
    programStartDate: Date,
    programDurationWeeks: number,
    timeZone: string,
  ) {
    const diffDays = this.diffLocalDays(today, programStartDate, timeZone);
    const week = Math.floor(diffDays / 7) + 1;
    if (week < 1) return 1;
    if (week > programDurationWeeks) return programDurationWeeks;
    return week;
  }

  public isDeloadWeek(week: number, withDeloads: boolean) {
    return withDeloads && (week === 7 || week === 14 || week === 21);
  }

  public getRtFGoalForWeek(
    week: number,
    withDeloads: boolean,
    variant: 'STANDARD' | 'HYPERTROPHY',
  ) {
    const source =
      variant === 'HYPERTROPHY'
        ? RTF_HYPERTROPHY_WITH_DELOADS
        : RTF_STANDARD_WITH_DELOADS;
    if (withDeloads) return source[week - 1];
    const trainingOnly = source.filter(
      (g) => !('isDeload' in g && g.isDeload === true),
    ) as Array<{
      week: number;
      intensity: number;
      fixedReps: number;
      amrapTarget: number;
    }>;
    return trainingOnly[week - 1];
  }

  public roundToNearest(value: number, increment: number): number {
    if (!increment || increment <= 0) return value;
    return Math.round(value / increment) * increment;
  }

  public adjustTM(currentTM: number, repsDone: number, targetReps: number) {
    const diff = repsDone - targetReps;
    if (diff >= 5) return currentTM * 1.03;
    if (diff === 4) return currentTM * 1.02;
    if (diff === 3) return currentTM * 1.015;
    if (diff === 2) return currentTM * 1.01;
    if (diff === 1) return currentTM * 1.005;
    if (diff === 0) return currentTM;
    if (diff === -1) return currentTM * 0.98;
    return currentTM * 0.95; // diff <= -2
  }
}
