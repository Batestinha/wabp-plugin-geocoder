const { test } = require('node:test');
const assert = require('node:assert/strict');
const { geocoderPlugin } = require('../dist');
const { timezoneForPoint } = require('../dist/timezone');
const { geocodeInputSchema, mapLinksInputSchema } = require('../dist/serviceApi');
const { mapLinks } = require('../dist/service');
const { validatePluginManifest } = require('@wabs/plugin-sdk/manifest');

for (const [latitude, longitude, timezone] of [
  [38.7223, -9.1393, 'Europe/Lisbon'],
  [41.1579, -8.6291, 'Europe/Lisbon'],
  [32.6669, -16.9241, 'Atlantic/Madeira'],
  [37.7412, -25.6756, 'Atlantic/Azores'],
  [35.6762, 139.6503, 'Asia/Tokyo']
]) {
  test(`offline coordinates resolve ${timezone}`, () => {
    assert.deepEqual(timezoneForPoint({ latitude, longitude }), { timezone, candidates: [timezone] });
  });
}

test('an ambiguous position never silently selects a single timezone', () => {
  const result = timezoneForPoint({ latitude: 90, longitude: 0 });
  assert.equal(result.timezone, null);
  assert.ok(result.candidates.length > 1);
  assert.throws(() => timezoneForPoint({ latitude: 91, longitude: 0 }));
});

test('service-only manifest and input contracts reject undeclared input', () => {
  validatePluginManifest(geocoderPlugin.manifest);
  assert.deepEqual(geocoderPlugin.manifest.commands, []);
  assert.equal(geocoderPlugin.registerCommands, undefined);
  assert.equal(geocodeInputSchema.safeParse({ query: 'Lisbon', extra: true }).success, false);
  assert.equal(geocodeInputSchema.safeParse({ query: 'Lisbon', restrictToBounds: true }).success, false);
  const links = mapLinks(mapLinksInputSchema.parse({ latitude: 38.7904, longitude: -9.4923, label: 'Praia da Ursa', zoom: 16 }));
  assert.equal(links.geoUri, 'geo:38.7904,-9.4923?q=38.7904%2C-9.4923(Praia%20da%20Ursa)');
});

test('forward results retain attribution, timezone, and scope-isolated cached responses', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.hostname, 'provider.example.test');
    assert.equal(url.searchParams.get('accept-language'), 'pt-PT');
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [-9.4923, 38.7904] },
      properties: { geocoding: { label: 'Praia da Ursa, Sintra, Portugal', name: 'Praia da Ursa', osm_type: 'node', osm_id: 123, country: 'Portugal', country_code: 'pt' } }
    }] }), { headers: { 'content-type': 'application/json' } });
  });
  const method = serviceMethod('geocode');
  const input = method.inputSchema.parse({ query: 'Praia da Ursa' });
  const first = await method.handler(input, callContext('scope-1'));
  assert.equal(first.results[0].timezone, 'Europe/Lisbon');
  assert.equal(first.results[0].attribution.url, 'https://www.openstreetmap.org/copyright');
  assert.deepEqual(await method.handler(input, callContext('scope-1')), first);
  await method.handler(input, callContext('scope-2'));
  assert.equal(calls, 2);
});

test('cancelled lookup does not call the provider', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider request'); });
  const method = serviceMethod('reverseGeocode');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(method.handler(method.inputSchema.parse({ latitude: 38.7904, longitude: -9.4923 }), {
    ...callContext('scope-1'), signal: controller.signal
  }), /aborted/);
  assert.equal(fetch.mock.callCount(), 0);
});

function serviceMethod(name) {
  const entries = new Map();
  const context = {
    pluginId: geocoderPlugin.manifest.pluginId,
    manifest: geocoderPlugin.manifest,
    ephemeralStore: {
      get: async (key) => entries.get(key),
      set: async (key, value) => { entries.set(key, structuredClone(value)); },
      setIfAbsent: async (key, value) => { if (entries.has(key)) return false; entries.set(key, value); return true; },
      delete: async (key) => Number(entries.delete(key)),
      increment: async () => { throw new Error('Unexpected fixture operation'); },
      admitRateLimit: async () => { throw new Error('Unexpected fixture operation'); }
    },
    configFor: async () => ({ defaultLanguage: 'pt-PT', rateLimit: { minimumIntervalMs: 0 }, providerSettings: {
      nominatim: { baseUrl: 'https://provider.example.test', userAgent: 'GeocoderTest/1.0', contactEmail: '' }
    } }),
    enabledFor: async () => true
  };
  const method = geocoderPlugin.registerServices(context)[0].methods.find((method) => method.name === name);
  assert.ok(method);
  return method;
}

function callContext(scopeId) {
  return { callerPluginId: 'fixture.consumer', providerPluginId: 'official.geocoder', serviceId: 'official.geocoder.v1', method: 'geocode', scopeId };
}
