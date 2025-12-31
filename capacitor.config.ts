import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.neopatriarch.agoramarketplace',
  appName: 'Agora Marketplace',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    // This allows the app to connect to your local dev server
    // and to Nostr relays (which are often on wss://).
    allowNavigation: ['*']
  }
};

export default config;
