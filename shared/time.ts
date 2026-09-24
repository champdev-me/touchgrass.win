import { B } from './balance.ts';

export type Phase = 'day' | 'night';

export function timeOf(tick: number) {
  const dayTick = tick % B.dayTicks;
  const nightStart = B.dayTicks - B.nightTicks;
  const phase: Phase = dayTick >= nightStart ? 'night' : 'day';
  const ticksLeft = phase === 'day' ? nightStart - dayTick : B.dayTicks - dayTick;
  return { day: Math.floor(tick / B.dayTicks) + 1, phase, secondsToSwitch: (ticksLeft * B.tickMs) / 1000, dayTick };
}

/** 1 at full day, 0 at full night; eases over 30 ticks at dawn and dusk. Fractional ticks are fine. */
export function daylight(tick: number): number {
  const t = tick % B.dayTicks, nightStart = B.dayTicks - B.nightTicks, ramp = 30;
  if (t < ramp) return t / ramp;
  if (t < nightStart - ramp) return 1;
  if (t < nightStart) return (nightStart - t) / ramp;
  return 0;
}
