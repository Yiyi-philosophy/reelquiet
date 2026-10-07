// ReelQuiet — the one tunable parameter object.
//
// D9: "概率、窗口长度、每日预算都放在 src/core 的一个参数对象里，默认值写在代码里、
// 可以调整；实际数值等用一段时间后再定（并入 OQ10）."
//
// Every number here is a Stage 1 placeholder. The ones the design fixes are
// marked FIXED; the rest are marked OQ10 and are expected to move after a week
// of self-use. No value in this file is a product promise.

import type { DepthZone, Tier } from './types.ts'

export type DepthBand = {
  /** Simulated wait (ms) at or beyond which this zone is reached. */
  afterMs: number
  zone: DepthZone
}

export type PondParams = {
  /** FIXED (design, "时间推进"): 100 ms tick == 10 fps sim and animation. */
  tickMs: number

  /** OQ10: how long a cast waits before something bites. */
  biteDelayMinMs: number
  biteDelayMaxMs: number
  /** OQ10: when a roll yields nothing, wait this long before rolling again. */
  biteRetryMs: number

  /**
   * OQ10: the active-reel window for `tier >= rare` (D-REEL).
   *
   * F3 plus the T1 probe confirmed `PromptHint.isDraft`, so Stage 1 runs the
   * D-DRAFT (a) path: the window pauses while a draft is up instead of being
   * stretched. D-FALLBACK is therefore not implemented in core.
   */
  rareWindowMs: number

  /**
   * D13: grace countdown when a turn completes with a rare fish hooked and the
   * prompt is empty. OQ10 (not pinned by the design; set equal to
   * postSubmitGraceMs so "grace" means one duration everywhere in Stage 1).
   */
  carryGraceMs: number
  /**
   * D13 FIXED default: 45 s (suggested range 30-60 s). Starts fresh once a
   * draft is cleared or sent; Stage 1 never resumes a partial window.
   */
  postSubmitGraceMs: number

  /** D9 FIXED default: a soft global budget of rare+ encounters per UTC day. */
  dailyRareBudget: number
  /** OQ10: RNG gate for a rare+ encounter, on top of context + budget. */
  rareEncounterChance: number

  /** D1 FIXED: conservative safety cap on detailed records (not a capacity claim). */
  detailedRecordCap: number

  /** Relative draw weight per tier before the rare gate is applied. */
  tierWeights: Record<Tier, number>

  /** Wait-to-depth mapping, ascending by `afterMs`. */
  depthByWait: DepthBand[]

  /** Night runs from `nightStartHour` (inclusive) to `nightEndHour` (exclusive). */
  nightStartHour: number
  nightEndHour: number

  /** D12 FIXED: at most 3 file basenames, each at most 64 chars. */
  maxFileBasenames: number
  maxFileBasenameChars: number
  /** D14 FIXED: "Recent memories" shows at most 20 entries, newest first. */
  recentMemoriesLimit: number
}

export const DEFAULT_PARAMS: PondParams = {
  tickMs: 100,

  biteDelayMinMs: 6000,
  biteDelayMaxMs: 40000,
  biteRetryMs: 5000,

  rareWindowMs: 12000,

  carryGraceMs: 45000,
  postSubmitGraceMs: 45000,

  dailyRareBudget: 2,
  rareEncounterChance: 0.15,

  detailedRecordCap: 2000,

  tierWeights: {
    common: 1,
    uncommon: 0.45,
    rare: 0.12,
    legendary: 0.03,
  },

  depthByWait: [
    { afterMs: 0, zone: 'epipelagic' },
    { afterMs: 30000, zone: 'mesopelagic' },
    { afterMs: 120000, zone: 'bathypelagic' },
  ],

  nightStartHour: 19,
  nightEndHour: 6,

  maxFileBasenames: 3,
  maxFileBasenameChars: 64,
  recentMemoriesLimit: 20,
}

/** Shallow-merge overrides onto the defaults. Pure; never mutates its inputs. */
export function withParams(overrides: Partial<PondParams> = {}): PondParams {
  return {
    ...DEFAULT_PARAMS,
    ...overrides,
    tierWeights: { ...DEFAULT_PARAMS.tierWeights, ...(overrides.tierWeights ?? {}) },
    depthByWait: (overrides.depthByWait ?? DEFAULT_PARAMS.depthByWait).map((b) => ({ ...b })),
  }
}

/** Deepest zone whose threshold the wait has reached. */
export function depthForWait(params: PondParams, waitMs: number): DepthZone {
  let zone: DepthZone = params.depthByWait[0]?.zone ?? 'epipelagic'
  for (const band of params.depthByWait) {
    if (waitMs >= band.afterMs) zone = band.zone
  }
  return zone
}

export type TimeOfDay = 'day' | 'night'

export function timeOfDayForHour(params: PondParams, hour: number): TimeOfDay {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  const { nightStartHour: start, nightEndHour: end } = params
  if (start === end) return 'day'
  if (start < end) return h >= start && h < end ? 'night' : 'day'
  return h >= start || h < end ? 'night' : 'day'
}
