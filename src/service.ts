import { timezoneForPoint, withPlaceTimezone } from './timezone';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { PluginServiceCallContext, PluginServiceRegistration } from '@wabs/plugin-sdk/services';
import type { TranslateFn } from '@wabs/plugin-sdk/i18n';
import { bundledTranslator } from './bundledMessages';
import {
  decide,
  rankCandidates,
  replyMeaning,
  samePlace,
  searchQueryFor,
  shortLabel,
  usualAreaBounds
} from './disambiguation';
import {
  mergePlaceMemory,
  placesForText,
  readPlaceMemory,
  writePlaceMemory,
  type PlaceMemoryStore
} from './placeMemory';
import type { PluginEphemeralStore } from '@wabs/plugin-sdk/ephemeral-store';
import type { ServicePluginContext } from '@wabs/plugin-sdk/service-plugin';
import { parseGeocoderConfig, type GeocoderConfig } from './config';
import { NominatimGeocoderProvider } from './providers/nominatim';
import type { GeocoderProvider } from './providers/provider';
import {
  GEOCODER_CHOOSE_METHOD,
  GEOCODER_GEOCODE_METHOD,
  GEOCODER_REMEMBER_METHOD,
  GEOCODER_RESOLVE_METHOD,
  GEOCODER_MAP_LINKS_METHOD,
  GEOCODER_REVERSE_GEOCODE_METHOD,
  GEOCODER_SERVICE_ID,
  GEOCODER_TIMEZONE_METHOD,
  geocoderPointSchema,
  geocoderTimezoneOutputSchema,
  type ChooseInput,
  type ChooseOutput,
  type GeocoderPlace,
  type GeocoderPoint,
  type GeocodeInput,
  type GeocodeOutput,
  type MapLinksInput,
  type MapLinksOutput,
  type ReverseGeocodeInput,
  type ReverseGeocodeOutput,
  type RememberInput,
  type RememberOutput,
  type ResolveInput,
  type ResolveOutput,
  chooseInputSchema,
  chooseOutputSchema,
  rememberInputSchema,
  rememberOutputSchema,
  resolveInputSchema,
  resolveOutputSchema,
  geocodeInputSchema,
  geocodeOutputSchema,
  mapLinksInputSchema,
  mapLinksOutputSchema,
  reverseGeocodeInputSchema,
  reverseGeocodeOutputSchema
} from './serviceApi';

export function registerGeocoderServices(context: ServicePluginContext): PluginServiceRegistration[] {
  return [{
    serviceId: GEOCODER_SERVICE_ID,
    methods: [{
      name: GEOCODER_TIMEZONE_METHOD, access: 'read',
      inputSchema: geocoderPointSchema, outputSchema: geocoderTimezoneOutputSchema,
      handler: (input) => timezoneForPoint(input as GeocoderPoint)
    },
      {
        name: GEOCODER_GEOCODE_METHOD,
        access: 'read',
        inputSchema: geocodeInputSchema,
        outputSchema: geocodeOutputSchema,
        timeoutMs: 10_000,
        async handler(rawInput, call): Promise<GeocodeOutput> {
          const config = parseGeocoderConfig(await context.configFor(call.scopeId, call.actorIdentityId));
          return geocodeCached(context, config, rawInput as GeocodeInput, call);
        }
      },
      {
        name: GEOCODER_RESOLVE_METHOD,
        access: 'read',
        inputSchema: resolveInputSchema,
        outputSchema: resolveOutputSchema,
        timeoutMs: 10_000,
        async handler(rawInput, call): Promise<ResolveOutput> {
          const config = parseGeocoderConfig(await context.configFor(call.scopeId, call.actorIdentityId));
          return resolvePlace(context, config, rawInput as ResolveInput, call);
        }
      },
      {
        name: GEOCODER_CHOOSE_METHOD,
        access: 'read',
        inputSchema: chooseInputSchema,
        outputSchema: chooseOutputSchema,
        async handler(rawInput, call): Promise<ChooseOutput> {
          const input = rawInput as ChooseInput;
          const meaning = replyMeaning(input);
          if (meaning.status === 'selected') {
            return { status: 'selected', index: meaning.index, place: input.candidates[meaning.index]! };
          }
          if (meaning.status !== 'ask_number') return meaning;
          const config = parseGeocoderConfig(await context.configFor(call.scopeId, call.actorIdentityId));
          const { t } = await geocoderTranslator(context, call.scopeId, input.language ?? config.defaultLanguage);
          const memory = await readPlaceMemory(memoryStore(context), call.scopeId);
          const remembered = memory.places.map((entry) => entry.place);
          return {
            status: 'ask_number',
            text: [
              t('official.geocoder.chooseNumber', { count: input.candidates.length }),
              ...optionLines(input.candidates.map((place) => ({
                place, remembered: remembered.some((known) => samePlace(known, place))
              })), t)
            ].join('\n')
          };
        }
      },
      {
        name: GEOCODER_REMEMBER_METHOD,
        access: 'mutation',
        inputSchema: rememberInputSchema,
        outputSchema: rememberOutputSchema,
        async handler(rawInput, call): Promise<RememberOutput> {
          const store = memoryStore(context);
          if (!store) return { places: 0, changed: false };
          const memory = await readPlaceMemory(store, call.scopeId);
          const merged = mergePlaceMemory(memory, rawInput as RememberInput);
          // Write only what changed: imports of known places are no-ops.
          if (merged.changed) await writePlaceMemory(store, call.scopeId, merged.memory);
          return { places: merged.memory.places.length, changed: merged.changed };
        }
      },
      {
        name: GEOCODER_REVERSE_GEOCODE_METHOD,
        access: 'read',
        inputSchema: reverseGeocodeInputSchema,
        outputSchema: reverseGeocodeOutputSchema,
        timeoutMs: 10_000,
        async handler(rawInput, call): Promise<ReverseGeocodeOutput> {
          const config = parseGeocoderConfig(await context.configFor(call.scopeId, call.actorIdentityId));
          const input = effectiveReverseGeocodeInput(rawInput as ReverseGeocodeInput, config);
          const provider = providerFor(config);
          const cacheKey = responseCacheKey(call.scopeId, config, GEOCODER_REVERSE_GEOCODE_METHOD, input);
          const cached = await readCached(context.ephemeralStore, cacheKey, reverseGeocodeOutputSchema);
          if (cached) {
            return { ...cached, place: cached.place ? withPlaceTimezone(cached.place) : null };
          }
          await waitForProviderSlot(context.ephemeralStore, providerRateKey(config), config, call.signal);
          const filledWhileWaiting = await readCached(
            context.ephemeralStore,
            cacheKey,
            reverseGeocodeOutputSchema
          );
          if (filledWhileWaiting) {
            return { ...filledWhileWaiting, place: filledWhileWaiting.place ? withPlaceTimezone(filledWhileWaiting.place) : null };
          }
          const place = await provider.reverseGeocode(input, call.signal);
          const output = reverseGeocodeOutputSchema.parse({
            provider: provider.providerId,
            fetchedAt: new Date().toISOString(),
            place: place ? withPlaceTimezone(place) : null
          });
          await context.ephemeralStore.set(
            cacheKey,
            output,
            place ? config.cache.reverseTtlSeconds : config.cache.notFoundTtlSeconds
          );
          return output;
        }
      },
      {
        name: GEOCODER_MAP_LINKS_METHOD,
        access: 'read',
        inputSchema: mapLinksInputSchema,
        outputSchema: mapLinksOutputSchema,
        handler(rawInput): MapLinksOutput {
          return mapLinks(rawInput as MapLinksInput);
        }
      }
    ]
  }];
}

async function geocodeCached(
  context: ServicePluginContext,
  config: GeocoderConfig,
  rawInput: GeocodeInput,
  call: PluginServiceCallContext
): Promise<GeocodeOutput> {
  const input = effectiveGeocodeInput(rawInput, config);
  const provider = providerFor(config);
  const cacheKey = responseCacheKey(call.scopeId, config, GEOCODER_GEOCODE_METHOD, input);
  const cached = await readCached(context.ephemeralStore, cacheKey, geocodeOutputSchema);
  if (cached) {
    return { ...cached, results: cached.results.map(withPlaceTimezone) };
  }
  await waitForProviderSlot(context.ephemeralStore, providerRateKey(config), config, call.signal);
  const filledWhileWaiting = await readCached(context.ephemeralStore, cacheKey, geocodeOutputSchema);
  if (filledWhileWaiting) {
    return { ...filledWhileWaiting, results: filledWhileWaiting.results.map(withPlaceTimezone) };
  }
  const results = (await provider.geocode(input, call.signal)).map(withPlaceTimezone);
  const output = geocodeOutputSchema.parse({
    provider: provider.providerId,
    fetchedAt: new Date().toISOString(),
    results
  });
  await context.ephemeralStore.set(
    cacheKey,
    output,
    results.length > 0 ? config.cache.successTtlSeconds : config.cache.notFoundTtlSeconds
  );
  return output;
}

/**
 * Remembered places for this exact text come first; the provider search is biased (not limited) to the
 * area of this scope's remembered places; candidates are ranked, de-duplicated and judged confident or not.
 */
/** Ask the provider for its full page so local ranking has room; the caller still gets `limit`. */
const PROVIDER_RESULTS = 10;

export async function resolvePlace(
  context: ServicePluginContext,
  config: GeocoderConfig,
  input: ResolveInput,
  call: PluginServiceCallContext
): Promise<ResolveOutput> {
  const searchQuery = searchQueryFor(input.query);
  const memory = await readPlaceMemory(memoryStore(context), call.scopeId);
  const rememberedForText = placesForText(memory, input.query).map((entry) => entry.place);
  const knownPlaces = memory.places.map((entry) => entry.place);
  const area = usualAreaBounds(knownPlaces.map((place) => place.point));
  let provider = 'memory';
  let fetchedAt = new Date().toISOString();
  let results: GeocoderPlace[] = [];
  if (!input.memoryOnly && searchQuery.length >= 2) {
    // The usual area ranks results here instead of going to the provider as a viewbox: Nominatim's
    // non-bounded viewbox can drop the right places altogether ("Lagos" near Lisbon returned only "Laos").
    const output = await geocodeCached(context, config, {
      query: searchQuery,
      limit: PROVIDER_RESULTS,
      restrictToBounds: false,
      ...(input.language ? { language: input.language } : {}),
      ...(input.countryCodes ? { countryCodes: input.countryCodes } : {})
    }, call);
    provider = output.provider;
    fetchedAt = output.fetchedAt;
    results = output.results;
  }
  const ranked = rankCandidates({ remembered: rememberedForText, provider: results, knownPlaces, searchQuery, area });
  // Two remembered places for the same words are a real ambiguity, not a memory hit.
  const rememberedText = rememberedForText.length === 1;
  const decision = decide(ranked, rememberedText, searchQuery);
  const candidates = decision.candidates.slice(0, input.limit).map((candidate) => ({
    place: withPlaceTimezone(candidate.place),
    shortLabel: shortLabel(candidate.place),
    remembered: candidate.remembered,
    nameMatch: candidate.nameMatch
  }));
  const { t } = await geocoderTranslator(context, call.scopeId, input.language ?? config.defaultLanguage);
  const others = candidates.slice(1, 4).map((candidate) => candidate.shortLabel);
  return resolveOutputSchema.parse({
    status: decision.status,
    query: input.query,
    searchQuery,
    remembered: rememberedText && decision.status === 'resolved',
    provider,
    fetchedAt,
    candidates,
    presentation: {
      optionLines: optionLines(candidates, t),
      optionLabels: candidates.map((candidate) => optionLabel(candidate, t)),
      ...(decision.status === 'ambiguous' && others.length > 0
        ? { alternatives: t('official.geocoder.alternatives', { places: others.join(' · ') }) }
        : {})
    }
  });
}

function optionLabel(candidate: { place: GeocoderPlace; remembered: boolean }, t: TranslateFn): string {
  return candidate.remembered
    ? t('official.geocoder.option.remembered', { label: candidate.place.label })
    : candidate.place.label;
}

function optionLines(candidates: Array<{ place: GeocoderPlace; remembered: boolean }>, t: TranslateFn): string[] {
  return candidates.map((candidate, index) => t('official.geocoder.option.line', {
    number: index + 1,
    label: optionLabel(candidate, t)
  }));
}

type RuntimeI18n = {
  translator(locale: string, scopes?: unknown): TranslateFn;
  resolveScopeLocale?(scopeId: string): Promise<{ locale: string; languagePackScopes?: unknown }>;
};

/**
 * Plugin services receive the platform's i18n service and durable data store at runtime, though the
 * SDK context type does not declare them yet; without them this falls back to the shipped catalogs
 * and an empty place memory.
 */
async function geocoderTranslator(
  context: ServicePluginContext,
  scopeId: string,
  language: string
): Promise<{ t: TranslateFn; locale: string }> {
  const i18n = (context as { i18n?: RuntimeI18n }).i18n;
  if (i18n && typeof i18n.translator === 'function') {
    let scopes: unknown;
    try {
      scopes = (await i18n.resolveScopeLocale?.(scopeId))?.languagePackScopes;
    } catch {
      scopes = undefined;
    }
    return { t: i18n.translator(language, scopes), locale: language };
  }
  return { t: bundledTranslator(language), locale: language };
}

function memoryStore(context: ServicePluginContext): PlaceMemoryStore | undefined {
  const store = (context as { dataStore?: Partial<PlaceMemoryStore> }).dataStore;
  return store && typeof store.get === 'function' && typeof store.set === 'function'
    ? store as PlaceMemoryStore
    : undefined;
}

export function mapLinks(input: MapLinksInput): MapLinksOutput {
  const point = `${input.latitude},${input.longitude}`;
  const openStreetMap = new URL('https://www.openstreetmap.org/');
  openStreetMap.searchParams.set('mlat', String(input.latitude));
  openStreetMap.searchParams.set('mlon', String(input.longitude));
  openStreetMap.hash = `map=${input.zoom}/${input.latitude}/${input.longitude}`;

  const query = input.label ? `${point}(${input.label})` : point;
  return {
    openStreetMapUrl: openStreetMap.toString(),
    geoUri: `geo:${point}?q=${encodeURIComponent(query)}`
  };
}

function effectiveGeocodeInput(input: GeocodeInput, config: GeocoderConfig): GeocodeInput {
  const countryCodes = input.countryCodes ?? config.defaultCountryCodes;
  return {
    ...input,
    language: input.language ?? config.defaultLanguage,
    ...(countryCodes.length > 0
      ? { countryCodes: [...new Set(countryCodes.map((code) => code.toUpperCase()))].sort() }
      : {})
  };
}

function effectiveReverseGeocodeInput(
  input: ReverseGeocodeInput,
  config: GeocoderConfig
): ReverseGeocodeInput {
  return {
    ...input,
    language: input.language ?? config.defaultLanguage
  };
}

function providerFor(config: GeocoderConfig): GeocoderProvider {
  switch (config.provider) {
    case 'nominatim':
      return new NominatimGeocoderProvider(config.providerSettings.nominatim);
  }
}

function responseCacheKey(
  scopeId: string,
  config: GeocoderConfig,
  method: string,
  input: unknown
): string {
  return `response:${hash({
    scopeId,
    method,
    provider: config.provider,
    providerEndpoint: config.providerSettings.nominatim.baseUrl,
    input
  })}`;
}

function providerRateKey(config: GeocoderConfig): string {
  return `provider-rate:${hash({
    provider: config.provider,
    providerEndpoint: config.providerSettings.nominatim.baseUrl
  })}`;
}

function hash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

async function readCached<T>(
  store: PluginEphemeralStore,
  key: string,
  schema: z.ZodType<T>
): Promise<T | undefined> {
  const cached = await store.get<unknown>(key);
  if (cached === undefined) {
    return undefined;
  }
  const parsed = schema.safeParse(cached);
  if (parsed.success) {
    return parsed.data;
  }
  await store.delete(key);
  return undefined;
}

async function waitForProviderSlot(
  store: PluginEphemeralStore,
  key: string,
  config: GeocoderConfig,
  signal?: AbortSignal | undefined
): Promise<void> {
  const minimumIntervalMs = config.rateLimit.minimumIntervalMs;
  if (minimumIntervalMs <= 0) {
    return;
  }
  const deadline = Date.now() + 2_500;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error('Geocoder provider request aborted.');
    }
    if (await store.setIfAbsent(key, { acquiredAt: new Date().toISOString() }, minimumIntervalMs)) {
      return;
    }
    await abortableDelay(Math.min(100, Math.max(1, deadline - Date.now())), signal);
  }
  throw new Error('Geocoder provider capacity is currently unavailable.');
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    throw new Error('Geocoder provider request aborted.');
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abortHandler);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abortHandler = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('Geocoder provider request aborted.'));
    };
    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
      if (signal.aborted) {
        abortHandler();
      }
    }
  });
}
