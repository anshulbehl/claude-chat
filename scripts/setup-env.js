#!/usr/bin/env node
import { existsSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const envPath = join(rootDir, '.env');
const envLocalPath = join(rootDir, '.env.local');
const envExamplePath = join(rootDir, '.env.example');

// Check if user has personal config
if (existsSync(envLocalPath)) {
  console.log('✅ .env.local file exists (personal configuration)');
} else if (existsSync(envPath)) {
  console.log('✅ .env file already exists');
} else {
  // Only create .env if neither .env.local nor .env exists
  if (existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    console.log('✅ Created .env file from .env.example');
    console.log('⚠️  Please update GOOGLE_CLOUD_PROJECT in .env with your project ID');
  } else {
    console.warn('⚠️  .env.example not found. Please create .env manually.');
  }
}
