#!/usr/bin/env node
// bumpgate: Dependabot says CI is green. Kane CLI checks the app still works.
import { main } from '../src/cli.mjs';

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(`\nbumpgate: ${err?.message || err}\n`);
    if (process.env.BUMPGATE_DEBUG && err?.stack) process.stderr.write(err.stack + '\n');
    process.exit(2);
  },
);
