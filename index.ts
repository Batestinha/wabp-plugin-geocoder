import type { ServicePlugin } from '../../../../packages/plugin-sdk/src/service-plugin';
import { geocoderManifest } from './manifest';
import { registerGeocoderServices } from './service';

export const geocoderPlugin: ServicePlugin = {
  manifest: geocoderManifest,
  registerServices(context) {
    return registerGeocoderServices(context);
  }
};

export default geocoderPlugin;
