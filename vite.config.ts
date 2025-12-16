import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, readdirSync, lstatSync } from 'fs';
import { resolve, extname } from 'path';

// Plugin to copy static files (manifest, service worker, and all images) to dist
const copyStaticFiles = () => ({
  name: 'copy-static-files',
  writeBundle() {
    const rootDir = process.cwd();
    const files = readdirSync(rootDir);

    // Always copy these specific files
    const essentialFiles = ['manifest.json', 'sw.js'];
    
    // Also copy any image files found in the root
    const assetExtensions = ['.png', '.ico', '.svg', '.jpg', '.jpeg'];

    files.forEach(file => {
      const filePath = resolve(rootDir, file);
      if (
        essentialFiles.includes(file) || 
        (lstatSync(filePath).isFile() && assetExtensions.includes(extname(file).toLowerCase()))
      ) {
        try {
          copyFileSync(filePath, resolve('dist', file));
          console.log(`Copied ${file} to dist/`);
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
    // Inject API key safely (fallback to empty string if undefined during build)
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY || '')
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
});