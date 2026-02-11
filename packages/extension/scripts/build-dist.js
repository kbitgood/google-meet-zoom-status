#!/usr/bin/env node
/**
 * Production build script for Chrome Web Store distribution
 * Creates a minified bundle and generates a ZIP file ready for upload
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const releaseDir = join(rootDir, 'release');

// Production build options - fully minified, no source maps
const buildOptions = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['chrome120'],
  format: 'esm',
  logLevel: 'info',
  drop: ['console', 'debugger'], // Remove console.log and debugger statements
  treeShaking: true,
  legalComments: 'none', // Remove license comments for smaller bundle
};

// Entry points for the extension
const entryPoints = [
  { in: 'src/background/index.ts', out: 'background' },
  { in: 'src/content/index.ts', out: 'content' },
  { in: 'src/popup/index.ts', out: 'popup' },
];

/**
 * Clean dist and release directories
 */
function cleanDirs() {
  console.log('Cleaning build directories...');
  
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true });
  }
  mkdirSync(distDir, { recursive: true });

  if (!existsSync(releaseDir)) {
    mkdirSync(releaseDir, { recursive: true });
  }
}

/**
 * Copy public files to dist
 */
function copyPublicFiles() {
  const publicDir = join(rootDir, 'public');
  if (existsSync(publicDir)) {
    cpSync(publicDir, distDir, { recursive: true });
    console.log('Copied public files to dist/');
  }
}

/**
 * Get version from manifest.json
 */
function getVersion() {
  const manifestPath = join(rootDir, 'public', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return manifest.version;
}

/**
 * Create ZIP file for Chrome Web Store
 */
function createZip(version) {
  const zipName = `google-meet-zoom-status-v${version}.zip`;
  const zipPath = join(releaseDir, zipName);

  // Remove existing ZIP if present
  if (existsSync(zipPath)) {
    rmSync(zipPath);
  }

  console.log(`Creating ${zipName}...`);

  // Use native zip command (available on macOS/Linux)
  try {
    execSync(`cd "${distDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
    console.log(`Created: release/${zipName}`);
    return zipPath;
  } catch (error) {
    console.error('Failed to create ZIP file. Make sure "zip" is installed.');
    console.error('On macOS/Linux, run: brew install zip (or apt install zip)');
    process.exit(1);
  }
}

/**
 * Calculate ZIP file size
 */
function getFileSize(filePath) {
  const stats = readFileSync(filePath);
  const sizeKB = (stats.length / 1024).toFixed(2);
  return `${sizeKB} KB`;
}

/**
 * Verify the build output
 */
function verifyBuild() {
  console.log('\nVerifying build output...');
  const requiredFiles = [
    'manifest.json',
    'background.js',
    'content.js',
    'popup.js',
    'popup.html',
    'popup.css',
    'icons/icon-16.png',
    'icons/icon-48.png',
    'icons/icon-128.png',
  ];

  const missing = requiredFiles.filter(file => !existsSync(join(distDir, file)));
  
  if (missing.length > 0) {
    console.error('Missing required files:', missing);
    process.exit(1);
  }

  console.log('All required files present.');
}

/**
 * Main build function
 */
async function build() {
  const startTime = Date.now();
  
  console.log('='.repeat(50));
  console.log('Google Meet to Zoom Status - Production Build');
  console.log('='.repeat(50));
  console.log('');

  try {
    // Step 1: Clean directories
    cleanDirs();

    // Step 2: Copy public files
    copyPublicFiles();

    // Step 3: Build all entry points
    console.log('\nBuilding TypeScript...');
    await Promise.all(
      entryPoints.map((entry) =>
        esbuild.build({
          ...buildOptions,
          entryPoints: [join(rootDir, entry.in)],
          outfile: join(distDir, `${entry.out}.js`),
        })
      )
    );

    // Step 4: Verify build
    verifyBuild();

    // Step 5: Create ZIP
    const version = getVersion();
    const zipPath = createZip(version);

    // Step 6: Summary
    const buildTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(50));
    console.log('BUILD SUCCESSFUL');
    console.log('='.repeat(50));
    console.log(`Version: ${version}`);
    console.log(`Build time: ${buildTime}s`);
    console.log(`Output: dist/`);
    console.log(`ZIP: release/google-meet-zoom-status-v${version}.zip`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Test the extension: Load dist/ as unpacked extension');
    console.log('2. Upload to Chrome Web Store: Use the ZIP file in release/');
    console.log('');

  } catch (error) {
    console.error('\nBuild failed:', error);
    process.exit(1);
  }
}

build();
