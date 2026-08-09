import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.eddenbg.secondbrain',
  appName: 'Second Brain',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    Filesystem: {
      directory: 'Documents'
    }
  }
};

export default config;
