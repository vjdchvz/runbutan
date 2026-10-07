// Calories burned, from your body weight, using the ACSM metabolic equations (ml O2 / kg / min):
//   running: VO2 = 0.2·speed + 0.9·speed·grade + 3.5
//   walking: VO2 = 0.1·speed + 1.8·speed·grade + 3.5
// speed·grade·time is just metres climbed, and 1 litre of O2 ≈ 5 kcal. So, over a whole run:
//   kcal = kg · 5/1000 · (k·distanceM + c·climbM + 3.5·minutes)
// Under ~8 km/h counts as walking (walking costs less per metre on the flat, more per metre climbed).
const WALK_MAX_MS = 2.2;

export const caloriesFor = (weightKg: number | null | undefined, distanceM: number, movingSec: number, climbM = 0) => {
  if (!weightKg || weightKg <= 0 || movingSec <= 0 || distanceM <= 0) return null;
  const walking = distanceM / movingSec < WALK_MAX_MS;
  const ml = (walking ? 0.1 : 0.2) * distanceM + (walking ? 1.8 : 0.9) * climbM + 3.5 * (movingSec / 60);
  return Math.round((weightKg * ml * 5) / 1000);
};

export const fmtKcal = (k: number | null) => (k === null ? '--' : String(k));
