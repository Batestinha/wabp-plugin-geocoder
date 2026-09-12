import { timezoneForPoint, withPlaceTimezone } from './timezone';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { PluginServiceRegistration } from '@wabs/plugin-sdk/services';
import type { PluginEphemeralStore } from '@wabs/plugin-sdk/ephemeral-store';
import type { ServicePluginContext } from '@wabs/plugin-sdk/service-plugin';
import { parseGeocoderConfig, type GeocoderConfig } from './config';
import { NominatimGeocoderProvider } from './providers/nominatim';
import type { GeocoderProvider } from './providers/provider';
import {
  GEOCODER_GEOCODE_METHOD,
  GEOCODER_MAP_LINKS_METHOD,
  GEOCODER_REVERSE_GEOCODE_METHOD,
  GEOCODER_SERVICE_ID,
  GEOCODER_TIMEZONE_METHOD,
  geocoderPointSchema,
  geocoderTimezoneOutputSchema,
  type GeocoderPoint,
  type GeocodeInput,
  type GeocodeOutput,
  type MapLinksInput,
  type MapLinksOutput,
  type ReverseGeocodeInput,
  type ReverseGeocodeOutput,
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
          const input = effectiveGeocodeInput(rawInput as GeocodeInput, config);
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
