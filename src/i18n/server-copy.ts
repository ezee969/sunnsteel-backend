import {
  type AppLocale,
  DEFAULT_LOCALE,
  isAppLocale,
} from "@sunsteel/contracts";

import type { DatabaseService } from "../database/database.service";

/**
 * I18N-06: the words the server writes with nobody's page open -- push
 * notifications and the account export's `omitted` list. Everything a page renders is translated in the frontend; only
 * what leaves this process as finished text lives here. English is the source
 * and the fallback, and every other language must hold the same keys (the
 * type enforces it).
 */
interface ServerCopy {
  restOverTitle: string;
  restNextBody: (exercise: string) => string;
  restNextFallback: string;
  streakTitle: string;
  streakBody: (runDays: number, daysSince: number) => string;
  trainingDayTitle: string;
  trainingDayBody: (routines: string[]) => string;
  partnerSessionTitle: (name: string) => string;
  partnerAchievementTitle: (name: string) => string;
  workoutFallback: string;
  achievementFallback: string;
  /** EXPORT-01: what the export leaves out on purpose, and why. */
  exportOmitted: readonly string[];
}

const englishList = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const spanishList = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export const SERVER_COPY: Record<AppLocale, ServerCopy> = {
  en: {
    restOverTitle: "Rest is over",
    restNextBody: (exercise) => `${exercise} is up next.`,
    restNextFallback: "Your next set",
    streakTitle: "Your streak ends after today",
    streakBody: (runDays, daysSince) =>
      `Your ${plural(runDays, "day", "days")} run continues if you train today. It has been ${daysSince} days since your last session.`,
    trainingDayTitle: "Training day",
    trainingDayBody: (routines) =>
      `${englishList(routines)} is planned for today.`,
    partnerSessionTitle: (name) => `${name} completed a workout`,
    partnerAchievementTitle: (name) => `${name} earned an achievement`,
    workoutFallback: "Workout",
    achievementFallback: "Achievement",
    exportOmitted: [
      "Other members' details beyond their username and name; no email of anyone but you.",
      "Share-link tokens and push-notification device endpoints: they are credentials, not data.",
      "Analytics rollups, the dashboard projection and the notification feed: all are derived from the workouts and events included here.",
      "Moderation records: they are the moderator’s record, not yours.",
    ],
  },
  es: {
    restOverTitle: "Terminó el descanso",
    restNextBody: (exercise) => `Sigue: ${exercise}.`,
    restNextFallback: "Tu próxima serie",
    streakTitle: "Tu racha termina después de hoy",
    streakBody: (runDays, daysSince) =>
      `Tu racha de ${plural(runDays, "día", "días")} sigue si entrenas hoy. Pasaron ${plural(daysSince, "día", "días")} desde tu última sesión.`,
    trainingDayTitle: "Día de entrenamiento",
    trainingDayBody: (routines) =>
      `Planificado para hoy: ${spanishList(routines)}.`,
    partnerSessionTitle: (name) => `${name} completó un entrenamiento`,
    partnerAchievementTitle: (name) => `${name} obtuvo un logro`,
    workoutFallback: "Entrenamiento",
    achievementFallback: "Logro",
    exportOmitted: [
      "Los datos de otros miembros más allá de su nombre de usuario y su nombre; ningún correo salvo el tuyo.",
      "Los tokens de los enlaces compartidos y los endpoints de notificaciones push de tus dispositivos: son credenciales, no datos.",
      "Los resúmenes de analíticas, la proyección del inicio y el feed de notificaciones: todos se derivan de los entrenamientos y eventos incluidos aquí.",
      "Los registros de moderación: son el registro del moderador, no el tuyo.",
    ],
  },
};

/** The copy for a stored locale; anything unknown or null reads as English. */
export function serverCopy(locale: unknown): ServerCopy {
  return SERVER_COPY[isAppLocale(locale) ? locale : DEFAULT_LOCALE];
}

/**
 * The language a member chose, for text written on their behalf. A failed
 * lookup is English rather than an error: a language must never be the reason
 * a push is not sent.
 */
export async function recipientLocale(
  db: DatabaseService,
  userId: string,
): Promise<AppLocale> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    return isAppLocale(user?.locale) ? user.locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
