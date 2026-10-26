#!/usr/bin/env node
// Lists which production media are present in public/media/ and which are still placeholders.
// Usage: npm run media:check            (exit code 0)
//        npm run media:check -- --strict (exit code 1 while anything is missing, e.g. for CI before launch)

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanMedia, describeMissing } from './media-inventory.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = scanMedia(root, join(root, 'public'));
const { lines, missingCount } = describeMissing(result);

console.log('\nOmas Apfelkuchen – media status (public/media/)\n');
for (const line of lines) console.log('  ' + line);

const refs = Object.entries(result.inventory.reference).filter(([, present]) => present).map(([id]) => id);
if (refs.length) {
  console.log(`\n  note     reference photos in use as placeholders: ${refs.join(', ')}`);
  console.log('           Replace them with real footage before launch. See ASSETS.md.');
}

console.log(missingCount === 0 ? '\nAll production media present.\n' : `\n${missingCount} item(s) still missing. Specs: ASSETS.md\n`);

if (process.argv.includes('--strict') && missingCount > 0) process.exit(1);
