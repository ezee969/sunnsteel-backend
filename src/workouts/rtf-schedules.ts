// Shared RtF schedule definitions (STANDARD & HYPERTROPHY)
// Centralizes canonical arrays for reuse (snapshotting, forecast, tests).
// Deload markers included. When withDeloads=false consumers must filter
// out deload entries and reindex weeks (snapshot builder handles this).

export type RtfStandardGoal = {
	week: number
	intensity: number
	fixedReps: number
	amrapTarget: number
}
export type RtfHypertrophyGoal = RtfStandardGoal
export type RtfDeload = { week: number; isDeload: true; intensity?: number; sets?: number; reps?: number }

export const RTF_STANDARD_WITH_DELOADS: Array<RtfStandardGoal | RtfDeload> = [
	{ week: 1, intensity: 0.7, fixedReps: 5, amrapTarget: 10 },
	{ week: 2, intensity: 0.75, fixedReps: 4, amrapTarget: 8 },
	{ week: 3, intensity: 0.8, fixedReps: 3, amrapTarget: 6 },
	{ week: 4, intensity: 0.725, fixedReps: 5, amrapTarget: 9 },
	{ week: 5, intensity: 0.775, fixedReps: 4, amrapTarget: 7 },
	{ week: 6, intensity: 0.825, fixedReps: 3, amrapTarget: 5 },
	{ week: 7, isDeload: true },
	{ week: 8, intensity: 0.75, fixedReps: 4, amrapTarget: 8 },
	{ week: 9, intensity: 0.8, fixedReps: 3, amrapTarget: 6 },
	{ week: 10, intensity: 0.85, fixedReps: 2, amrapTarget: 4 },
	{ week: 11, intensity: 0.775, fixedReps: 4, amrapTarget: 7 },
	{ week: 12, intensity: 0.825, fixedReps: 3, amrapTarget: 5 },
	{ week: 13, intensity: 0.875, fixedReps: 2, amrapTarget: 3 },
	{ week: 14, isDeload: true },
	{ week: 15, intensity: 0.8, fixedReps: 3, amrapTarget: 6 },
	{ week: 16, intensity: 0.85, fixedReps: 2, amrapTarget: 4 },
	{ week: 17, intensity: 0.9, fixedReps: 1, amrapTarget: 2 },
	{ week: 18, intensity: 0.85, fixedReps: 2, amrapTarget: 4 },
	{ week: 19, intensity: 0.9, fixedReps: 1, amrapTarget: 2 },
	{ week: 20, intensity: 0.95, fixedReps: 1, amrapTarget: 2 },
	{ week: 21, isDeload: true },
]

export const RTF_HYPERTROPHY_WITH_DELOADS: Array<RtfHypertrophyGoal | RtfDeload> = [
	{ week: 1, intensity: 0.7, fixedReps: 10, amrapTarget: 12 },
	{ week: 2, intensity: 0.725, fixedReps: 9, amrapTarget: 11 },
	{ week: 3, intensity: 0.75, fixedReps: 8, amrapTarget: 10 },
	{ week: 4, intensity: 0.725, fixedReps: 9, amrapTarget: 11 },
	{ week: 5, intensity: 0.75, fixedReps: 8, amrapTarget: 10 },
	{ week: 6, intensity: 0.775, fixedReps: 7, amrapTarget: 9 },
	{ week: 7, isDeload: true, intensity: 0.6, sets: 4, reps: 5 },
	{ week: 8, intensity: 0.725, fixedReps: 9, amrapTarget: 11 },
	{ week: 9, intensity: 0.75, fixedReps: 8, amrapTarget: 10 },
	{ week: 10, intensity: 0.775, fixedReps: 7, amrapTarget: 9 },
	{ week: 11, intensity: 0.75, fixedReps: 8, amrapTarget: 10 },
	{ week: 12, intensity: 0.775, fixedReps: 7, amrapTarget: 9 },
	{ week: 13, intensity: 0.8, fixedReps: 6, amrapTarget: 8 },
	{ week: 14, isDeload: true, intensity: 0.6, sets: 4, reps: 5 },
	{ week: 15, intensity: 0.75, fixedReps: 8, amrapTarget: 10 },
	{ week: 16, intensity: 0.775, fixedReps: 7, amrapTarget: 9 },
	{ week: 17, intensity: 0.8, fixedReps: 6, amrapTarget: 8 },
	{ week: 18, intensity: 0.775, fixedReps: 7, amrapTarget: 9 },
	{ week: 19, intensity: 0.8, fixedReps: 6, amrapTarget: 8 },
	{ week: 20, intensity: 0.825, fixedReps: 5, amrapTarget: 6 },
	{ week: 21, isDeload: true, intensity: 0.6, sets: 4, reps: 5 },
]

export interface RtfProgramSnapshot {
	version: number
	createdAt: string
	withDeloads: boolean
	weeks: number
	standard: Array<RtfStandardGoal | RtfDeload>
	hypertrophy: Array<RtfHypertrophyGoal | RtfDeload>
}

export function buildRtfProgramSnapshot(withDeloads: boolean): RtfProgramSnapshot {
	const version = 1
	const now = new Date().toISOString()
	const filterTraining = (arr: any[]) => arr.filter(g => !(g.isDeload === true))
	const stdSource = withDeloads
		? RTF_STANDARD_WITH_DELOADS
		: filterTraining(RTF_STANDARD_WITH_DELOADS).map((g: any, idx: number) => ({ ...g, week: idx + 1 }))
	const hypSource = withDeloads
		? RTF_HYPERTROPHY_WITH_DELOADS
		: filterTraining(RTF_HYPERTROPHY_WITH_DELOADS).map((g: any, idx: number) => ({ ...g, week: idx + 1 }))
	const weeks = withDeloads ? 21 : 18
	return { version, createdAt: now, withDeloads, weeks, standard: stdSource, hypertrophy: hypSource }
}
