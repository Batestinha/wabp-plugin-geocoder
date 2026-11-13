import type { GeocoderBoundingBox, GeocoderPlace, GeocoderPoint, GeocoderResolveStatus } from './serviceApi';

/**
 * Which place a person means. Every plugin that turns typed place text into a
 * place goes through these rules, so /weather, event creation and edits agree.
 */

const HEDGES = /\b(?:maybe|perhaps|tbd|talvez|por decidir|a decidir|a confirmar|por confirmar|ou outro|ou outra|or other|or so)\b/giu;

/** The search text for a place answer: notes such as "(maybe?)" and alternatives ("A/B", "A ou B") stay out. */
export function searchQueryFor(place: string): string {
  const first = place.replace(/\([^)]*\)/g, ' ').split(/\s*\/\s*|\s+(?:ou|or)\s+/iu)[0] ?? place;
  const cleaned = first.replace(HEDGES, ' ').replace(/[?¿!]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length >= 2 ? cleaned : place.trim();
}

export function normalizedPlaceText(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** The place's own name: the provider name, else the first part of its label. */
export function placeName(place: Pick<GeocoderPlace, 'name' | 'label'>): string {
  return place.name?.trim() || place.label.split(',')[0]!.trim();
}

/** Name plus the parts that tell it apart: "Lagos, Faro, Portugal", "Lagos, Lagos State, Nigeria". */
export function shortLabel(place: GeocoderPlace): string {
  const name = placeName(place);
  const address = place.address;
  const region = [address.city, address.county, address.state]
    .find((part) => part && normalizedPlaceText(part) !== normalizedPlaceText(name));
  const parts = [name, region, address.country].filter((part): part is string => Boolean(part?.trim()));
  const unique = parts.filter((part, index) => parts.findIndex((other) => normalizedPlaceText(other) === normalizedPlaceText(part)) === index);
  return unique.length > 1 ? unique.join(', ') : place.label;
}

export function isNameMatch(place: Pick<GeocoderPlace, 'name' | 'label'>, searchQuery: string): boolean {
  const wanted = normalizedPlaceText(searchQuery);
  return Boolean(wanted) && [place.name, place.label.split(',')[0]]
    .filter((name): name is string => Boolean(name))
    .some((name) => normalizedPlaceText(name) === wanted);
}

export function distanceKm(a: GeocoderPoint, b: GeocoderPoint): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const x = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function samePlace(a: GeocoderPlace, b: GeocoderPlace, withinKm = 0.5): boolean {
  if (a.providerRef && b.providerRef && a.providerRef === b.providerRef) return true;
  return distanceKm(a.point, b.point) <= withinKm
    && normalizedPlaceText(placeName(a)) === normalizedPlaceText(placeName(b));
}

const NEIGHBOURHOOD_DEGREES = 1.5;
const MARGIN_DEGREES = 0.3;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The area around a scope's usual places; a single trip abroad does not widen it. */
export function usualAreaBounds(points: GeocoderPoint[]): GeocoderBoundingBox | undefined {
  if (points.length < 2) return undefined;
  const latitude = median(points.map((point) => point.latitude));
  const longitude = median(points.map((point) => point.longitude));
  const near = points.filter((point) => Math.abs(point.latitude - latitude) <= NEIGHBOURHOOD_DEGREES
    && Math.abs(point.longitude - longitude) <= NEIGHBOURHOOD_DEGREES);
  if (near.length < 2) return undefined;
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  return {
    south: clamp(Math.min(...near.map((point) => point.latitude)) - MARGIN_DEGREES, 90),
    west: clamp(Math.min(...near.map((point) => point.longitude)) - MARGIN_DEGREES, 180),
    north: clamp(Math.max(...near.map((point) => point.latitude)) + MARGIN_DEGREES, 90),
    east: clamp(Math.max(...near.map((point) => point.longitude)) + MARGIN_DEGREES, 180)
  };
}

export function insideBounds(point: GeocoderPoint, bounds: GeocoderBoundingBox | undefined): boolean {
  return Boolean(bounds) && point.latitude >= bounds!.south && point.latitude <= bounds!.north
    && point.longitude >= bounds!.west && point.longitude <= bounds!.east;
}

export interface RankedCandidate {
  place: GeocoderPlace;
  remembered: boolean;
  nameMatch: boolean;
  inArea: boolean;
  /** Distance to the usual area (0 inside it); undefined without an area. */
  areaKm?: number | undefined;
}

/** A place this close to a community's usual area is in its region ("Lagos" for a Lisbon group is the Algarve one). */
export const REGION_KM = 400;

export function distanceToBoundsKm(point: GeocoderPoint, bounds: GeocoderBoundingBox): number {
  const nearest = {
    latitude: Math.min(bounds.north, Math.max(bounds.south, point.latitude)),
    longitude: Math.min(bounds.east, Math.max(bounds.west, point.longitude))
  };
  return distanceKm(point, nearest);
}

/** Two results with the same name this close are one place (a town and its parish, a node and its area). */
const SAME_NAME_DUPLICATE_KM = 10;

/**
 * Remembered places first, then places named exactly what was searched, then places in the usual area;
 * otherwise the provider's order. Near-duplicates of a better candidate are dropped.
 */
export function rankCandidates(input: {
  remembered: GeocoderPlace[];
  provider: GeocoderPlace[];
  knownPlaces: GeocoderPlace[];
  searchQuery: string;
  area?: GeocoderBoundingBox | undefined;
}): RankedCandidate[] {
  const candidates: Array<RankedCandidate & { order: number }> = [...input.remembered, ...input.provider].map((place, order) => ({
    place,
    order,
    remembered: order < input.remembered.length || input.knownPlaces.some((known) => samePlace(known, place)),
    nameMatch: isNameMatch(place, input.searchQuery),
    inArea: insideBounds(place.point, input.area),
    ...(input.area ? { areaKm: distanceToBoundsKm(place.point, input.area) } : {})
  }));
  // Being in the usual area counts as much as the exact name: "Tapada da Ajuda" near Lisbon before a
  // hamlet called "Tapada" 150 km away; remembered places always first.
  const score = (candidate: RankedCandidate & { order: number }) =>
    (candidate.remembered ? 8 : 0) + (candidate.nameMatch ? 2 : 0) + (candidate.inArea ? 2 : 0);
  // With a usual area, nearer places come first among equals; otherwise the provider's order stands.
  const sorted = candidates.sort((left, right) => score(right) - score(left)
    || (left.areaKm !== undefined && right.areaKm !== undefined ? left.areaKm - right.areaKm : 0)
    || left.order - right.order);
  const kept: RankedCandidate[] = [];
  for (const candidate of sorted) {
    const duplicate = kept.some((other) => samePlace(other.place, candidate.place)
      || (normalizedPlaceText(placeName(other.place)) === normalizedPlaceText(placeName(candidate.place))
        && distanceKm(other.place.point, candidate.place.point) <= SAME_NAME_DUPLICATE_KM));
    if (!duplicate) {
      kept.push({ place: candidate.place, remembered: candidate.remembered, nameMatch: candidate.nameMatch,
        inArea: candidate.inArea, ...(candidate.areaKm !== undefined ? { areaKm: candidate.areaKm } : {}) });
    }
  }
  return kept;
}

/**
 * Confident when the text was remembered, there is one candidate, or exactly one candidate has that name,
 * or exactly one with that name lies in the usual area, or (failing that) in its region. The confident
 * candidate goes first.
 */
export function decide(candidates: RankedCandidate[], rememberedText: boolean, searchQuery = ''): {
  status: GeocoderResolveStatus;
  candidates: RankedCandidate[];
} {
  if (candidates.length === 0) return { status: 'not_found', candidates };
  if (rememberedText || candidates.length === 1) return { status: 'resolved', candidates };
  const named = candidates.filter((candidate) => candidate.nameMatch);
  const only = (matches: RankedCandidate[]) => matches.length === 1 ? matches[0] : undefined;
  const inRegion = (candidate: RankedCandidate) => candidate.areaKm !== undefined && candidate.areaKm <= REGION_KM;
  let pick = named.length === 1 ? named[0] : undefined;
  if (named.length > 1) {
    pick = only(named.filter((candidate) => candidate.inArea))
      ?? (named.some((candidate) => candidate.inArea) ? undefined : only(named.filter(inRegion)));
    // A longer name nearby ("Tapada da Ajuda" beside the area's only "Tapada") keeps it a question.
    const wanted = normalizedPlaceText(searchQuery);
    const near = (candidate: RankedCandidate) => pick?.inArea ? candidate.inArea : inRegion(candidate);
    if (pick && wanted && candidates.some((candidate) => candidate !== pick && near(candidate)
      && normalizedPlaceText(placeName(candidate.place)).startsWith(`${wanted} `))) {
      pick = undefined;
    }
  }
  if (!pick) return { status: 'ambiguous', candidates };
  return { status: 'resolved', candidates: [pick, ...candidates.filter((candidate) => candidate !== pick)] };
}

const ACCEPT_WORDS = new Set(['ok', 'okay', 'okey', 'oki', 'sim', 's', 'yes', 'y', 'yep', 'yeah', 'isso', 'isso mesmo',
  'certo', 'correto', 'confirmo', 'confirmar', 'pode ser', 'perfeito', 'exato', 'exatamente', 'sure', 'correct', 'esse',
  'essa', 'este', 'esta', 'that one', 'this one']);

export function isAcceptReply(reply: string): boolean {
  const raw = reply.trim();
  if (raw === '👍' || raw === '✅') return true;
  const word = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[\s.!?¡¿,;:]+$/u, '').replace(/\s+/g, ' ');
  return ACCEPT_WORDS.has(word);
}

/** A typed reply that names exactly one listed place selects it. */
export function typedChoice(places: Pick<GeocoderPlace, 'label' | 'name'>[], reply: string): number | undefined {
  const wanted = normalizedPlaceText(reply);
  if (!wanted) return undefined;
  const matches = places.flatMap((place, index) => [place.name, place.label.split(',')[0], place.label]
    .filter((name): name is string => Boolean(name)).map(normalizedPlaceText).includes(wanted) ? [index] : []);
  return matches.length === 1 ? matches[0] : undefined;
}

export type ReplyMeaning =
  | { status: 'selected'; index: number }
  | { status: 'search'; query: string }
  | { status: 'ask_number' }
  | { status: 'invalid' };

/**
 * A number picks that line; "ok" picks the confident or only place; a typed name picks the one place called that;
 * the same search again asks for the number; anything else is a new search.
 */
export function replyMeaning(input: {
  reply: string;
  searchQuery: string;
  status: GeocoderResolveStatus;
  candidates: Pick<GeocoderPlace, 'label' | 'name'>[];
}): ReplyMeaning {
  const reply = input.reply.trim();
  if (/^\d+$/.test(reply)) {
    const index = Number(reply) - 1;
    return index >= 0 && index < input.candidates.length ? { status: 'selected', index } : { status: 'invalid' };
  }
  if (input.candidates.length > 0 && isAcceptReply(reply)
    && (input.candidates.length === 1 || input.status === 'resolved')) {
    return { status: 'selected', index: 0 };
  }
  const typed = typedChoice(input.candidates, reply);
  if (typed !== undefined) return { status: 'selected', index: typed };
  if (!reply || reply.startsWith('/')) return { status: 'invalid' };
  if (input.candidates.length > 0 && normalizedPlaceText(reply) === normalizedPlaceText(input.searchQuery)) {
    return { status: 'ask_number' };
  }
  return { status: 'search', query: reply };
}
