import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tn.taxicheck.app',
  appName: 'Taxi Check TN',
  webDir: 'dist',
  android: {
    // Required by the background location plugin to deliver fixes after 5 minutes.
    useLegacyBridge: true,
    allowMixedContent: false,
  },
};

export default config;
