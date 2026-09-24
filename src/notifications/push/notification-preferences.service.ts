import { Injectable } from '@nestjs/common';
import {
  MINUTES_IN_DAY,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferences,
  type NotificationPreferencesResponse,
  type QuietHours,
  type UpdateNotificationPreferencesRequest,
  isWithinQuietHours,
} from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import { PushConfigService } from './push-config.service';

const PREFERENCE_SELECT = {
  notifyRestAlert: true,
  notifyTrainingReminder: true,
  notifyStreakAtRisk: true,
  notifyPartnerSession: true,
  notifyPartnerAchievement: true,
  quietHoursStartMinute: true,
  quietHoursEndMinute: true,
  reminderMinuteOfDay: true,
  timeZone: true,
} as const;

type PreferenceRow = {
  notifyRestAlert: boolean;
  notifyTrainingReminder: boolean;
  notifyStreakAtRisk: boolean;
  notifyPartnerSession: boolean;
  notifyPartnerAchievement: boolean;
  quietHoursStartMinute: number | null;
  quietHoursEndMinute: number | null;
  reminderMinuteOfDay: number | null;
  timeZone: string | null;
};

export function mapPreferences(row: PreferenceRow): NotificationPreferences {
  const quietHours: QuietHours | null =
    row.quietHoursStartMinute !== null && row.quietHoursEndMinute !== null
      ? {
          startMinute: row.quietHoursStartMinute,
          endMinute: row.quietHoursEndMinute,
        }
      : null;

  return {
    categories: {
      REST_ALERT: row.notifyRestAlert,
      TRAINING_REMINDER: row.notifyTrainingReminder,
      STREAK_AT_RISK: row.notifyStreakAtRisk,
      TRAINING_PARTNER_SESSION: row.notifyPartnerSession,
      TRAINING_PARTNER_ACHIEVEMENT: row.notifyPartnerAchievement,
    },
    quietHours,
    reminder: { minuteOfDay: row.reminderMinuteOfDay },
    timeZone: row.timeZone,
  };
}

/**
 * NOTIF-05. The switches every delivered notification is checked against.
 *
 * Nothing here decides what a category means; it stores the owner's answer and
 * `suppression` applies it. Both the rest alert and the reminder ask the same
 * question, so the rule lives in one place rather than at each call site.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: PushConfigService,
  ) {}

  async read(userId: string): Promise<NotificationPreferencesResponse> {
    const [row, subscriptions] = await Promise.all([
      this.db.user.findUniqueOrThrow({
        where: { id: userId },
        select: PREFERENCE_SELECT,
      }),
      this.db.pushSubscription.count({ where: { userId } }),
    ]);

    return {
      preferences: mapPreferences(row),
      // A category left on while nothing is subscribed would otherwise read as
      // working, so the state travels with the preferences.
      hasSubscribedDevice: subscriptions > 0,
      pushAvailable: this.config.isConfigured,
    };
  }

  async update(
    userId: string,
    input: UpdateNotificationPreferencesRequest,
    now = new Date(),
  ): Promise<NotificationPreferencesResponse> {
    const data: Record<string, unknown> = {};
    const changesPartnerSession =
      input.categories?.TRAINING_PARTNER_SESSION !== undefined;
    const changesPartnerAchievement =
      input.categories?.TRAINING_PARTNER_ACHIEVEMENT !== undefined;
    const current =
      changesPartnerSession || changesPartnerAchievement
        ? await this.db.user.findUniqueOrThrow({
            where: { id: userId },
            select: {
              notifyPartnerSession: true,
              notifyPartnerAchievement: true,
            },
          })
        : null;

    if (input.categories?.REST_ALERT !== undefined) {
      data.notifyRestAlert = input.categories.REST_ALERT;
    }
    if (input.categories?.TRAINING_REMINDER !== undefined) {
      data.notifyTrainingReminder = input.categories.TRAINING_REMINDER;
    }
    if (input.categories?.STREAK_AT_RISK !== undefined) {
      data.notifyStreakAtRisk = input.categories.STREAK_AT_RISK;
    }
    if (changesPartnerSession && current) {
      const enabled = input.categories!.TRAINING_PARTNER_SESSION!;
      data.notifyPartnerSession = enabled;
      if (!enabled) data.partnerSessionAlertsEnabledAt = null;
      else if (!current.notifyPartnerSession) {
        data.partnerSessionAlertsEnabledAt = now;
      }
    }
    if (changesPartnerAchievement && current) {
      const enabled = input.categories!.TRAINING_PARTNER_ACHIEVEMENT!;
      data.notifyPartnerAchievement = enabled;
      if (!enabled) data.partnerAchievementAlertsEnabledAt = null;
      else if (!current.notifyPartnerAchievement) {
        data.partnerAchievementAlertsEnabledAt = now;
      }
    }
    // Omitting quiet hours leaves the stored window alone; sending null clears
    // it. The two are different intents and must not collapse into one.
    if (input.quietHours !== undefined) {
      data.quietHoursStartMinute = input.quietHours?.startMinute ?? null;
      data.quietHoursEndMinute = input.quietHours?.endMinute ?? null;
    }
    if (input.reminder !== undefined) {
      data.reminderMinuteOfDay = input.reminder.minuteOfDay;
    }

    if (Object.keys(data).length > 0) {
      await this.db.user.update({ where: { id: userId }, data });
    }

    // Turning a category off must not leave an already-scheduled push waiting
    // to fire: the owner's next notification would arrive after they switched
    // it off, which reads as the control not working.
    await Promise.all([
      this.dropSuppressedPending(userId, input),
      this.dropDisabledPartnerNotifications(userId, input),
    ]);

    return this.read(userId);
  }

  private async dropDisabledPartnerNotifications(
    userId: string,
    input: UpdateNotificationPreferencesRequest,
  ): Promise<void> {
    const kinds: (
      | 'TRAINING_PARTNER_SESSION'
      | 'TRAINING_PARTNER_ACHIEVEMENT'
    )[] = [];
    if (input.categories?.TRAINING_PARTNER_SESSION === false) {
      kinds.push('TRAINING_PARTNER_SESSION');
    }
    if (input.categories?.TRAINING_PARTNER_ACHIEVEMENT === false) {
      kinds.push('TRAINING_PARTNER_ACHIEVEMENT');
    }
    if (kinds.length === 0) return;
    await this.db.notification.deleteMany({
      where: { userId, kind: { in: kinds } },
    });
  }

  private async dropSuppressedPending(
    userId: string,
    input: UpdateNotificationPreferencesRequest,
  ): Promise<void> {
    const prefixes: string[] = [];
    if (input.categories?.REST_ALERT === false) prefixes.push('rest:');
    if (
      input.categories?.TRAINING_REMINDER === false ||
      input.categories?.STREAK_AT_RISK === false ||
      input.reminder?.minuteOfDay === null
    ) {
      // Both categories share the one pending row per local date, so either
      // being switched off must drop whichever is waiting.
      prefixes.push('reminder:');
    }
    if (prefixes.length === 0) return;

    await this.db.scheduledPush.deleteMany({
      where: {
        userId,
        OR: prefixes.map((prefix) => ({ dedupeKey: { startsWith: prefix } })),
      },
    });
  }

  /** The preferences a sender needs, without the delivery state around them. */
  async forDelivery(userId: string): Promise<NotificationPreferences> {
    const row = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: PREFERENCE_SELECT,
    });
    return mapPreferences(row);
  }
}

/** Why a notification was not delivered, or null when it may go out. */
export type SuppressionReason = 'CATEGORY_OFF' | 'QUIET_HOURS';

/**
 * The one place a category switch and a quiet window are applied. `at` is the
 * moment the notification would arrive, not the moment it was scheduled: a
 * rest alert set before quiet hours begin still lands inside them.
 */
export function suppressionFor(
  category: NotificationCategory,
  preferences: NotificationPreferences,
  at: Date,
  localMinuteOf: (date: Date, timeZone: string) => number,
): SuppressionReason | null {
  if (!preferences.categories[category]) return 'CATEGORY_OFF';
  if (!preferences.quietHours || !preferences.timeZone) return null;

  const minute = localMinuteOf(at, preferences.timeZone) % MINUTES_IN_DAY;
  return isWithinQuietHours(minute, preferences.quietHours)
    ? 'QUIET_HOURS'
    : null;
}

export const ALL_CATEGORIES = NOTIFICATION_CATEGORIES;
