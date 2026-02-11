import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, cpSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

// Ensure dist directory exists
const distDir = join(__dirname, 'dist');
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// Common build options
const commonOptions = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch,
  target: ['chrome120'],
  logLevel: 'info',
};

// Entry points for the extension
const entryPoints = [
  { in: 'src/background/index.ts', out: 'background', format: 'esm' },
  { in: 'src/content/index.ts', out: 'content', format: 'iife' },  // Content scripts must be IIFE, not ESM
  { in: 'src/popup/index.ts', out: 'popup', format: 'iife' },
];

// Copy public files to dist
function copyPublicFiles() {
  const publicDir = join(__dirname, 'public');
  if (existsSync(publicDir)) {
    cpSync(publicDir, distDir, { recursive: true });
    console.log('Copied public files to dist/');
  }
}

async function build() {
  try {
    // Copy public files first
    copyPublicFiles();

    // Build all entry points
    const contexts = await Promise.all(
      entryPoints.map((entry) =>
        esbuild.context({
          ...commonOptions,
          format: entry.format,
          entryPoints: [entry.in],
          outfile: join(distDir, `${entry.out}.js`),
        })
      )
    );

    if (isWatch) {
      console.log('Watching for changes...');
      await Promise.all(contexts.map((ctx) => ctx.watch()));
    } else {
      await Promise.all(contexts.map((ctx) => ctx.rebuild()));
      await Promise.all(contexts.map((ctx) => ctx.dispose()));
      console.log('Build complete!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
