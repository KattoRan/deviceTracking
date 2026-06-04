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

export const GOONG_ATTRIBUTION =
  '© <a href="https://goong.io" target="_blank" rel="noopener">Goong</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
