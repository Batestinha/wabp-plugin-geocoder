import { defineControl } from '../../../platform/operatorConsole/controlCatalog/define';
import type {
  ControlDescriptor,
  ControlSchemaMetadata,
  ControlUiHint
} from '../../../platform/operatorConsole/controlCatalog/types';
import { GEOCODER_PLUGIN_ID } from './manifest';

const PROVIDER_OPTIONS = [{ value: 'nominatim', label: 'Nominatim' }];

function control(input: {
  path: string;
  label: string;
  description: string;
  section: string;
  order: number;
  schema: ControlSchemaMetadata;
  ui: ControlUiHint;
  sensitive?: boolean | undefined;
}): ControlDescriptor {
  return defineControl({
    id: `plugin.${GEOCODER_PLUGIN_ID}.${input.path}`,
    label: input.label,
    description: input.description,
    plane: 'plugin-scope-config',
    domain: 'official-plugin-settings',
    section: input.section,
    order: input.order,
    visibility: 'bot_admin',
    configurable: true,
    storage: { kind: 'plugin-scope-config', pluginId: GEOCODER_PLUGIN_ID, path: input.path },
    schema: input.schema,
    ui: { helpText: input.description, ...input.ui },
    restartRequirement: 'NO_RESTART',
    dangerous: false,
    sensitivity: input.sensitive
      ? { sensitive: true, redact: 'configured-state' }
      : { sensitive: false, redact: 'none' },
    auditAction: 'operator_console.plugin_config.update',
    relatedCommandIds: [],
    relatedActionIds: []
  });
}

export const geocoderControls: ControlDescriptor[] = [
  control({
    path: 'provider',
    label: 'Provider',
    description: 'Geocoding provider used by plugin service calls.',
    section: 'Geocoder',
    order: 10,
    schema: { type: 'enum', enum: PROVIDER_OPTIONS },
    ui: { widget: 'segmented', options: PROVIDER_OPTIONS }
  }),
  control({
    path: 'defaultLanguage',
    label: 'Default language',
    description: 'BCP 47 language tag used when a service caller does not provide one.',
    section: 'Geocoder defaults',
    order: 20,
    schema: { type: 'string', required: true, min: 2, max: 35 },
    ui: { widget: 'text', placeholder: 'pt-PT' }
  }),
  control({
    path: 'defaultCountryCodes',
    label: 'Default countries',
    description: 'Optional ISO alpha-2 country filters used when a service caller does not provide country codes.',
    section: 'Geocoder defaults',
    order: 30,
    schema: {
      type: 'array',
      max: 10,
      items: { type: 'string', min: 2, max: 2 }
    },
    ui: { widget: 'tags', placeholder: 'PT' }
  }),
  control({
    path: 'cache.successTtlSeconds',
    label: 'Search cache TTL',
    description: 'Seconds to cache successful forward-geocoding responses.',
    section: 'Geocoder cache',
    order: 100,
    schema: { type: 'number', unit: 'seconds', min: 60, max: 604_800 },
    ui: { widget: 'duration' }
  }),
  control({
    path: 'cache.reverseTtlSeconds',
    label: 'Reverse cache TTL',
    description: 'Seconds to cache successful reverse-geocoding responses.',
    section: 'Geocoder cache',
    order: 110,
    schema: { type: 'number', unit: 'seconds', min: 60, max: 2_592_000 },
    ui: { widget: 'duration' }
  }),
  control({
    path: 'cache.notFoundTtlSeconds',
    label: 'Not-found cache TTL',
    description: 'Seconds to cache searches or reverse lookups that return no place.',
    section: 'Geocoder cache',
    order: 120,
    schema: { type: 'number', unit: 'seconds', min: 30, max: 86_400 },
    ui: { widget: 'duration' }
  }),
  control({
    path: 'rateLimit.minimumIntervalMs',
    label: 'Minimum request interval',
    description: 'Minimum milliseconds between requests to the configured provider endpoint across runtime processes.',
    section: 'Geocoder provider',
    order: 200,
    schema: { type: 'number', unit: 'milliseconds', min: 0, max: 60_000 },
    ui: { widget: 'duration' }
  }),
  control({
    path: 'providerSettings.nominatim.baseUrl',
    label: 'Nominatim endpoint',
    description: 'Base URL of the Nominatim-compatible geocoding service.',
    section: 'Geocoder provider',
    order: 210,
    schema: { type: 'string', format: 'url', required: true },
    ui: { widget: 'url', placeholder: 'https://nominatim.openstreetmap.org' }
  }),
  control({
    path: 'providerSettings.nominatim.userAgent',
    label: 'Provider user agent',
    description: 'Identifying User-Agent sent with Nominatim requests.',
    section: 'Geocoder provider',
    order: 220,
    schema: { type: 'string', required: true, min: 3, max: 512 },
    ui: { widget: 'text', placeholder: 'WhatsAppBotPlatform/0.1' }
  }),
  control({
    path: 'providerSettings.nominatim.contactEmail',
    label: 'Provider contact email',
    description: 'Optional contact email sent to Nominatim for request identification.',
    section: 'Geocoder provider',
    order: 230,
    schema: { type: 'string', max: 320 },
    ui: { widget: 'text', placeholder: 'operator@example.com' },
    sensitive: true
  })
];
