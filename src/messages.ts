import type { MessageCatalog } from '@wabs/plugin-sdk/i18n';

export const geocoderMessages: MessageCatalog = {
  'official.geocoder.description': 'Resolves place names and addresses to coordinates and looks up places and time zones from coordinates. Other plugins can use its map links and reuse places previously confirmed in the same scope.',
  'official.geocoder.help.feature.title': 'Location lookup',
  'official.geocoder.help.feature.summary': 'Helps other plugins identify a place, resolve ambiguous names and provide map links and time zones.',
  'official.geocoder.help.lookup.title': 'Geocoding service',
  'official.geocoder.help.lookup.summary': 'Decide which place people mean for events, weather, and other scoped plugins, and remember the places each community uses.',
  'official.geocoder.help.lookup.instruction': 'This is a supporting service with no direct chat command; use the event or weather help topics that consume it.',
  'official.geocoder.option.line': '{number}. {label}',
  'official.geocoder.option.remembered': '{label} (used before)',
  'official.geocoder.alternatives': 'Also found: {places}. Add the region or country to pick another.',
  'official.geocoder.chooseNumber': 'These are the results for that search. Reply with the number of the right one (1 to {count}), or type a more specific search.'
};
