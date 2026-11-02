import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = join(root, 'examples');
const target = join(examples, 'reference-site');
const sprintsterRepo = resolve(process.env['SPRINTSTER_REPO'] ?? join(root, '..', 'core'));

function run(command: string, args: string[], cwd: string): void {
  console.log(`\n> ${command} ${args.join(' ')}  (${cwd})`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

if (!existsSync(join(sprintsterRepo, 'packages', 'sprintster'))) {
  throw new Error(`no sprintster checkout at ${sprintsterRepo}; set SPRINTSTER_REPO`);
}

// `link:` resolves built output, so a stale sibling bundle silently runs old core code in the reference project.
run('pnpm', ['--filter', '@sprintster/web', 'build'], sprintsterRepo);
run('pnpm', ['--filter', 'sprintster', 'build'], sprintsterRepo);
run('pnpm', ['--filter', 'create-sprintster-cms', 'build'], root);
run('pnpm', ['--filter', 'sprintster-cms', 'build'], root);

rmSync(target, { recursive: true, force: true });
mkdirSync(examples, { recursive: true });

run(
  'node',
  [
    join(root, 'packages', 'create-sprintster-cms', 'dist', 'index.js'),
    'reference-site',
    '--backend',
    'sqlite',
    '--local',
    sprintsterRepo,
  ],
  examples,
);

run('pnpm', ['install'], target);

console.log(`\nreference site ready at ${target}`);
console.log('  cd examples/reference-site && pnpm dev');
