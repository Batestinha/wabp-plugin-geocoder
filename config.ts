import { z } from 'zod';

export const GEOCODER_PROVIDERS = ['nominatim'] as const;

const countryCodeSchema = z.string().regex(/^[A-Za-z]{2}$/);

export const geocoderCacheConfigSchema = z.object({
  successTtlSeconds: z.number().int().min(60).max(604_800).default(86_400),
  reverseTtlSeconds: z.number().int().min(60).max(2_592_000).default(604_800),
  notFoundTtlSeconds: z.number().int().min(30).max(86_400).default(300)
}).default({});

export const geocoderRateLimitConfigSchema = z.object({
  minimumIntervalMs: z.number().int().min(0).max(60_000).default(1_100)
}).default({});

export const nominatimSettingsSchema = z.object({
  baseUrl: z.string().url().default('https://nominatim.openstreetmap.org'),
  userAgent: z.string().trim().min(3).max(512).default('WhatsAppBotPlatform/0.1'),
  contactEmail: z.union([z.literal(''), z.string().trim().email().max(320)]).default('')
}).default({});

export const geocoderConfigSchema = z.object({
  provider: z.enum(GEOCODER_PROVIDERS).default('nominatim'),
  defaultLanguage: z.string().trim().min(2).max(35).default('en'),
  defaultCountryCodes: z.array(countryCodeSchema).max(10).default([]),
  cache: geocoderCacheConfigSchema,
  rateLimit: geocoderRateLimitConfigSchema,
  providerSettings: z.object({
    nominatim: nominatimSettingsSchema
  }).default({})
}).default({});

export type GeocoderConfig = z.infer<typeof geocoderConfigSchema>;
export type NominatimSettings = z.infer<typeof nominatimSettingsSchema>;

export function parseGeocoderConfig(input: unknown): GeocoderConfig {
  return geocoderConfigSchema.parse(input);
}
