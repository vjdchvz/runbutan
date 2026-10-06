import { getSettings } from './settings';

// Everything is stored in metres and seconds-per-km. These helpers only change how it is SHOWN and SPOKEN.
export const M_PER_MI = 1609.344;
export const unitMeters = () => (getSettings().unit === 'mi' ? M_PER_MI : 1000);
export const unitName = () => getSettings().unit; // 'km' | 'mi'
export const unitWord = () => (getSettings().unit === 'mi' ? 'miles' : 'kilometers');
export const unitWordSingular = () => (getSettings().unit === 'mi' ? 'Mile' : 'Kilometer');

export const distNum = (m: number, dp = 2) => (m / unitMeters()).toFixed(dp);
export const distText = (m: number, dp = 2) => `${distNum(m, dp)} ${unitName()}`;
export const paceLabel = () => `/${unitName()}`;
export const paceInUnit = (secPerKm: number) => (secPerKm * unitMeters()) / 1000;
export const kmToUnit = (km: number) => (km * 1000) / unitMeters();
export const unitToKm = (u: number) => (u * unitMeters()) / 1000;
