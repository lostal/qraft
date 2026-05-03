import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  // TODO: cambiar antes del deploy a producción
  site: 'https://TODO-set-domain.example',
  integrations: [react(), tailwind()],
  output: 'static',
  vite: {
    optimizeDeps: {
      include: ['colorthief'],
    },
  },
});
