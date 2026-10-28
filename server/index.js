// Entry point: HTTP, and HTTPS/TLS when certificate files are configured.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const SSL_KEY_FILE = process.env.SSL_KEY_FILE;
const SSL_CERT_FILE = process.env.SSL_CERT_FILE;

const app = createApp();

if (SSL_KEY_FILE && SSL_CERT_FILE) {
  // TLS mode: serve HTTPS on HTTPS_PORT and redirect plain HTTP to it.
  let tlsOptions;
  try {
    tlsOptions = {
      key: fs.readFileSync(SSL_KEY_FILE),
      cert: fs.readFileSync(SSL_CERT_FILE),
    };
  } catch (err) {
    console.error(`Failed to read TLS files: ${err.message}`);
    process.exit(1);
  }
  https.createServer(tlsOptions, app).listen(HTTPS_PORT, () => {
    console.log(`HTTPS (TLS) listening at https://localhost:${HTTPS_PORT}`);
  });
  http
    .createServer((req, res) => {
      const host = String(req.headers.host || 'localhost').replace(/:\d+$/, '');
      res.writeHead(301, { Location: `https://${host}:${HTTPS_PORT}${req.url}` });
      res.end();
    })
    .listen(PORT, () => {
      console.log(`HTTP -> HTTPS redirect on http://localhost:${PORT}`);
    });
} else {
  app.listen(PORT, () => {
    console.log(`Course Registration System running at http://localhost:${PORT}`);
    console.log('Tip: set SSL_KEY_FILE and SSL_CERT_FILE to enable HTTPS/TLS.');
  });
}
