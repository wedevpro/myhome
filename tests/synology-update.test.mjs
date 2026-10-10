import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const workspace = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scriptPath = path.join(workspace, 'METTRE-A-JOUR-SYNOLOGY.sh');
const workRoot = path.join(workspace, 'tests', '.synology-update-work');
const windows = process.platform === 'win32';
const shellPath = windows ? 'C:/Program Files/Git/usr/bin/sh.exe' : '/bin/sh';
const toShellPath = filename => windows
  ? filename.replaceAll('\\', '/').replace(/^([A-Za-z]):\//, (_, drive) => '/' + drive.toLowerCase() + '/')
  : filename;
const secret = 'fixture-secret-NEVER-PRINT-731b9';
const environmentContents = 'SITE_ORIGIN=https://maison.example.test\nAUTH_COOKIE_SECURE=true\nSESSION_SECRET=' + secret + '\n';
const databaseContents = Buffer.from('SQLite fixture\0' + secret + '\0\xff\x01', 'latin1');
const project = 'cuisine-family';

// Store-only ZIPs have genuine CRCs and central directories, without a package
// dependency or an installed ZIP creator. Extraction is always the real unzip.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const [entryName, contents] of entries) {
    const name = Buffer.from(entryName), data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    const checksum = crc32(data), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE((46 << 9) | (10 << 5) | 10, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE((46 << 9) | (10 << 5) | 10, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, data);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(centralParts), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

const validEntries = [
  ['Dockerfile', 'FROM scratch\n'],
  ['docker-compose.yml', 'services:\n  myhomeia:\n    image: fixture:latest\n'],
  ['.dockerignore', 'data\n.env\n'],
  ['.env.example', 'SITE_ORIGIN=https://myhomeia.example.test\n'],
  ['GUIDE-SYNOLOGY.md', 'Updated fixture guide\n'],
  ['app/.env.example', 'DB_PATH=../data/myhomeia.sqlite\n'],
  ['app/package.json', '{"name":"updated-fixture","version":"2.0.0"}\n'],
  ['app/package-lock.json', '{"name":"updated-fixture","lockfileVersion":3}\n'],
  ['app/next.config.ts', 'export default { output: "standalone" };\n'],
  ['app/app/page.tsx', 'export default function Page() { return "updated"; }\n'],
  ['app/app/layout.tsx', 'export default function Layout({children}) { return children; }\n'],
  ['app/lib/model.ts', 'export const fixture = "updated";\n'],
  ['app/drizzle/0001_fixture.sql', '-- fixture migration\n'],
  ['app/scripts/build-nas.mjs', '// fixture build\n'],
  ['app/scripts/nas-entrypoint.mjs', '// fixture entrypoint\n'],
  ['app/scripts/reminder-worker.ts', '// fixture reminders\n'],
  ['app/public/fixture.txt', 'updated asset\n'],
];

function executable(filename, contents) {
  fs.writeFileSync(filename, '#!/bin/sh\nset -eu\n' + contents, { mode: 0o755 });
  fs.chmodSync(filename, 0o755);
}
const logArguments = name => `printf '%s' '${name}' >> "$TEST_EVENTS"
for argument do printf '\\t%s' "$argument" >> "$TEST_EVENTS"; done
printf '\\n' >> "$TEST_EVENTS"
`;
const composeMock = `
case " $* " in
  *' version '*)
    if [ "\${TEST_COMPOSE_LEGACY:-0}" = 1 ] && [ "$mock_command" = docker ]; then exit 1; fi
    printf 'Docker Compose fixture version 2.0\\n'; exit 0 ;;
  *' config '*) [ "\${TEST_CONFIG_FAIL:-0}" != 1 ] || exit 23; exit 0 ;;
  *' up '*)
    [ "\${TEST_BUILD_FAIL:-0}" != 1 ] || exit 24
    rm -f "$TEST_STOPPED"
    exit 0 ;;
  *' ps '*) printf 'myhomeia fixture running (healthy)\\n'; exit 0 ;;
esac
exit 64
`;

function safeRemove(directory) {
  const resolved = path.resolve(directory), expectedRoot = path.resolve(workRoot);
  assert.ok(resolved.startsWith(expectedRoot + path.sep), 'Cleanup must remain below the test work directory');
  assert.ok(expectedRoot.startsWith(workspace + path.sep), 'Test work directory must remain in the workspace');
  if (fs.existsSync(resolved)) {
    const realRoot = fs.realpathSync(expectedRoot);
    assert.ok(realRoot.startsWith(fs.realpathSync(workspace) + path.sep), 'Resolved test work directory must remain in the workspace');
    assert.ok(fs.realpathSync(resolved).startsWith(realRoot + path.sep), 'Resolved cleanup target must remain in test work');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function fixture() {
  assert.ok(fs.existsSync(shellPath), 'A POSIX shell is required');
  assert.ok(fs.existsSync(scriptPath), 'The update script must exist');
  fs.mkdirSync(workRoot, { recursive: true });
  assert.ok(fs.realpathSync(workRoot).startsWith(fs.realpathSync(workspace) + path.sep), 'Fixtures must remain in the workspace');
  const directory = fs.mkdtempSync(path.join(workRoot, 'case-'));
  const install = path.join(directory, 'installation with spaces');
  const backup = path.join(directory, 'backups');
  const staging = path.join(directory, 'staging');
  const bin = path.join(directory, 'bin');
  const eventsFile = path.join(directory, 'events.tsv');
  const stoppedFile = path.join(directory, 'stopped');
  const archive = path.join(directory, 'myhomeia-synology.zip');
  const otherData = path.join(directory, 'other-data');
  for (const name of [install, backup, staging, bin, otherData, path.join(install, 'data', 'nested'), path.join(install, 'app')]) fs.mkdirSync(name, { recursive: true });
  fs.writeFileSync(path.join(install, '.env'), environmentContents);
  fs.writeFileSync(path.join(install, 'data', 'myhomeia.sqlite'), databaseContents);
  fs.writeFileSync(path.join(install, 'data', '.hidden'), 'hidden file remains\n');
  fs.writeFileSync(path.join(install, 'data', 'nested', 'attachment.bin'), Buffer.from([0, 1, 2, 253, 254, 255]));
  fs.writeFileSync(path.join(install, 'Dockerfile'), 'old Dockerfile\n');
  fs.writeFileSync(path.join(install, 'docker-compose.yml'), 'old compose\n');
  fs.writeFileSync(path.join(install, 'app', 'obsolete-route.ts'), 'old route must be removed\n');
  fs.writeFileSync(eventsFile, '');
  fs.writeFileSync(archive, zip(validEntries));
  executable(path.join(bin, 'id'), 'printf "%s\\n" "\${TEST_UID:-0}"\n');
  executable(path.join(bin, 'docker'), logArguments('docker') + `
if [ "$1" = compose ]; then mock_command=docker; ${composeMock}
fi
if [ "$1" = inspect ]; then
  case "$*" in
    *com.docker.compose.project*) printf '%s\\n' "$TEST_PROJECT" ;;
    *com.docker.compose.service*) printf '%s\\n' "$TEST_SERVICE" ;;
    *.Mounts*) printf '%s\\n' "$TEST_DATA_SOURCE" ;;
    *.State.Running*)
      if [ -f "$TEST_STOPPED" ]; then running=false; else running=true; fi
      printf 'running\\t%s\\n' "$running" >> "$TEST_EVENTS"
      printf '%s\\n' "$running" ;;
    *.State.Health*) printf 'healthy\\n' ;;
    *) exit 65 ;;
  esac
  exit 0
fi
if [ "$1" = stop ]; then
  if [ "\${TEST_STOP_STAYS_RUNNING:-0}" != 1 ]; then : > "$TEST_STOPPED"; fi
  printf 'myhomeia\\n'
  exit 0
fi
if [ "$1" = start ]; then rm -f "$TEST_STOPPED"; printf 'myhomeia\\n'; exit 0; fi
exit 66
`);
  executable(path.join(bin, 'docker-compose'), logArguments('docker-compose') + 'mock_command=docker-compose\n' + composeMock);
  executable(path.join(bin, 'cp'), logArguments('cp') + `
if [ "\${TEST_COPY_FAIL:-0}" = 1 ]; then
  for argument do if [ "$argument" = "$MYHOMEIA_DIR/data" ]; then exit 25; fi; done
fi
exec /usr/bin/cp "$@"
`);
  executable(path.join(bin, 'mv'), logArguments('mv') + 'exec /usr/bin/mv "$@"\n');
  executable(path.join(bin, 'unzip'), logArguments('unzip') + `
target=
previous=
for argument do
  if [ "$previous" = -d ]; then target=$argument; fi
  previous=$argument
done
if [ -n "$target" ]; then printf 'extract\\t%s\\n' "$target" >> "$TEST_EVENTS"; fi
exec /usr/bin/unzip "$@"
`);

  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key];
  Object.assign(environment, {
    PATH: toShellPath(bin) + ':/usr/bin:/bin',
    MYHOMEIA_DIR: toShellPath(install),
    MYHOMEIA_BACKUP_DIR: toShellPath(backup),
    TMPDIR: toShellPath(staging),
    TEST_EVENTS: toShellPath(eventsFile),
    TEST_STOPPED: toShellPath(stoppedFile),
    TEST_PROJECT: project,
    TEST_SERVICE: 'myhomeia',
    TEST_DATA_SOURCE: toShellPath(path.join(install, 'data')),
    LC_ALL: 'C',
  });
  return {
    directory, install, backup, staging, archive, otherData,
    writeZip(entries) { fs.writeFileSync(archive, zip(entries)); },
    run(extraEnvironment = {}) {
      const result = spawnSync(shellPath, [toShellPath(scriptPath), toShellPath(archive)], {
        cwd: directory, env: { ...environment, ...extraEnvironment }, encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
      });
      assert.ifError(result.error);
      const output = result.stdout + result.stderr;
      assert.ok(!output.includes(secret), 'The update must never print .env or database secrets');
      return { ...result, output, events: fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split('\t')) };
    },
  };
}
function withFixture(run) {
  const context = fixture();
  try { return run(context); } finally { safeRemove(context.directory); }
}
function assertOriginalData(directory) {
  assert.equal(fs.readFileSync(path.join(directory, '.env'), 'utf8'), environmentContents);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'data', 'myhomeia.sqlite')), databaseContents);
  assert.equal(fs.readFileSync(path.join(directory, 'data', '.hidden'), 'utf8'), 'hidden file remains\n');
  assert.deepEqual(fs.readFileSync(path.join(directory, 'data', 'nested', 'attachment.bin')), Buffer.from([0, 1, 2, 253, 254, 255]));
  assert.equal(fs.existsSync(path.join(directory, 'data', 'data')), false, 'Restoration must not create data/data');
}
const isCompose = (event, action) => (event[0] === 'docker-compose' || (event[0] === 'docker' && event[1] === 'compose')) && event.includes(action);
const isStop = event => event[0] === 'docker' && event[1] === 'stop';
function assertCleanup(context) {
  assert.equal(fs.existsSync(path.join(context.install, '.myhomeia-update.lock')), false, 'The update lock must be removed');
  assert.deepEqual(fs.readdirSync(context.staging), [], 'Temporary extracted sources must be removed');
}
function backups(context) { return fs.readdirSync(context.backup).map(name => path.join(context.backup, name)); }
function assertRejectedBeforeStop(context, result) {
  assert.notEqual(result.status, 0, result.output);
  assert.equal(result.events.some(isStop), false, 'Rejected input must not stop the service');
  assert.equal(result.events.some(event => event[0] === 'cp'), false, 'Rejected input must not copy live SQLite');
  assert.equal(fs.readFileSync(path.join(context.install, 'Dockerfile'), 'utf8'), 'old Dockerfile\n');
  assert.equal(fs.readFileSync(path.join(context.install, 'app', 'obsolete-route.ts'), 'utf8'), 'old route must be removed\n');
  assertOriginalData(context.install);
  assertCleanup(context);
}

test('Mise à jour Synology : extraction réelle, données conservées et ordre des opérations', () => withFixture(context => {
  const result = context.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(fs.readFileSync(path.join(context.install, 'app', 'public', 'fixture.txt'), 'utf8'), 'updated asset\n');
  assertOriginalData(context.install);
  const saved = backups(context);
  assert.equal(saved.length, 1);
  assert.match(path.basename(saved[0]), /^\d{8}-\d{6}-\d+$/);
  assertOriginalData(saved[0]);
  assert.equal(fs.existsSync(path.join(context.install, 'app', 'obsolete-route.ts')), false, 'Deleted application routes must not survive the update');
  assert.equal(fs.readFileSync(path.join(saved[0], 'app', 'obsolete-route.ts'), 'utf8'), 'old route must be removed\n');
  assert.equal(fs.readFileSync(path.join(saved[0], 'compose.txt'), 'utf8'), 'projet=' + project + '\nservice=myhomeia\n');
  assert.ok(fs.existsSync(path.join(saved[0], 'SAUVEGARDE-TERMINEE.txt')));
  const version = result.events.findIndex(event => isCompose(event, 'version'));
  const config = result.events.findIndex(event => isCompose(event, 'config'));
  const stop = result.events.findIndex(isStop);
  const confirmedStopped = result.events.findIndex(event => event[0] === 'running' && event[1] === 'false');
  const copy = result.events.findIndex(event => event[0] === 'cp');
  const copyData = result.events.findIndex(event => event[0] === 'cp' && event.includes(toShellPath(path.join(context.install, 'data'))));
  const moveApplication = result.events.findIndex(event => event[0] === 'mv' && event.includes(toShellPath(path.join(context.install, 'app'))));
  const extractInstall = result.events.findIndex(event => event[0] === 'extract' && event[1] === toShellPath(context.install));
  assert.ok(version >= 0 && config > version && stop > config && confirmedStopped > stop && copy > confirmedStopped && extractInstall > copy, JSON.stringify(result.events));
  assert.ok(copyData > confirmedStopped && moveApplication > copyData && extractInstall > moveApplication, 'Application replacement must follow the data backup');
  assert.ok(result.events[config].includes('--quiet'));
  assert.deepEqual(result.events[stop].slice(1), ['stop', '-t', '30', 'myhomeia']);
  for (const action of ['up', 'ps']) {
    const event = result.events.find(entry => isCompose(entry, action));
    assert.ok(event, action + ' must be called');
    assert.equal(event[event.indexOf('-p') + 1], project, 'The existing Compose project must be retained');
    assert.equal(event[event.indexOf('-f') + 1], toShellPath(path.join(context.install, 'docker-compose.yml')));
    assert.equal(event[event.indexOf('--env-file') + 1], toShellPath(path.join(context.install, '.env')));
    if (action === 'up') for (const option of ['-d', '--build', '--force-recreate', 'myhomeia']) assert.ok(event.includes(option));
  }
  assertCleanup(context);
}));

test('Mise à jour Synology : Docker Compose historique en secours', () => withFixture(context => {
  const result = context.run({ TEST_COMPOSE_LEGACY: '1' });
  assert.equal(result.status, 0, result.output);
  assert.ok(result.events.some(event => event[0] === 'docker' && isCompose(event, 'version')));
  for (const action of ['version', 'config', 'up', 'ps']) assert.ok(result.events.some(event => event[0] === 'docker-compose' && isCompose(event, action)));
  assertOriginalData(context.install);
  assertCleanup(context);
}));

test('Mise à jour Synology : ZIP incomplet refusé avant arrêt', () => withFixture(context => {
  context.writeZip(validEntries.filter(([name]) => name !== 'Dockerfile'));
  assertRejectedBeforeStop(context, context.run());
}));

test('Mise à jour Synology : .dockerignore manquant refusé avant arrêt', () => withFixture(context => {
  context.writeZip(validEntries.filter(([name]) => name !== '.dockerignore'));
  assertRejectedBeforeStop(context, context.run());
}));

test('Mise à jour Synology : archive corrompue avec mauvais CRC refusée avant arrêt', () => withFixture(context => {
  const archive = zip(validEntries);
  archive[30 + Buffer.byteLength(validEntries[0][0])] ^= 1;
  fs.writeFileSync(context.archive, archive);
  assertRejectedBeforeStop(context, context.run());
}));

test('Mise à jour Synology : fichier non ZIP refusé avant arrêt', () => withFixture(context => {
  fs.writeFileSync(context.archive, 'not a ZIP archive');
  assertRejectedBeforeStop(context, context.run());
}));

for (const entry of ['.env', '.env.production', 'app/.env', 'data/injected.sqlite', 'app/data/injected.sqlite']) {
  test('Mise à jour Synology : archive contenant ' + entry + ' refusée avant arrêt', () => withFixture(context => {
    context.writeZip([...validEntries, [entry, 'untrusted archive content\n']]);
    assertRejectedBeforeStop(context, context.run());
  }));
}

test('Mise à jour Synology : label de projet absent refusé sans arrêt', () => withFixture(context => {
  assertRejectedBeforeStop(context, context.run({ TEST_PROJECT: '' }));
}));

test('Mise à jour Synology : service Compose différent refusé sans arrêt', () => withFixture(context => {
  assertRejectedBeforeStop(context, context.run({ TEST_SERVICE: 'another-service' }));
}));

test('Mise à jour Synology : volume de données différent refusé sans arrêt', () => withFixture(context => {
  assertRejectedBeforeStop(context, context.run({ TEST_DATA_SOURCE: toShellPath(context.otherData) }));
}));

test('Mise à jour Synology : configuration Compose invalide refusée avant arrêt', () => withFixture(context => {
  const result = context.run({ TEST_CONFIG_FAIL: '1' });
  assert.ok(result.events.some(event => isCompose(event, 'config')));
  assertRejectedBeforeStop(context, result);
}));

test('Mise à jour Synology : arrêt confirmé obligatoire avant sauvegarde SQLite', () => withFixture(context => {
  const result = context.run({ TEST_STOP_STAYS_RUNNING: '1' });
  assert.notEqual(result.status, 0, result.output);
  assert.ok(result.events.some(isStop));
  assert.equal(result.events.some(event => event[0] === 'cp'), false);
  assert.deepEqual(backups(context), []);
  assertOriginalData(context.install);
  assertCleanup(context);
}));

test('Mise à jour Synology : copie interrompue conserve les sources et redémarre l’ancien service', () => withFixture(context => {
  const result = context.run({ TEST_COPY_FAIL: '1' });
  assert.notEqual(result.status, 0, result.output);
  assert.ok(result.events.some(event => event[0] === 'docker' && event[1] === 'start'));
  assert.equal(result.events.some(event => event[0] === 'extract' && event[1] === toShellPath(context.install)), false);
  assert.equal(fs.readFileSync(path.join(context.install, 'Dockerfile'), 'utf8'), 'old Dockerfile\n');
  assert.equal(fs.readFileSync(path.join(context.install, 'app', 'obsolete-route.ts'), 'utf8'), 'old route must be removed\n');
  const saved = backups(context);
  assert.equal(saved.length, 1);
  assert.equal(fs.existsSync(path.join(saved[0], 'SAUVEGARDE-TERMINEE.txt')), false);
  assertOriginalData(context.install);
  assertCleanup(context);
}));

test('Mise à jour Synology : échec de build conserve une sauvegarde complète et les données', () => withFixture(context => {
  const result = context.run({ TEST_BUILD_FAIL: '1' });
  assert.notEqual(result.status, 0, result.output);
  assert.ok(result.events.some(event => isCompose(event, 'up')));
  assert.equal(result.events.some(event => isCompose(event, 'ps')), false);
  const saved = backups(context);
  assert.equal(saved.length, 1);
  assertOriginalData(saved[0]);
  assert.equal(fs.readFileSync(path.join(saved[0], 'app', 'obsolete-route.ts'), 'utf8'), 'old route must be removed\n');
  assert.ok(fs.existsSync(path.join(saved[0], 'SAUVEGARDE-TERMINEE.txt')));
  assert.ok(result.output.includes('Sauvegarde conservee'));
  assert.equal(result.events.some(event => event[0] === 'docker' && event[1] === 'start'), false, 'Do not restart the old service after sources changed');
  assertOriginalData(context.install);
  assertCleanup(context);
}));

test('Mise à jour Synology : privilèges root requis avant toute commande Docker', () => withFixture(context => {
  const result = context.run({ TEST_UID: '1000' });
  assertRejectedBeforeStop(context, result);
  assert.equal(result.events.some(event => event[0] === 'docker' || event[0] === 'docker-compose'), false);
}));
