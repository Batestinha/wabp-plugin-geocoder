import type { PluginServiceRegistration } from '../../../platform/pluginRuntime/pluginServices';
import type { PluginServiceRegistrationContext } from '../../../platform/pluginRuntime/types';
import { parseGeocoderConfig } from './config';
import {
  GEOCODER_GEOCODE_METHOD,
  GEOCODER_MAP_LINKS_METHOD,
  GEOCODER_REVERSE_GEOCODE_METHOD,
  GEOCODER_SERVICE_ID,
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

export function registerGeocoderServices(context: PluginServiceRegistrationContext): PluginServiceRegistration[] {
  return [{
    serviceId: GEOCODER_SERVICE_ID,
    methods: [
      {
        name: GEOCODER_GEOCODE_METHOD,
        access: 'read',
        inputSchema: geocodeInputSchema,
        outputSchema: geocodeOutputSchema,
        timeoutMs: 10_000,
        async handler(rawInput, call): Promise<GeocodeOutput> {
          const input = rawInput as GeocodeInput;
          parseGeocoderConfig(await context.configFor(call.scopeId, call.actorWid));
          void input;
          throw new Error('Geocoder provider implementation is not available.');
        }
      },
      {
        name: GEOCODER_REVERSE_GEOCODE_METHOD,
        access: 'read',
        inputSchema: reverseGeocodeInputSchema,
        outputSchema: reverseGeocodeOutputSchema,
        timeoutMs: 10_000,
        async handler(rawInput, call): Promise<ReverseGeocodeOutput> {
          const input = rawInput as ReverseGeocodeInput;
          parseGeocoderConfig(await context.configFor(call.scopeId, call.actorWid));
          void input;
          throw new Error('Geocoder provider implementation is not available.');
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
