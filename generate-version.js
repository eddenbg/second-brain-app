#!/usr/bin/env node

/**
 * Generate version.json for live update checks
 * This file is generated at build time and placed in the dist/ folder
 * The update service checks this file to determine if a new version is available
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));

const versionInfo = {
  version: packageJson.version,
  buildTime: Date.now(),
  buildDate: new Date().toISOString(),
};

const distDir = path.join(__dirname, 'dist');

// Create dist directory if it doesn't exist
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Write version.json
const versionPath = path.join(distDir, 'version.json');
fs.writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2));

console.log(`✓ Generated version.json:`, versionInfo);
console.log(`  Location: ${versionPath}`);
