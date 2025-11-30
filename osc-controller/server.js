/*
 * Minimal OSC controller server without external dependencies.
 *
 * This Node.js script implements two core pieces of functionality:
 *   1. It serves a static HTML file from the `public` directory
 *      when accessed via a web browser.  The HTML file should
 *      contain controls that call the `/osc` endpoint with JSON
 *      describing the OSC address and integer payload.
 *   2. It exposes a small HTTP API at `/osc` which accepts POST
 *      requests with a JSON body of the form `{"address": "…", "value": N}`.
 *      When such a request is received, this server will construct
 *      and send a single OSC message over UDP to the configured
 *      destination IP and port.
 *
 * The OSC message format used here follows the specification:
 *   - An OSC packet consists of an OSC address (string) followed
 *     by a type tag string (string beginning with comma) and
 *     argument data.  Each string is null‑terminated and padded
 *     with zeros to a 4‑byte boundary.  Integers are 32‑bit
 *     big‑endian.  Only integer values are supported here, but
 *     additional types could be added if desired.
 *
 * To run this server: node server.js
 * Browse to http://<server-ip>:3000/ to view the control page.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');

// Configuration: where to send OSC packets.  Change these values
// to match your Arduino's IP address and listening port.
const OSC_TARGET_IP = process.env.OSC_TARGET_IP || '10.1.4.28';
const OSC_TARGET_PORT = Number(process.env.OSC_TARGET_PORT || 8888);

// HTTP server port.  You can override via environment variable.
const HTTP_PORT = Number(process.env.PORT || 3000);

// Directory containing static files (HTML/JS/CSS).  It is assumed
// the public directory resides alongside this script.
const PUBLIC_DIR = path.join(__dirname, 'public');

// Create a UDP socket for sending OSC messages.
const udpSocket = dgram.createSocket('udp4');

/**
 * Build an OSC message buffer for a single integer argument.
 *
 * @param {string} address OSC address (e.g. '/eye/left/inc')
 * @param {number} value   Integer value to send
 * @returns {Buffer}       Buffer containing encoded OSC packet
 */
function buildOscMessage(address, value) {
  // Helper to pad a Buffer to a multiple of 4 bytes
  function pad4(buf) {
    const padding = (4 - (buf.length % 4)) % 4;
    if (padding === 0) return buf;
    return Buffer.concat([buf, Buffer.alloc(padding)]);
  }

  // Encode address and type tag string
  const addrBuf = pad4(Buffer.from(address + '\0'));
  const typeBuf = pad4(Buffer.from(',i\0'));
  // Encode 32‑bit big‑endian integer argument
  const argBuf = Buffer.alloc(4);
  argBuf.writeInt32BE(value, 0);
  return Buffer.concat([addrBuf, typeBuf, argBuf]);
}

/**
 * Serve a static file from the PUBLIC_DIR.  Falls back to index.html
 * when requesting the root path.
 *
 * @param {string} urlPath URL path from HTTP request
 * @param {http.ServerResponse} res
 */
function serveStatic(urlPath, res) {
  let filePath = urlPath;
  if (urlPath === '/' || urlPath === '') {
    filePath = '/index.html';
  }
  const absPath = path.join(PUBLIC_DIR, filePath);
  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.writeHead(404, {'Content-Type': 'text/plain'});
      res.end('Not found');
      return;
    }
    // Basic content type mapping
    let contentType = 'text/plain';
    if (filePath.endsWith('.html')) contentType = 'text/html';
    else if (filePath.endsWith('.css')) contentType = 'text/css';
    else if (filePath.endsWith('.js')) contentType = 'application/javascript';
    res.writeHead(200, {'Content-Type': contentType});
    res.end(data);
  });
}

// Create the HTTP server
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/osc') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const { address, value } = JSON.parse(body || '{}');

        if (typeof address !== 'string') {
          throw new Error('Invalid address');
        }

        // 🔥 special case: storm sequence, ignore value and DON’T send to OSC_TARGET_IP
        if (address === '/storm/trigger') {
          triggerStormSequence();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, storm: true }));
          return;
        }

        // normal single-destination behavior (snail eyes etc.)
        const intVal = parseInt(value);
        if (isNaN(intVal)) {
          throw new Error('Invalid value');
        }

        const buf = buildOscMessage(address, intVal);
        udpSocket.send(buf, 0, buf.length, OSC_TARGET_PORT, OSC_TARGET_IP, (err) => {
          if (err) {
            console.error('OSC send error:', err);
          } else {
            console.log('OSC sent to', OSC_TARGET_IP + ':' + OSC_TARGET_PORT, address, intVal);
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  // Otherwise serve static files
  serveStatic(req.url, res);
});

server.listen(HTTP_PORT, () => {
  console.log(`Server is listening on http://localhost:${HTTP_PORT}`);
  console.log(`OSC messages will be forwarded to ${OSC_TARGET_IP}:${OSC_TARGET_PORT}`);
});