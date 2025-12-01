/* === Nova Kukla === */
/* === osc-controller === */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const dgram = require('dgram');

// snail eyes ip and port
const OSC_TARGET_IP   = process.env.OSC_TARGET_IP   || '10.1.4.28';
const OSC_TARGET_PORT = Number(process.env.OSC_TARGET_PORT || 8888);

// HTTP server port
const HTTP_PORT  = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

// UDP socket for OSC
const udpSocket = dgram.createSocket('udp4');

function buildOscMessage(address, value) 
{
  function pad4(buf) 
  {
    const padding = (4 - (buf.length % 4)) % 4;
    if (padding === 0) return buf;
    return Buffer.concat([buf, Buffer.alloc(padding)]);
  }

  const addrBuf = pad4(Buffer.from(address + '\0'));
  const typeBuf = pad4(Buffer.from(',i\0'));
  const argBuf  = Buffer.alloc(4);
  argBuf.writeInt32BE(value, 0);

  return Buffer.concat([addrBuf, typeBuf, argBuf]);
}

/* === serve static file === */
  function serveStatic(urlPath, res) 
  {
    let filePath = urlPath;
    if (urlPath === '/' || urlPath === '') { filePath = '/main.html'; }
    const absPath = path.join(PUBLIC_DIR, filePath);

    fs.readFile(absPath, (err, data) => 
    {
      if (err) 
      {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      let contentType = 'text/plain';
      if (filePath.endsWith('.html')) contentType = 'text/html';
      else if (filePath.endsWith('.css')) contentType = 'text/css';
      else if (filePath.endsWith('.js')) contentType = 'application/javascript';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }

/*
 * Console equivalents:
 * oscsend 10.1.10.151 7000 /composition/layers/2/clear i 0
 * oscsend 10.1.10.101 7070 /bkwt/van/cat-caller/win i 1
 * oscsend 10.1.10.151 7000 /composition/layers/2/clips/1/connect i 1
 * (wait)
 * oscsend 10.1.10.151 7000 /composition/layers/2/clear i 1
 */
 const RESOLUME_CLEAR_DELAY_MS = 60000;

 function triggerStormSequence() 
  {
   console.log('calling cat caller...');

   function sendOscTo(address, value, ip, port) 
   {
     const buf = buildOscMessage(address, value);
     udpSocket.send(buf, 0, buf.length, port, ip, (err) => 
    {
    if (err) { console.error('OSC send error to', `${ip}:${port}`, address, err); }
    else 
      { console.log('OSC sent to', `${ip}:${port}`, address, value); }
    });
   }
   sendOscTo('/bkwt/van/cat-caller/win', 1, '10.1.10.101', 7070);
   sendOscTo('/composition/layers/2/clear', 0, '10.1.10.151', 7000);
   sendOscTo('/composition/layers/2/clips/1/connect', 1, '10.1.10.151', 7000);

   setTimeout(() => 
   {
     sendOscTo('/composition/layers/2/clear', 1, '10.1.10.151', 7000);
     console.log('Storm sequence complete (final clear sent).');
   }, RESOLUME_CLEAR_DELAY_MS);
  }


// HTTP server
const server = http.createServer((req, res) => 
{
  if (req.method === 'POST' && req.url === '/osc') 
  {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => 
    {
      try 
      {
        const { address, value } = JSON.parse(body || '{}');

        if (typeof address !== 'string') { throw new Error('Invalid address'); }

        if (address === '/storm/trigger') 
        {
          triggerStormSequence();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, storm: true }));
          return;
        }

        const intVal = parseInt(value);
        if (isNaN(intVal)) { throw new Error('Invalid value'); }

        const buf = buildOscMessage(address, intVal);
        udpSocket.send(buf, 0, buf.length, OSC_TARGET_PORT, OSC_TARGET_IP, (err) => 
        {
          if (err) { console.error('OSC send error:', err); } 
          else { console.log('OSC sent to', `${OSC_TARGET_IP}:${OSC_TARGET_PORT}`, address, intVal); }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } 
      catch (e) 
      {
        console.error('Request error:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Otherwise static file
  serveStatic(req.url, res);
});

server.listen(HTTP_PORT, () => 
{
  console.log(`Server is listening on http://localhost:${HTTP_PORT}`);
  console.log(`OSC messages will be forwarded to ${OSC_TARGET_IP}:${OSC_TARGET_PORT}`);
});
