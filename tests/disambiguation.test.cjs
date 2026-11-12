const { test } = require('node:test');
const assert = require('node:assert/strict');
const { geocoderPlugin } = require('../dist');
const { searchQueryFor, typedChoice, usualAreaBounds, replyMeaning, shortLabel } = require('../dist/disambiguation');
const { mergePlaceMemory } = require('../dist/placeMemory');
const { resolveOutputSchema, chooseOutputSchema } = require('../dist/serviceApi');

const attribution = { text: 'fixture', url: 'https://example.test' };
function place(label, latitude, longitude, address = {}, extra = {}) {
  return { label, point: { latitude, longitude }, address, attribution, ...extra };
}
const SINTRA = place('Sintra, Lisboa, Portugal', 38.7976, -9.3881, { city: 'Sintra', state: 'Lisboa', country: 'Portugal' }, { name: 'Sintra', providerRef: 'node:1' });
const SINTRA_BR = place('Sintra, Minas Gerais, Brasil', -20.1, -44.2, { state: 'Minas Gerais', country: 'Brasil' }, { name: 'Sintra', providerRef: 'node:2' });
const LAGOS_PT = place('Lagos, Faro, Portugal', 37.1028, -8.6730, { county: 'Lagos', state: 'Faro', country: 'Portugal' }, { name: 'Lagos', providerRef: 'node:3' });
const LAGOS_NG = place('Lagos, Lagos State, Nigeria', 6.4550, 3.3841, { state: 'Lagos State', country: 'Nigeria' }, { name: 'Lagos', providerRef: 'node:4' });
const CASCAIS = place('Cascais, Lisboa, Portugal', 38.6970, -9.4215, { state: 'Lisboa', country: 'Portugal' }, { name: 'Cascais', providerRef: 'node:5' });
const SESIMBRA = place('Sesimbra, Setúbal, Portugal', 38.4437, -9.0996, { state: 'Setúbal', country: 'Portugal' }, { name: 'Sesimbra', providerRef: 'node:6' });

function harness(providerResults, options = {}) {
  const records = new Map();
  const providerQueries = [];
  const writes = [];
  const context = {
    pluginId: geocoderPlugin.manifest.pluginId,
    manifest: geocoderPlugin.manifest,
    ephemeralStore: {
      get: async () => undefined, set: async () => {}, setIfAbsent: async () => true, delete: async () => 0
    },
    ...(options.noDataStore ? {} : { dataStore: {
      get: async (key, scopeId) => structuredClone(records.get(`${scopeId}:${key}`)),
      set: async (key, value, scopeId) => { writes.push(key); records.set(`${scopeId}:${key}`, structuredClone(value)); }
    } }),
    configFor: async () => ({ defaultLanguage: 'pt-PT', rateLimit: { minimumIntervalMs: 0 }, providerSettings: {
      nominatim: { baseUrl: 'https://provider.example.test', userAgent: 'GeocoderTest/1.0', contactEmail: '' }
    } }),
    enabledFor: async () => true
  };
  const methods = geocoderPlugin.registerServices(context)[0].methods;
  const method = name => methods.find(item => item.name === name);
  globalThis.fetch = async input => {
    const url = new URL(input);
    providerQueries.push(url);
    const results = typeof providerResults === 'function' ? providerResults(url.searchParams.get('q')) : providerResults;
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: results.map(item => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [item.point.longitude, item.point.latitude] },
      properties: { geocoding: {
        label: item.label, name: item.name, osm_type: 'node', osm_id: Number(item.providerRef.split(':')[1]),
        ...(item.address.city ? { city: item.address.city } : {}), ...(item.address.county ? { county: item.address.county } : {}),
        ...(item.address.state ? { state: item.address.state } : {}), country: item.address.country
      } }
    })) }), { headers: { 'content-type': 'application/json' } });
  };
  const call = { callerPluginId: 'fixture.consumer', providerPluginId: 'official.geocoder', serviceId: 'official.geocoder.v1', method: 'resolve', scopeId: 'scope-a' };
  return {
    providerQueries, writes,
    resolve: (query, extra = {}) => method('resolve').handler(method('resolve').inputSchema.parse({ query, language: 'pt-PT', ...extra }), call),
    choose: input => method('choose').handler(method('choose').inputSchema.parse({ language: 'pt-PT', ...input }), call),
    remember: (places, source = 'confirmed') => method('remember').handler(method('remember').inputSchema.parse({ places, source }), call)
  };
}

test('notes and alternatives stay out of the search, as event answers had them', () => {
  assert.equal(searchQueryFor('Tapada (maybe?)'), 'Tapada');
  assert.equal(searchQueryFor('Cascais/Sintra (Por decidir)'), 'Cascais');
  assert.equal(searchQueryFor('Azóia ou outro pela margem sul'), 'Azóia');
  assert.equal(searchQueryFor('Prison Break & Talismã'), 'Prison Break & Talismã');
});

test('replies: a number, "ok" for a confident or only place, a typed name, the same search, or a new one', () => {
  const two = { searchQuery: 'Sintra', status: 'ambiguous', candidates: [SINTRA, SINTRA_BR] };
  assert.deepEqual(replyMeaning({ ...two, reply: '2' }), { status: 'selected', index: 1 });
  assert.deepEqual(replyMeaning({ ...two, reply: '3' }), { status: 'invalid' });
  assert.deepEqual(replyMeaning({ ...two, reply: 'ok' }), { status: 'search', query: 'ok' });
  assert.deepEqual(replyMeaning({ ...two, status: 'resolved', reply: 'Sim' }), { status: 'selected', index: 0 });
  assert.deepEqual(replyMeaning({ ...two, reply: 'sintra' }), { status: 'ask_number' });
  assert.deepEqual(replyMeaning({ ...two, reply: 'Sintra, Minas Gerais, Brasil' }), { status: 'selected', index: 1 });
  assert.deepEqual(replyMeaning({ ...two, reply: '/cancel' }), { status: 'invalid' });
  assert.deepEqual(replyMeaning({ ...two, reply: 'São Pedro de Sintra' }), { status: 'search', query: 'São Pedro de Sintra' });
  assert.equal(typedChoice([{ label: 'Sintra, Lisboa' }, { label: 'Cascais, Lisboa' }], 'sintra'), 0);
  assert.deepEqual(replyMeaning({ searchQuery: 'Sintra', status: 'ambiguous', candidates: [SINTRA], reply: 'ok' }), { status: 'selected', index: 0 });
});

test('the usual area ignores one trip abroad, and short labels tell same-named places apart', () => {
  const bounds = usualAreaBounds([{ latitude: 38.8, longitude: -9.4 }, { latitude: 38.4, longitude: -9.1 },
    { latitude: 38.7, longitude: -9.0 }, { latitude: 40.4, longitude: -1.4 }]);
  assert.ok(bounds.west < -9.3 && bounds.east < -8.5 && bounds.south < 38.4 && bounds.north > 38.8);
  assert.equal(usualAreaBounds([{ latitude: 38.8, longitude: -9.4 }]), undefined);
  assert.equal(shortLabel(LAGOS_PT), 'Lagos, Faro, Portugal');
  assert.equal(shortLabel(LAGOS_NG), 'Lagos, Lagos State, Nigeria');
});

test('a name shared by places far apart is ambiguous until the community area or memory settles it', async () => {
  const fresh = harness([LAGOS_NG, LAGOS_PT]);
  const ambiguous = await fresh.resolve('Lagos');
  assert.equal(resolveOutputSchema.safeParse(ambiguous).success, true);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates[0].place.label, 'Lagos, Lagos State, Nigeria');
  assert.equal(ambiguous.presentation.alternatives, 'Também encontrei: Lagos, Faro, Portugal. Indica a região ou o país para escolher outro.');
  assert.deepEqual(ambiguous.presentation.optionLines, ['1. Lagos, Lagos State, Nigeria', '2. Lagos, Faro, Portugal']);

  // The community usually meets around Lisbon: its area picks the Portuguese Lagos and biases the provider.
  const local = harness([LAGOS_NG, LAGOS_PT]);
  await local.remember([{ query: 'Sintra', place: SINTRA }, { query: 'Cascais', place: CASCAIS }, { query: 'Sesimbra', place: SESIMBRA }], 'import');
  local.providerQueries.length = 0;
  const lagos = await local.resolve('Lagos');
  assert.equal(lagos.status, 'ambiguous');
  assert.ok(local.providerQueries[0].searchParams.get('viewbox'));
  assert.equal(local.providerQueries[0].searchParams.get('bounded'), null);

  const wide = harness([LAGOS_NG, LAGOS_PT, place('Lagoa, Faro, Portugal', 37.13, -8.45, { country: 'Portugal' }, { name: 'Lagoa', providerRef: 'node:9' })]);
  await wide.remember([{ query: 'Sagres', place: place('Sagres', 37.0, -8.94, { country: 'Portugal' }, { name: 'Sagres', providerRef: 'node:10' }) },
    { query: 'Portimão', place: place('Portimão', 37.14, -8.54, { country: 'Portugal' }, { name: 'Portimão', providerRef: 'node:11' }) }], 'import');
  const algarve = await wide.resolve('Lagos');
  assert.equal(algarve.status, 'resolved');
  assert.equal(algarve.candidates[0].place.label, 'Lagos, Faro, Portugal');
});

test('a confirmed choice is remembered for those words, ranks first, and later lookups need no question', async () => {
  const h = harness([SINTRA_BR, SINTRA]);
  const first = await h.resolve('Sintra');
  assert.equal(first.status, 'ambiguous');
  const chosen = await h.choose({ searchQuery: first.searchQuery, status: first.status, candidates: first.candidates.map(c => c.place), reply: '2' });
  assert.equal(chooseOutputSchema.safeParse(chosen).success, true);
  assert.equal(chosen.place.label, 'Sintra, Lisboa, Portugal');
  assert.deepEqual(await h.remember([{ query: 'Sintra (maybe?)', place: chosen.place }]), { places: 1, changed: true });
  const again = await h.resolve('sintra');
  assert.equal(again.status, 'resolved');
  assert.equal(again.remembered, true);
  assert.equal(again.candidates[0].place.label, 'Sintra, Lisboa, Portugal');
  assert.equal(again.candidates[0].remembered, true);
  assert.equal(again.presentation.optionLines[0], '1. Sintra, Lisboa, Portugal (já usado)');
  assert.equal(again.presentation.optionLabels[0], 'Sintra, Lisboa, Portugal (já usado)');
  assert.equal(again.candidates.length, 2);
  // Memory-only answers skip the provider.
  const before = h.providerQueries.length;
  const memoryOnly = await h.resolve('Sintra', { memoryOnly: true });
  assert.equal(h.providerQueries.length, before);
  assert.equal(memoryOnly.status, 'resolved');
  assert.equal(memoryOnly.candidates.length, 1);
  assert.equal((await h.resolve('Porto', { memoryOnly: true })).status, 'not_found');
});

test('the same search again asks for the number, listing the places as before', async () => {
  const h = harness([SINTRA, SINTRA_BR]);
  const listed = await h.resolve('Sintra');
  const reply = await h.choose({ searchQuery: 'Sintra', status: listed.status, candidates: listed.candidates.map(c => c.place), reply: 'Sintra' });
  assert.equal(reply.status, 'ask_number');
  assert.equal(reply.text, [
    'Estes são os resultados dessa pesquisa. Responde com o número do correto (1 a 2), ou escreve uma pesquisa mais específica.',
    '1. Sintra, Lisboa, Portugal', '2. Sintra, Minas Gerais, Brasil'
  ].join('\n'));
});

test('imports only add what is missing, so repeating them writes nothing', async () => {
  const h = harness([]);
  const items = [{ query: 'Sintra', place: SINTRA, usedAt: '2026-10-01T10:00:00.000Z' }, { query: 'Cascais', place: CASCAIS, usedAt: '2026-10-02T10:00:00.000Z' }];
  assert.deepEqual(await h.remember(items, 'import'), { places: 2, changed: true });
  assert.deepEqual(await h.remember(items, 'import'), { places: 2, changed: false });
  assert.equal(h.writes.length, 1);
  // Without a host data store the memory is simply empty.
  const none = harness([SINTRA], { noDataStore: true });
  assert.deepEqual(await none.remember(items, 'import'), { places: 0, changed: false });
  assert.equal((await none.resolve('Sintra')).status, 'resolved');
});

test('words confirmed for a new place stop pointing at the old one', () => {
  const memory = { version: 1, places: [] };
  const gymA = place('Ginásio A, Lisboa', 38.75, -9.15, {}, { name: 'Ginásio A', providerRef: 'node:20' });
  const gymB = place('Ginásio B, Lisboa', 38.70, -9.20, {}, { name: 'Ginásio B', providerRef: 'node:21' });
  const first = mergePlaceMemory(memory, { places: [{ query: 'ginásio', place: gymA }], source: 'confirmed' }).memory;
  const second = mergePlaceMemory(first, { places: [{ query: 'Ginásio', place: gymB }], source: 'confirmed' }).memory;
  const a = second.places.find(entry => entry.place.providerRef === 'node:20');
  const b = second.places.find(entry => entry.place.providerRef === 'node:21');
  assert.ok(!a.aliases.includes('ginasio'));
  assert.ok(b.aliases.includes('ginasio'));
  assert.ok(a.aliases.includes('ginasio a'));
});
