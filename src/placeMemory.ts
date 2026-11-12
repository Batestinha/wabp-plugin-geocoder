import { z } from 'zod';
import { normalizedPlaceText, placeName, samePlace, searchQueryFor } from './disambiguation';
import { geocoderPlaceSchema, type GeocoderPlace, type RememberInput } from './serviceApi';

/**
 * Each scope's places: the ones its people confirmed, with the words they used for them.
 * Kept in the host's durable plugin data store, one record per scope.
 */

/** Durable per-scope key/value store the host gives plugin services (not yet declared in the SDK context type). */
export interface PlaceMemoryStore {
  get<T = unknown>(key: string, scopeId?: string | undefined): Promise<T | undefined>;
  set(key: string, value: unknown, scopeId?: string | undefined): Promise<void>;
}

const MEMORY_KEY = 'place-memory.v1';
const MAX_PLACES = 300;
const MAX_ALIASES = 12;

const rememberedPlaceSchema = z.object({
  place: geocoderPlaceSchema,
  /** Normalized texts that meant this place. */
  aliases: z.array(z.string()).max(MAX_ALIASES),
  uses: z.number().int().min(0),
  lastUsedAt: z.string().datetime()
}).strict();

const placeMemorySchema = z.object({
  version: z.literal(1),
  places: z.array(rememberedPlaceSchema).max(MAX_PLACES)
}).strict();

export type RememberedPlace = z.infer<typeof rememberedPlaceSchema>;
export type PlaceMemory = z.infer<typeof placeMemorySchema>;

const EMPTY: PlaceMemory = { version: 1, places: [] };

export async function readPlaceMemory(store: PlaceMemoryStore | undefined, scopeId: string): Promise<PlaceMemory> {
  if (!store) return EMPTY;
  try {
    const parsed = placeMemorySchema.safeParse(await store.get(MEMORY_KEY, scopeId));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Remembered places whose words include this text (as typed, or its cleaned search). */
export function placesForText(memory: PlaceMemory, text: string): RememberedPlace[] {
  const keys = new Set([normalizedPlaceText(text), normalizedPlaceText(searchQueryFor(text))].filter(Boolean));
  return memory.places.filter((entry) => entry.aliases.some((alias) => keys.has(alias)));
}

function aliasesFor(query: string, place: GeocoderPlace): string[] {
  return [query, searchQueryFor(query), placeName(place)].map(normalizedPlaceText).filter(Boolean);
}

/** Merge choices into the memory. Only a confirmed choice counts a use; imports only add what is missing. */
export function mergePlaceMemory(memory: PlaceMemory, input: RememberInput, now = new Date()): { memory: PlaceMemory; changed: boolean } {
  const places = memory.places.map((entry) => ({ ...entry, aliases: [...entry.aliases] }));
  let changed = false;
  for (const item of input.places) {
    const usedAt = item.usedAt ?? now.toISOString();
    const aliases = aliasesFor(item.query, item.place);
    const existing = places.find((entry) => samePlace(entry.place, item.place));
    if (!existing) {
      places.push({
        place: item.place,
        aliases: [...new Set(aliases)].slice(0, MAX_ALIASES),
        uses: input.source === 'confirmed' ? 1 : 0,
        lastUsedAt: usedAt
      });
      changed = true;
      continue;
    }
    const newAliases = aliases.filter((alias) => !existing.aliases.includes(alias));
    if (newAliases.length > 0) {
      // Newest words win when the list is full.
      existing.aliases = [...existing.aliases, ...new Set(newAliases)].slice(-MAX_ALIASES);
      changed = true;
    }
    if (input.source === 'confirmed') {
      existing.place = item.place;
      existing.uses += 1;
      existing.lastUsedAt = usedAt;
      changed = true;
    } else if (usedAt > existing.lastUsedAt) {
      existing.lastUsedAt = usedAt;
      changed = true;
    }
  }
  // A word that now means another place no longer points at the old one.
  if (input.source === 'confirmed') {
    for (const item of input.places) {
      const typed = normalizedPlaceText(item.query);
      for (const entry of places) {
        if (!samePlace(entry.place, item.place) && entry.aliases.includes(typed)) {
          entry.aliases = entry.aliases.filter((alias) => alias !== typed);
          changed = true;
        }
      }
    }
  }
  const kept = places
    .filter((entry) => entry.aliases.length > 0)
    .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
    .slice(0, MAX_PLACES);
  if (kept.length !== places.length) changed = true;
  return { memory: { version: 1, places: kept }, changed };
}

export async function writePlaceMemory(store: PlaceMemoryStore, scopeId: string, memory: PlaceMemory): Promise<void> {
  await store.set(MEMORY_KEY, placeMemorySchema.parse(memory), scopeId);
}
