import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'hybrid',
  adapter: cloudflare(),
  image: {
    service: {
      entrypoint: 'astro/assets/services/passthrough'
    }
  },
  vite: {
    ssr: {
      external: ['sharp']
    },
    build: {
      rollupOptions: {
        external: ['sharp']
      }
    }
  }
});
