import type { BotPlugin } from '../../../platform/pluginRuntime/types';
import { geocoderManifest } from './manifest';
import { registerGeocoderServices } from './service';

export const geocoderPlugin: BotPlugin = {
  manifest: geocoderManifest,
  registerServices(context) {
    return registerGeocoderServices(context);
  }
};

export default geocoderPlugin;
