import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'validacao', test: /node_modules[\\/]zod[\\/]/ },
            { name: 'contratos', test: /packages[\\/]contratos[\\/]dist[\\/]/ },
          ],
        },
      },
    },
  },
});
