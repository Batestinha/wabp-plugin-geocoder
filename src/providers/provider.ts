import type {
  GeocodeInput,
  GeocoderAttribution,
  GeocoderPlace,
  ReverseGeocodeInput
} from '../serviceApi';

export interface GeocoderProvider {
  readonly providerId: string;
  readonly attribution: GeocoderAttribution;
  geocode(input: GeocodeInput, signal?: AbortSignal | undefined): Promise<GeocoderPlace[]>;
  reverseGeocode(input: ReverseGeocodeInput, signal?: AbortSignal | undefined): Promise<GeocoderPlace | null>;
}
