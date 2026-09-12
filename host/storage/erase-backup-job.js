'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');

// Hashing large retained snapshots runs in a finite process, keeping Core's
// request loop responsive and releasing the scan's memory when it finishes.
function eraseBackupJob(paths, job, lockFd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', __filename], {
      stdio: ['pipe', 'pipe', 'pipe', lockFd], env: process.env,
    });
    let output = '', bytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 60 * 60 * 1000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 4096) child.kill('SIGKILL'); else output += chunk; });
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 4096) child.kill('SIGKILL'); });
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(Error('directory_backup_erasure_failed')); });
    child.on('close', code => {
      clearTimeout(timer);
      try { if (code !== 0 || JSON.parse(output).ok !== true) throw Error(); resolve(); }
      catch { reject(Error('directory_backup_erasure_failed')); }
    });
    child.stdin.end(JSON.stringify({ platformRoot: paths.platformRoot, id: job.id,
      organizationId: job.organizationId, runtimeKey: job.runtimeKey }));
  });
}
if (require.main === module) {
  (async () => {
    let text = '', store;
    try {
      for await (const chunk of process.stdin) { text += chunk; if (text.length > 8192) throw Error(); }
      const job = JSON.parse(text);
      if (!/^[a-f0-9]{64}$/.test(job.id)) throw Error();
      require('../../shared/paths/platform-paths').validateDspId(job.runtimeKey);
      const paths = require('../../shared/paths/platform-paths').platformPaths(job.platformRoot);
      const root = path.join(paths.local, 'state/access-control');
      store = new (require('../../core/accounts/src/store').AccessStore)({ databaseRoot: root, database: path.join(root, 'access-control.sqlite3') });
      const backups = new (require('./manual-backups').ManualBackups)({ paths, store });
      require('./erase-backups').eraseBackups(backups, job);
      process.stdout.write('{"ok":true}\n');
    } catch { process.stdout.write('{"ok":false}\n'); process.exitCode = 1; }
    finally { store?.close(); }
  })();
}
module.exports = { eraseBackupJob };
