import type { PluginManifest } from '../../../platform/pluginRuntime/manifest';
import { geocoderConfigSchema } from './config';
import { geocoderMessages } from './messages';
import {
  GEOCODER_GEOCODE_METHOD,
  GEOCODER_MAP_LINKS_METHOD,
  GEOCODER_REVERSE_GEOCODE_METHOD,
  GEOCODER_SERVICE_ID
} from './serviceApi';

export const GEOCODER_PLUGIN_ID = 'official.geocoder';

export const geocoderManifest: PluginManifest = {
  pluginId: GEOCODER_PLUGIN_ID,
  kind: 'managed_group',
  version: '0.1.0',
  coreApiRange: '>=0.2.0',
  messageNamespace: 'official.geocoder',
  descriptionKey: 'official.geocoder.description',
  defaultMessages: geocoderMessages,
  commands: [],
  eventSubscriptions: [],
  services: [{
    serviceId: GEOCODER_SERVICE_ID,
    description: 'Provider-neutral forward geocoding, reverse geocoding, and map links.',
    methods: [
      {
        name: GEOCODER_GEOCODE_METHOD,
        access: 'read',
        timeoutMs: 10_000
      },
      {
        name: GEOCODER_REVERSE_GEOCODE_METHOD,
        access: 'read',
        timeoutMs: 10_000
      },
      {
        name: GEOCODER_MAP_LINKS_METHOD,
        access: 'read'
      }
    ]
  }],
  requiredPermissions: [],
  requiredBotCapabilities: [],
  configSchema: geocoderConfigSchema,
  dangerousActions: [],
  backgroundJobs: [],
  cancellation: { workflows: [] }
};
