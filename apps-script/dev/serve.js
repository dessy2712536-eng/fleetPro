// Local preview without Google: runs Code.gs against the in-memory emulator.
//   node apps-script/dev/serve.js
// then set apiUrl in client/public/config.js to http://localhost:8787/exec and run the client.
// Data is kept in memory only and loaded with the demo fleet.
const http = require('http');
const { loadBackend } = require('./emulator');

const { ctx } = loadBackend();
ctx.setup();
ctx.loadDemoData();

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') { res.end(ctx.doGet().getContent()); return; }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.end(ctx.doPost({ postData: { contents: body } }).getContent());
  });
}).listen(8787, () => console.log('Emulated Google Sheet API on http://localhost:8787/exec (demo data loaded)'));
