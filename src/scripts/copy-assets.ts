import { cpSync } from 'node:fs';
import { join } from 'node:path';

// tsc only emits JavaScript, so the served page has to be copied across by hand.
cpSync(join('src', 'server', 'public'), join('dist', 'server', 'public'), { recursive: true });
// stderr, not stdout: this runs inside `npm pack`, whose stdout is the tarball name.
console.error('[build] copied src/server/public -> dist/server/public');
