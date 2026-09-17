import { Injectable, NotFoundException } from '@nestjs/common';
import {
  REST_ALERT_MAX_LEAD_SECONDS,
  REST_ALERT_MIN_LEAD_SECONDS,
  type RestAlertPushPayload,
  type ScheduleRestAlertRequest,
  type ScheduleRestAlertResponse,
} from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import { localMinuteOfDay } from './local-time';
import {
  NotificationPreferencesService,
  suppressionFor,
} from './notification-preferences.service';
import { PushConfigService } from './push-config.service';
import { ScheduledPushService } from './scheduled-push.service';

const EXERCISE_NAME_MAX = 60;

/** One pending alert per session; the key is what makes that true. */
export const restAlertKey = (sessionId: string) => `rest:${sessionId}`;

/**
 * NOTIF-03. The alert is a notification, never the in-app tone: `LIVE-01`
 * synthesises that tone with WebAudio inside the page, and a backgrounded or
 * locked PWA has its audio context suspended and its timers throttled. Only
 * the OS can make a sound then, which means a push.
 *
 * The body is a static line by necessity — the Web Notifications API has no
 * chronometer field, so nothing here promises a countdown.
 */
@Injectable()
export class RestAlertService {
  constructor(
    private readonly db: DatabaseService,
    private readonly scheduled: ScheduledPushService,
    private readonly config: PushConfigService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  async schedule(
    userId: string,
    sessionId: string,
    input: ScheduleRestAlertRequest,
  ): Promise<ScheduleRestAlertResponse> {
    await this.assertOwnedActiveSession(userId, sessionId);

    if (!this.config.isConfigured) {
      return { scheduledFor: null, reason: 'PUSH_UNAVAILABLE' };
    }

    const subscriptions = await this.db.pushSubscription.count({
      where: { userId },
    });
    if (subscriptions === 0) {
      // Not an error: most accounts never grant permission, and the session
      // screen keeps its in-app tone either way.
      return { scheduledFor: null, reason: 'NO_SUBSCRIPTION' };
    }

    const endsAt = new Date(input.endsAt);

    // NOTIF-05: refuse now with the real reason rather than accepting and
    // dropping it at send, so the session screen never implies an alert the
    // owner has switched off or silenced.
    const preferences = await this.preferences.forDelivery(userId);
    const suppressed = suppressionFor(
      'REST_ALERT',
      preferences,
      endsAt,
      localMinuteOfDay,
    );
    if (suppressed) {
      await this.scheduled.cancel(userId, restAlertKey(sessionId));
      return { scheduledFor: null, reason: suppressed };
    }

    const leadSeconds = (endsAt.getTime() - Date.now()) / 1000;
    if (leadSeconds < REST_ALERT_MIN_LEAD_SECONDS) {
      // Closer than the sweep resolution: the page's own tone is still the
      // faster channel, so claiming a push here would be a false promise.
      await this.scheduled.cancel(userId, restAlertKey(sessionId));
      return { scheduledFor: null, reason: 'TOO_SOON' };
    }
    if (leadSeconds > REST_ALERT_MAX_LEAD_SECONDS) {
      return { scheduledFor: null, reason: 'TOO_SOON' };
    }

    const exerciseName =
      input.exerciseName.trim().slice(0, EXERCISE_NAME_MAX) || 'Your next set';
    const payload: RestAlertPushPayload = {
      kind: 'REST_ALERT',
      title: 'Rest is over',
      body: `${exerciseName} is up next.`,
      sessionId,
      url: `/workouts/sessions/${sessionId}`,
      tag: `rest-${sessionId}`,
    };

    await this.scheduled.schedule({
      userId,
      dedupeKey: restAlertKey(sessionId),
      sessionId,
      sendAt: endsAt,
      payload,
    });
    return { scheduledFor: endsAt.toISOString(), reason: null };
  }

  async cancel(userId: string, sessionId: string): Promise<void> {
    await this.assertOwnedActiveSession(userId, sessionId);
    await this.scheduled.cancel(userId, restAlertKey(sessionId));
  }

  private async assertOwnedActiveSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.db.workoutSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Workout session not found');
  }
}
