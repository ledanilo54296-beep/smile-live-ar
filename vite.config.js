import { defineConfig } from "vite";

const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  publicDir: false,
  worker: { format: 'es' },
  plugins: [{
    name: 'vision-license',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        if (!bundle) return [];
        return Object.values(bundle)
          .filter(({ fileName }) => fileName.endsWith('.bin') || /face-api\.esm-.*\.js$/.test(fileName))
          .map(({ fileName }) => ({
            tag: 'link',
            attrs: { rel: 'preload', as: fileName.endsWith('.bin') ? 'fetch' : 'script', crossorigin: 'anonymous', href: base + fileName },
            injectTo: 'head',
          }));
      },
    },
    async generateBundle() {
      const { readFile } = await import('node:fs/promises');
      this.emitFile({ type: 'asset', fileName: 'LICENSE.face-api.txt', source: await readFile('node_modules/@vladmandic/face-api/LICENSE', 'utf8') });
    },
  }],
});
