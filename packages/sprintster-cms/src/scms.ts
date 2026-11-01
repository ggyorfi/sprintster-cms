#!/usr/bin/env node
import { reset, build, serve, dev } from './index.js';

function usage(): void {
  console.log('scms <command>');
  console.log('  dev     start the s8r daemon and serve the site on one origin');
  console.log('  serve   run the site, admin and API against an already running daemon');
  console.log('  build   generate the static site into outDir (default dist), against a running daemon');
  console.log('  reset   wipe local data and blobs for the given environment (default: dev)');
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const envIndex = rest.indexOf('--env');
  const env = envIndex >= 0 ? rest[envIndex + 1] ?? 'dev' : 'dev';
  const portIndex = rest.indexOf('--port');
  const port = portIndex >= 0 ? Number(rest[portIndex + 1]) : undefined;

  switch (command) {
    case 'reset':
      reset(env);
      return;
    case 'dev':
      await dev({ env, ...(port === undefined || Number.isNaN(port) ? {} : { port }) });
      return;
    case 'serve':
      await serve({ env, ...(port === undefined || Number.isNaN(port) ? {} : { port }) });
      return;
    case 'build': {
      const started = Date.now();
      const report = await build({ env });
      console.log(
        `scms build: ${report.pages} pages, ${report.renditions} renditions, ${report.originals} originals -> ${report.outDir} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
      return;
    }
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

await main();
