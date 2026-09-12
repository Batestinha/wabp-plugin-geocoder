import { find } from 'geo-tz/dist/find-all';
import { canonicalTimezone } from '../../../../packages/plugin-sdk/src/clock';
import { geocoderPointSchema, type GeocoderPlace, type GeocoderPoint } from './serviceApi';

/** Exact offline boundary lookup. Country names and language never imply a zone. */
export function timezoneForPoint(point: GeocoderPoint): { timezone: string | null; candidates: string[] } {
  const { latitude, longitude } = geocoderPointSchema.parse(point);
  const candidates = [...new Set(find(latitude, longitude).map(canonicalTimezone))];
  return { timezone: candidates.length === 1 ? candidates[0]! : null, candidates };
}

export function withPlaceTimezone(place: GeocoderPlace): GeocoderPlace {
  const { timezone } = timezoneForPoint(place.point);
  const result = { ...place };
  delete result.timezone;
  return { ...result, ...(timezone ? { timezone } : {}) };
}
