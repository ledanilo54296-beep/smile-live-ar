import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  publicDir: false,
  worker: { format: 'es' },
  plugins: [{
    name: 'vision-license',
    async generateBundle() {
      const { readFile } = await import('node:fs/promises');
      this.emitFile({ type: 'asset', fileName: 'LICENSE.face-api.txt', source: await readFile('node_modules/@vladmandic/face-api/LICENSE', 'utf8') });
    },
  }],
});
