// A frontend rendered by a Node server (a test fixture): there is no static index.html to host.
const http = require('node:http');
http.createServer((req, res) => res.end(`<!doctype html><title>Rendered</title><p>Hello at ${new Date().toISOString()}</p>`)).listen(3000);
