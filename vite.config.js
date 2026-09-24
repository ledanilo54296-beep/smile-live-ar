import { defineConfig } from "vite";
import { fileURLToPath } from 'node:url';

const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  publicDir: false,
  resolve: {
    alias: { '@tensorflow/tfjs/dist/index.js': fileURLToPath(new URL('./src/vision-tf.js', import.meta.url)) },
  },
  worker: { format: 'es' },
  plugins: [{
    name: 'vision-license',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        if (!bundle) return [];
        return Object.values(bundle)
          .filter(({ fileName }) => fileName.endsWith('.bin') || /face-api\.esm.*\.js$|segmentation-.*\.js$|tfjs-backend-wasm-simd-.*\.wasm$/.test(fileName))
          .map(({ fileName }) => ({
            tag: 'link',
            attrs: { rel: fileName.endsWith('.js') ? 'modulepreload' : 'preload', ...(fileName.endsWith('.js') ? {} : { as: 'fetch' }), crossorigin: 'anonymous', href: base + fileName },
            injectTo: 'head',
          }));
      },
    },
    async generateBundle() {
      const { readFile } = await import('node:fs/promises');
      this.emitFile({ type: 'asset', fileName: 'LICENSE.face-api.txt', source: await readFile('node_modules/@vladmandic/face-api/LICENSE', 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'LICENSE.body-pix.txt', source: await readFile('src/models/LICENSE.bodypix.txt', 'utf8') });
    },
  }],
});
