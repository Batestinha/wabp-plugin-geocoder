import { z } from 'zod';
import type { NominatimSettings } from '../config';
import {
  geocoderPlaceSchema,
  type GeocodeInput,
  type GeocoderAddress,
  type GeocoderAttribution,
  type GeocoderBoundingBox,
  type GeocoderPlace,
  type ReverseGeocodeInput
} from '../serviceApi';
import type { GeocoderProvider } from './provider';

const NOMINATIM_RESPONSE_MAX_BYTES = 1_048_576;
const NOMINATIM_REQUEST_TIMEOUT_MS = 7_000;
const OSM_ATTRIBUTION_TEXT = 'Data © OpenStreetMap contributors, ODbL 1.0';
const OSM_ATTRIBUTION: GeocoderAttribution = {
  text: OSM_ATTRIBUTION_TEXT,
  url: 'https://www.openstreetmap.org/copyright'
};

const nominatimGeocodingPropertiesSchema = z.object({
  place_id: z.union([z.string(), z.number()]).optional(),
  osm_type: z.string().optional(),
  osm_id: z.union([z.string(), z.number()]).optional(),
  osm_key: z.string().optional(),
  osm_value: z.string().optional(),
  type: z.string().optional(),
  label: z.string().min(1),
  name: z.string().optional(),
  housenumber: z.string().optional(),
  street: z.string().optional(),
  locality: z.string().optional(),
  district: z.string().optional(),
  postcode: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  country_code: z.string().optional()
}).passthrough();

const nominatimFeatureSchema = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    geocoding: nominatimGeocodingPropertiesSchema
  }).passthrough(),
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number().finite(), z.number().finite()])
  }).passthrough(),
  bbox: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite()
  ]).optional()
}).passthrough();

const nominatimResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  geocoding: z.object({
    attribution: z.string().optional()
  }).passthrough().optional(),
  features: z.array(nominatimFeatureSchema).max(40)
}).passthrough();

const nominatimErrorSchema = z.object({
  error: z.string().min(1)
}).passthrough();

type NominatimFeature = z.infer<typeof nominatimFeatureSchema>;

export class NominatimGeocoderProvider implements GeocoderProvider {
  readonly providerId = 'nominatim';
  readonly attribution = OSM_ATTRIBUTION;
  private readonly baseUrl: URL;

  constructor(private readonly settings: NominatimSettings) {
    this.baseUrl = validatedBaseUrl(settings.baseUrl);
  }

  async geocode(input: GeocodeInput, signal?: AbortSignal | undefined): Promise<GeocoderPlace[]> {
    const url = this.endpoint('search');
    url.searchParams.set('q', input.query);
    url.searchParams.set('format', 'geocodejson');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', String(input.limit));
    if (input.language) {
      url.searchParams.set('accept-language', input.language);
    }
    if (input.countryCodes && input.countryCodes.length > 0) {
      url.searchParams.set('countrycodes', input.countryCodes.map((code) => code.toLowerCase()).join(','));
    }
    if (input.bounds) {
      url.searchParams.set(
        'viewbox',
        [input.bounds.west, input.bounds.north, input.bounds.east, input.bounds.south].join(',')
      );
      if (input.restrictToBounds) {
        url.searchParams.set('bounded', '1');
      }
    }
    this.addContactEmail(url);
    const response = await this.fetchResponse(url, signal);
    if (!response) {
      return [];
    }
    return response.features.slice(0, input.limit).map((feature) => this.place(feature));
  }

  async reverseGeocode(
    input: ReverseGeocodeInput,
    signal?: AbortSignal | undefined
  ): Promise<GeocoderPlace | null> {
    const url = this.endpoint('reverse');
    url.searchParams.set('lat', String(input.latitude));
    url.searchParams.set('lon', String(input.longitude));
    url.searchParams.set('format', 'geocodejson');
    url.searchParams.set('addressdetails', '1');
    if (input.language) {
      url.searchParams.set('accept-language', input.language);
    }
    this.addContactEmail(url);
    const response = await this.fetchResponse(url, signal, true);
    if (!response) {
      return null;
    }
    const feature = response.features[0];
    return feature ? this.place(feature) : null;
  }

  private endpoint(method: 'search' | 'reverse'): URL {
    const base = this.baseUrl.toString().replace(/\/+$/, '');
    return new URL(`${base}/${method}`);
  }

  private addContactEmail(url: URL): void {
    if (this.settings.contactEmail) {
      url.searchParams.set('email', this.settings.contactEmail);
    }
  }

  private async fetchResponse(
    url: URL,
    signal?: AbortSignal | undefined,
    allowNotFound = false
  ) {
    return withProviderTimeout(signal, async (requestSignal) => {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'user-agent': this.settings.userAgent
        },
        signal: requestSignal
      });
      if (allowNotFound && response.status === 404) {
        return null;
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        throw new Error(`Geocoder provider rate limited the request${retryAfter ? `; retry after ${retryAfter}` : ''}.`);
      }
      if (!response.ok) {
        throw new Error(`Geocoder provider request failed with HTTP ${response.status}.`);
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('json')) {
        throw new Error('Geocoder provider returned a non-JSON response.');
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > NOMINATIM_RESPONSE_MAX_BYTES) {
        throw new Error('Geocoder provider response exceeded the size limit.');
      }
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > NOMINATIM_RESPONSE_MAX_BYTES) {
        throw new Error('Geocoder provider response exceeded the size limit.');
      }
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        throw new Error('Geocoder provider returned invalid JSON.');
      }
      if (allowNotFound && nominatimErrorSchema.safeParse(json).success) {
        return null;
      }
      const parsed = nominatimResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error('Geocoder provider returned an invalid response.');
      }
      return parsed.data;
    });
  }

  private place(feature: NominatimFeature): GeocoderPlace {
    const source = feature.properties.geocoding;
    const [longitude, latitude] = feature.geometry.coordinates;
    const countryCode = normalizedCountryCode(source.country_code);
    const address = compactAddress({
      houseNumber: clean(source.housenumber),
      street: clean(source.street),
      locality: clean(source.locality),
      district: clean(source.district),
      city: clean(source.city),
      county: clean(source.county),
      state: clean(source.state),
      postcode: clean(source.postcode),
      country: clean(source.country),
      ...(countryCode ? { countryCode } : {})
    });
    const boundingBox = feature.bbox ? normalizedBoundingBox(feature.bbox) : undefined;
    return geocoderPlaceSchema.parse({
      label: source.label,
      ...(clean(source.name) ? { name: clean(source.name) } : {}),
      point: { latitude, longitude },
      address,
      ...(boundingBox ? { boundingBox } : {}),
      ...(clean(source.osm_key) ? { category: clean(source.osm_key) } : {}),
      ...(clean(source.type ?? source.osm_value) ? { type: clean(source.type ?? source.osm_value) } : {}),
      ...(providerReference(source) ? { providerRef: providerReference(source) } : {}),
      attribution: this.attribution
    });
  }
}

function validatedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Nominatim base URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('Nominatim base URL must not include credentials or a fragment.');
  }
  return url;
}

function compactAddress(input: GeocoderAddress): GeocoderAddress {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
  );
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizedCountryCode(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function normalizedBoundingBox(
  value: [number, number, number, number]
): GeocoderBoundingBox | undefined {
  const [west, south, east, north] = value;
  const parsed = {
    south,
    west,
    north,
    east
  };
  return south <= north && west <= east ? parsed : undefined;
}

function providerReference(source: z.infer<typeof nominatimGeocodingPropertiesSchema>): string | undefined {
  if (source.osm_type && source.osm_id !== undefined) {
    return `${source.osm_type}:${source.osm_id}`;
  }
  return source.place_id !== undefined ? `place:${source.place_id}` : undefined;
}

async function withProviderTimeout<T>(
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (signal?.aborted) {
    throw new Error('Geocoder provider request aborted.');
  }
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, NOMINATIM_REQUEST_TIMEOUT_MS);
  const abortHandler = () => controller.abort();
  signal?.addEventListener('abort', abortHandler, { once: true });
  try {
    return await run(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new Error(`Geocoder provider request timed out after ${NOMINATIM_REQUEST_TIMEOUT_MS}ms.`);
    }
    if (signal?.aborted) {
      throw new Error('Geocoder provider request aborted.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortHandler);
  }
}
