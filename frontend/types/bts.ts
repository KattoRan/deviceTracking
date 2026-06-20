export interface BtsFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    /** GeoJSON order: [lon, lat] */
    coordinates: [number, number];
  };
  properties: {
    type: "cluster" | "bts";
    /** when type === "cluster" */
    count?: number;
    /** when type === "bts" */
    id?: number;
    radio?: string | null;
    coverageRadius?: number | null;
  };
}

export interface BtsGeoJson {
  type: "FeatureCollection";
  features: BtsFeature[];
  meta?: {
    truncated: boolean;
    total: number;
    displayed: number;
  };
}

