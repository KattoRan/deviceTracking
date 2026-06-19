/**
 * Wrapper Goong Services API (Place Autocomplete + Detail).
 *
 * Goong tách 2 loại key:
 *   - Maptiles: rendering vector tiles
 *   - Services: Places, Directions, Geocoding
 * Một số tài khoản dùng chung 1 key. Ưu tiên `NEXT_PUBLIC_GOONG_API_KEY`
 * (services), fallback về `NEXT_PUBLIC_GOONG_MAPTILES_KEY` nếu chưa khai báo
 * riêng. User cấu hình trong `.env` cho frontend.
 */

const GOONG_API_KEY =
  process.env.NEXT_PUBLIC_GOONG_API_KEY ??
  process.env.NEXT_PUBLIC_GOONG_MAPTILES_KEY ??
  "";

const GOONG_BASE = "https://rsapi.goong.io";

export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceDetail {
  placeId: string;
  description: string;
  lat: number;
  lon: number;
}

interface RawPrediction {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
}

interface RawDetail {
  result: {
    place_id: string;
    name?: string;
    formatted_address?: string;
    geometry: { location: { lat: number; lng: number } };
  };
}

/**
 * Goong Place Autocomplete — gợi ý địa chỉ theo `input`. `location` (lat,lon)
 * bias kết quả về 1 vùng để gợi ý gần hơn (vd kéo theo center map hiện tại).
 */
export async function autocompletePlace(
  input: string,
  opts?: {
    location?: { lat: number; lon: number };
    signal?: AbortSignal;
  },
): Promise<PlacePrediction[]> {
  if (!input.trim()) return [];
  if (!GOONG_API_KEY) {
    throw new Error("Missing NEXT_PUBLIC_GOONG_API_KEY");
  }

  const url = new URL(`${GOONG_BASE}/Place/AutoComplete`);
  url.searchParams.set("api_key", GOONG_API_KEY);
  url.searchParams.set("input", input);
  if (opts?.location) {
    url.searchParams.set(
      "location",
      `${opts.location.lat},${opts.location.lon}`,
    );
  }

  const res = await fetch(url.toString(), { signal: opts?.signal });
  if (!res.ok) {
    throw new Error(`Goong autocomplete ${res.status}`);
  }
  const data = (await res.json()) as { predictions?: RawPrediction[] };
  return (data.predictions ?? []).map((p) => ({
    placeId: p.place_id,
    description: p.description,
    mainText: p.structured_formatting?.main_text ?? p.description,
    secondaryText: p.structured_formatting?.secondary_text ?? "",
  }));
}

/**
 * Goong Place Detail — trả toạ độ (lat, lng) cho place_id chọn từ autocomplete.
 * Gọi sau khi user click 1 suggestion.
 */
export async function placeDetail(
  placeId: string,
  signal?: AbortSignal,
): Promise<PlaceDetail> {
  if (!GOONG_API_KEY) {
    throw new Error("Missing NEXT_PUBLIC_GOONG_API_KEY");
  }

  const url = new URL(`${GOONG_BASE}/Place/Detail`);
  url.searchParams.set("api_key", GOONG_API_KEY);
  url.searchParams.set("place_id", placeId);

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) {
    throw new Error(`Goong detail ${res.status}`);
  }
  const data = (await res.json()) as RawDetail;
  const r = data.result;
  return {
    placeId,
    description: r.formatted_address ?? r.name ?? "",
    lat: r.geometry.location.lat,
    lon: r.geometry.location.lng,
  };
}
