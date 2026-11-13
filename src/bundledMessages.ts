import fs from 'node:fs';
import path from 'node:path';
import type { MessageCatalog, MessageParams, TranslateFn } from '@wabs/plugin-sdk/i18n';
import { geocoderMessages } from './messages';

const catalogs = new Map<string, MessageCatalog | undefined>();

/** Translator over the catalogs shipped in this package, for hosts that do not pass their i18n service. */
export function bundledTranslator(locale: string): TranslateFn {
  const chain = [locale, locale.split('-')[0]!].map(loadCatalog).filter((catalog): catalog is MessageCatalog => Boolean(catalog));
  return (key, params) => interpolate(chain.find((catalog) => catalog[key] !== undefined)?.[key] ?? geocoderMessages[key] ?? key, params);
}

function loadCatalog(locale: string): MessageCatalog | undefined {
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || locale.toLowerCase() === 'en') return undefined;
  if (!catalogs.has(locale)) {
    try {
      const file = path.join(__dirname, '..', 'locales', locale, 'official.geocoder.json');
      catalogs.set(locale, JSON.parse(fs.readFileSync(file, 'utf8')) as MessageCatalog);
    } catch {
      catalogs.set(locale, undefined);
    }
  }
  return catalogs.get(locale);
}

function interpolate(template: string, params?: MessageParams | undefined): string {
  return params
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = params[name];
        return value === undefined || value === null ? match : String(value);
      })
    : template;
}
