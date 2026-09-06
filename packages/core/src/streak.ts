/**
 * 连续性与冻结（F11）：最小达标单元由调用方判定（≈5 张/3 分钟）后调用 recordAchievement。
 * 规则：每 7 个达标日自动授予 1 枚冻结（上限 2，不可购买 F11.2）；漏训日自动静默消耗；
 * 冻结不足以覆盖漏训 → 断签（软着陆文案由 UI 层负责，F11.3）。
 */

export interface StreakState {
  current: number;
  best: number;
  /** 本地日期 YYYY-MM-DD（用户时区由调用方折算）。 */
  lastAchievedDate: string | null;
  freezes: number;
  achievedDaysTotal: number;
}

export const EMPTY_STREAK: StreakState = {
  current: 0,
  best: 0,
  lastAchievedDate: null,
  freezes: 0,
  achievedDaysTotal: 0,
};

export interface StreakUpdate {
  state: StreakState;
  /** 本次消耗的冻结数（>0 时 UI 提示「连续被自动保住了」）。 */
  freezesConsumed: number;
  /** 是否发生断签（UI 走软着陆 F11.3）。 */
  broke: boolean;
  /** 本次是否新授予冻结。 */
  freezeAwarded: boolean;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

/**
 * @param exemptDays 免计漏训天数（假期模式 F4.9/F11 暂停态：调用方按重叠天数传入）。
 */
export function recordAchievement(s: StreakState, dateLocal: string, exemptDays = 0): StreakUpdate {
  if (s.lastAchievedDate === dateLocal) {
    return { state: s, freezesConsumed: 0, broke: false, freezeAwarded: false };
  }
  let current = s.current;
  let freezes = s.freezes;
  let freezesConsumed = 0;
  let broke = false;

  if (s.lastAchievedDate === null) {
    current = 1;
  } else {
    const gap = daysBetween(s.lastAchievedDate, dateLocal);
    const misses = Math.max(0, gap - 1 - exemptDays);
    if (misses === 0) {
      current += 1;
    } else if (misses <= freezes) {
      freezes -= misses;
      freezesConsumed = misses;
      current += 1;
    } else {
      broke = true;
      current = 1;
    }
  }

  const achievedDaysTotal = s.achievedDaysTotal + 1;
  let freezeAwarded = false;
  if (achievedDaysTotal % 7 === 0 && freezes < 2) {
    freezes += 1;
    freezeAwarded = true;
  }

  return {
    state: {
      current,
      best: Math.max(s.best, current),
      lastAchievedDate: dateLocal,
      freezes,
      achievedDaysTotal,
    },
    freezesConsumed,
    broke,
    freezeAwarded,
  };
}
