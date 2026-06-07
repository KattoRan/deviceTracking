/**
 * Cấu hình map vector cho MapLibre GL — dùng chung cho mọi <Map> trong app
 * (tracking, history, geofences).
 *
 * Provider: Goong (goong.io) — fork Mapbox cho Việt Nam, có Hoàng Sa và
 * Trường Sa đầy đủ thuộc chủ quyền Việt Nam, chi tiết đường/ngõ tốt hơn
 * OSM/CARTO mặc định.
 *
 * Goong chỉ phục vụ vector tile (Mapbox/MapLibre GL style), không có raster
 * PNG. Vì vậy app đã chuyển hoàn toàn sang MapLibre GL JS, bỏ Leaflet.
 *
 * Maptiles key được expose ra browser (NEXT_PUBLIC_) — đây là thiết kế của
 * Goong; cần restrict origin trong Goong dashboard cho từng môi trường.
 */

const GOONG_MAPTILES_KEY = process.env.NEXT_PUBLIC_GOONG_MAPTILES_KEY ?? "";

/**
 * URL style JSON theo chuẩn Mapbox GL Style Spec. MapLibre tự fetch file
 * này, đọc danh sách sources/layers và render qua WebGL. Style cơ bản là
 * "goong_map_web" — giống Google Maps light theme. Đổi tại đây nếu muốn
 * style khác (vd `goong_satellite`).
 */
export const GOONG_STYLE_URL = `https://tiles.goong.io/assets/goong_map_web.json?api_key=${GOONG_MAPTILES_KEY}`;

// Goong style đã tự inject "© Goong Maps" qua attribution của source. Ta chỉ
// thêm OpenStreetMap (raw data layer bên dưới) để khỏi credit Goong 2 lần.
export const GOONG_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/**
 * Xoá hẳn các layer POI (poi-park, poi-railway, poi-airport, poi-tree, etc.)
 * để map đỡ rối — chỉ giữ đường, label phố, tên địa danh, ranh giới hành
 * chính. Gọi từ onLoad của <Map>.
 *
 * Dùng `removeLayer` thay vì set visibility=none vì style Goong có layer
 * `poi-tree` trỏ tới source-layer `trees` không tồn tại trong vector tile —
 * nếu chỉ ẩn, MapLibre vẫn validate nó với từng tile và log error
 * "Source layer 'trees' does not exist" liên tục. Remove thì layer biến mất
 * khỏi style luôn, không còn validate.
 *
 * Giữ nguyên các layer `place-*` (tên thành phố, đảo, biển — bao gồm Hoàng
 * Sa/Trường Sa) và `highway-name-*`, `river-name-*` vì đó là context cần
 * thiết, không phải POI thương mại.
 */
export function hidePoiLayers(map: {
  getStyle: () => { layers?: Array<{ id: string }> } | undefined;
  removeLayer: (layerId: string) => void;
}): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  // Snapshot ids trước khi remove vì xoá layer sẽ mutate style.layers.
  const poiIds = style.layers
    .map((l) => l.id)
    .filter((id) => id.startsWith("poi-"));
  for (const id of poiIds) {
    try {
      map.removeLayer(id);
    } catch {
      // Layer có thể đã bị remove ở pass khác / không tồn tại — bỏ qua.
    }
  }
}
