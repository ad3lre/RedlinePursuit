// ===== SI world units =========================================================
// The entire simulation is 1:1 metres. One world unit = 1.0 m. Speeds are m/s,
// accelerations are m/s², angles are radians. HUD converts for display only.

export const G = 9.80665;           // standard gravity (m/s²) — friction circle + IMU
// Arcade vertical pull: keeps tyres stuck over hills. Real G makes NPCs loft off roads and spiral.
export const G_VERT = 22;
export const MS_TO_KMH = 3.6;       // m/s → km/h
export const KMH_TO_MS = 1 / 3.6;
export const MS2_TO_G = 1 / G;      // m/s² → g

/** Format a trip distance in metres as "123 m" / "1.23 km". */
export function fmtDistance(meters) {
  const m = Math.max(0, meters || 0);
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
