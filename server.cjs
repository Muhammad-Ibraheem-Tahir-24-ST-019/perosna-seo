'use strict';

/**
 * Single-process entrypoint for Hostinger's Node.js (Passenger) hosting.
 * Runs api + worker as internal child processes and Next.js as the
 * in-process HTTP listener bound to the public port Passenger assigns.
 *
 * Point Hostinger's "Application startup file" at this file.
 */

const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'apps/web');
const PUBLIC_PORT = process.env.PORT || 3000;
const API_PORT = process.env.API_PORT || 4000;

process.env.API_PORT = String(API_PORT);
process.env.API_HOST = '127.0.0.1';
process.env.API_INTERNAL_URL = `http://127.0.0.1:${API_PORT}`;
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

function runChild(name, scriptPath) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    console.error(`[${name}] exited (code=${code} signal=${signal}), restarting in 3s`);
    setTimeout(() => runChild(name, scriptPath), 3000);
  });
  return child;
}

runChild('api', path.join(ROOT, 'apps/api/dist/index.js'));
runChild('worker', path.join(ROOT, 'apps/worker/dist/index.js'));

// eslint-disable-next-line import/no-extraneous-dependencies
const next = require(path.join(WEB_DIR, 'node_modules/next'));
const app = next({ dev: false, dir: WEB_DIR });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    http
      .createServer((req, res) => handle(req, res))
      .listen(PUBLIC_PORT, () => {
        console.log(`web listening on port ${PUBLIC_PORT}`);
      });
  })
  .catch((err) => {
    console.error('Next.js failed to start', err);
    process.exit(1);
  });
