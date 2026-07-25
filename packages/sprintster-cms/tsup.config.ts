import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { scms: 'src/scms.ts', index: 'src/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  noExternal: [/^@sprintster-cms\//],
});
