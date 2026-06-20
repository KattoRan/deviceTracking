import circle from "@turf/circle";
import type { Feature, Polygon } from "geojson";

// 64 cạnh là điểm cân bằng: ở zoom < 17 nhìn như tròn hoàn hảo; nhiều hơn
// thì tốn CPU vô ích, ít hơn thì thấy gãy khúc khi zoom sâu.
const DEFAULT_STEPS = 64;

export function metersCircle(
  lon: number,
  lat: number,
  radiusM: number,
  properties: Record<string, unknown> = {},
): Feature<Polygon> {
  return circle([lon, lat], radiusM / 1000, {
    steps: DEFAULT_STEPS,
    units: "kilometers",
    properties,
  });
}
