#!/usr/bin/env node
import { reset, build } from './index.js';

function usage(): void {
  console.log('scms <command>');
  console.log('  build   generate the static site (coming soon)');
  console.log('  reset   wipe local data and blobs for the given environment (default: dev)');
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const envIndex = rest.indexOf('--env');
  const env = envIndex >= 0 ? rest[envIndex + 1] ?? 'dev' : 'dev';

  switch (command) {
    case 'reset':
      reset(env);
      return;
    case 'build':
      build();
      return;
    case undefined:
    case 'help':
    case '--help':
      usage();
      return;
    default:
      console.error(`Unknown command '${command}'.`);
      usage();
      process.exit(1);
  }
}

main();
