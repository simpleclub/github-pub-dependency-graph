// Stands in for `dart`/`flutter` in tests: `pub get` succeeds, `pub deps --json` prints the fixture.
const fs = require('node:fs');
const path = require('node:path');
const [sdk, ...rest] = process.argv.slice(2);
const args = rest.join(' ');
if (process.env.FAKE_SDK_LOG) fs.appendFileSync(process.env.FAKE_SDK_LOG, `${sdk} ${args}\n`);
if (args === 'pub get --enforce-lockfile') process.exit(0);
if (args === 'pub deps --json') {
  process.stdout.write('Resolving dependencies...\n');
  process.stdout.write(fs.readFileSync(path.join(__dirname, '..', 'pub-deps.json'), 'utf8'));
  process.exit(0);
}
process.exit(64);
