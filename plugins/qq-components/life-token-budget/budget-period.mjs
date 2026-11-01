const SHANGHAI_OFFSET_MS=8*60*60*1000;
export const DAY_MS=24*60*60*1000;
export const validResetTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const resetTime=config=>validResetTime(config?.dailyResetTime)?config.dailyResetTime:'22:00';
export function periodStart(now=Date.now(),dailyResetTime='22:00'){
 const [hour,minute]=resetTime({dailyResetTime}).split(':').map(Number);
 const local=new Date(now+SHANGHAI_OFFSET_MS);
 const start=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),hour,minute)-SHANGHAI_OFFSET_MS;
 return now<start?start-DAY_MS:start;
}
