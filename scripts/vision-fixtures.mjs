import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Upstream test images stay in ignored artifacts, never in the published site.
export const fixtureDirectory = process.env.VISION_FIXTURES || path.resolve('artifacts/vision-fixtures');
const base = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/a86f011d72124e5fb93e59d5c4ab98f699dd5c9c/examples/images/';
const files = { neutral: 'neutral.jpg', smile: 'bernadette/bernadette1.png', closedSmile: 'sheldon/sheldon1.png', laugh: 'happy.jpg' };

export async function loadFixtures() {
  await mkdir(fixtureDirectory, { recursive: true });
  const result = {};
  for (const [name, relative] of Object.entries(files)) {
    const file = path.join(fixtureDirectory, path.basename(relative));
    let buffer;
    try { buffer = await readFile(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const response = await fetch(base + relative, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Fixture download failed: ${response.status} ${relative}`);
      buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(file, buffer);
    }
    result[name] = `data:image/${relative.endsWith('.png') ? 'png' : 'jpeg'};base64,${buffer.toString('base64')}`;
  }
  return result;
}
