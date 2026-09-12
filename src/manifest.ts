import type { PluginManifest } from '@wabs/plugin-sdk/manifest';
import { geocoderConfigSchema } from './config';
import { geocoderMessages } from './messages';
import {
  GEOCODER_GEOCODE_METHOD,
  GEOCODER_MAP_LINKS_METHOD,
  GEOCODER_REVERSE_GEOCODE_METHOD,
  GEOCODER_TIMEZONE_METHOD,
  GEOCODER_SERVICE_ID
} from './serviceApi';

export const GEOCODER_PLUGIN_ID = 'official.geocoder';

export const geocoderManifest: PluginManifest = {
  pluginId: GEOCODER_PLUGIN_ID,
  kind: 'managed_group',
  version: '0.2.0',
  coreApiRange: '^0.3.0',
  messageNamespace: 'official.geocoder',
  descriptionKey: 'official.geocoder.description',
  defaultMessages: geocoderMessages,
  commands: [],
  help: {
    featureId: 'geocoding',
    titleKey: 'official.geocoder.help.feature.title',
    summaryKey: 'official.geocoder.help.feature.summary',
    order: 100,
    aliases: ['maps', 'location lookup'],
    topics: [{
      topicId: 'location-lookup',
      titleKey: 'official.geocoder.help.lookup.title',
      summaryKey: 'official.geocoder.help.lookup.summary',
      instructionKeys: ['official.geocoder.help.lookup.instruction'],
      keywords: ['place', 'address', 'coordinates', 'map'],
      availability: { invocation: 'either', permission: 'plugin.configure' }
    }]
  },
  eventSubscriptions: [],
  services: [{
    serviceId: GEOCODER_SERVICE_ID,
    description: 'Provider-neutral forward geocoding, reverse geocoding, and map links.',
    methods: [{ name: GEOCODER_TIMEZONE_METHOD, access: 'read' },
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
