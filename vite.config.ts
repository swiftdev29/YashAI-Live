import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Plugin to copy static files that are in the root directory to the dist folder
const copyStaticFiles = () => ({
  name: 'copy-static-files',
  writeBundle() {
    const files = ['manifest.json', 'sw.js', 'icon.png'];
    files.forEach(file => {
      if (existsSync(file)) {
        try {
          copyFileSync(file, resolve('dist', file));
        } catch (e) {
          console.warn(`Failed to copy ${file}:`, e);
        }
      }
    });
  }
});

export default defineConfig({
  plugins: [
    react(),
    copyStaticFiles()
  ],
  define: {
    // This allows process.env.API_KEY to work in the browser code
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  },
  build: {
    target: 'esnext', // Support top-level await and modern features
    outDir: 'dist'
  }
});