export interface DailyField { label: string; value: string }

/** A local-time snapshot, shared by fetch and today. No geolocation or network. */
export function dailyInfo(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): DailyField[] {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)!.value;
  const year = Number(value('year'));
  const month = Number(value('month'));
  const day = Number(value('day'));
  // Calendar arithmetic uses UTC to avoid 23/25-hour days at DST boundaries.
  const midnight = Date.UTC(year, month - 1, day);
  const yearStart = Date.UTC(year, 0, 1);
  const days = (Date.UTC(year + 1, 0, 1) - yearStart) / 86400000;
  const ordinal = (midnight - yearStart) / 86400000 + 1;
  const seconds = Number(value('hour')) * 3600 + Number(value('minute')) * 60 + Number(value('second'));
  const progress = (ordinal - 1 + seconds / 86400) / days;
  const filled = Math.floor(progress * 12);
  const weekday = '日一二三四五六'[new Date(midnight).getUTCDay()];
  const offset = value('timeZoneName').replace(/^GMT/, 'UTC');
  return [
    { label: 'today', value: `${value('year')}-${value('month')}-${value('day')} · 星期${weekday}` },
    { label: 'time', value: `${value('hour')}:${value('minute')}:${value('second')}` },
    { label: 'zone', value: `${timeZone} (${offset})` },
    { label: 'year', value: `第 ${ordinal} / ${days} 天 · 剩余 ${days - ordinal} 天` },
    { label: 'progress', value: `[${'#'.repeat(filled)}${'-'.repeat(12 - filled)}] ${(Math.floor(progress * 1000) / 10).toFixed(1)}%` },
  ];
}
