// The game's project files on this machine (xgames.fun's STORAGE.md §2, §8.6–8.7): what env.GF.files keeps, here in
// <game>/.gamesfun/dev/files/ (a hidden folder: never published), with the same paths, answers, limits and serving
// rules as xgames.fun's bucket and files domain:
//   - createFileStore: put, get, head, list, delete, usage, as env.GF.files answers them (./gf-local.js calls them
//     through ./platform.mjs), and `xcore files` without --live;
//   - serveFiles: the public files on an origin of their own (another port of this machine), as
//     <slug>.xgamesusercontent.com serves them: cross-origin to the game's page, as live, though same-site here (both
//     are 127.0.0.1), where live xgamesusercontent.com is another site as well.
// Every answer is {ok: true, …} or {ok: false, code, why}; none throws.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { FILES, filePathProblem, fileType, servedType } from '../server/contract.mjs';

const no = (code, why) => ({ ok: false, code, why });

/** One game's files. `origin`: where the public ones are served (a function: the files server's port comes later). */
export function createFileStore({ dir, origin = () => null, cap = FILES.capBytes, fileBytes = FILES.fileBytes }) {
  const root = path.join(dir, '.gamesfun', 'dev', 'files');
  const index = path.join(dir, '.gamesfun', 'dev', 'files.json');
  let meta = null,
    chain = Promise.resolve();
  // the index by path, on an object with no prototype: a file may be called __proto__, constructor or toString
  const load = async () => {
    if (meta) return meta;
    let read = null;
    try {
      read = JSON.parse(await readFile(index, 'utf8'));
    } catch {
      /* none yet, or unreadable: empty */
    }
    meta = Object.create(null);
    if (read && typeof read === 'object' && !Array.isArray(read))
      for (const [k, v] of Object.entries(read)) if (v && typeof v === 'object') meta[k] = v;
    return meta;
  };
  const at = (m, p) => (Object.hasOwn(m, p) ? m[p] : undefined);
  const save = async () => {
    await mkdir(path.dirname(index), { recursive: true });
    await writeFile(`${index}.tmp`, JSON.stringify(meta, null, 2) + '\n');
    await rename(`${index}.tmp`, index);
  };
  // one change at a time, so the byte count and the files agree
  const queued = fn => (chain = chain.then(fn, fn));
  const fileOf = p => path.join(root, ...p.split('/'));
  const used = m => Object.values(m).reduce((n, f) => n + f.bytes, 0);
  const urlOf = p => {
    const o = origin();
    return o ? `${o}/${p}` : null;
  };
  const item = (p, f) => ({ path: p, bytes: f.bytes, type: f.type, public: f.public, updatedAt: f.updatedAt });

  return {
    root,
    /** body: a string, bytes (ArrayBuffer, a typed array, a Buffer). → {ok, path, bytes, url?} */
    put(p, body, { type, public: isPublic = false } = {}) {
      return queued(async () => {
        const bad = filePathProblem(p);
        if (bad) return no('path', bad);
        const bytes =
          typeof body === 'string'
            ? Buffer.from(body, 'utf8')
            : body instanceof ArrayBuffer
              ? Buffer.from(body)
              : ArrayBuffer.isView(body)
                ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
                : null;
        if (!bytes) return no('body', 'A file is a string, an ArrayBuffer or a stream of bytes.');
        if (bytes.length > fileBytes)
          return no(
            'too-big',
            `A file may be ${Math.round(fileBytes / 1048576)} MB; this one is ${(bytes.length / 1048576).toFixed(1)} MB.`,
          );
        const m = await load();
        const was = at(m, p)?.bytes ?? 0;
        if (used(m) - was + bytes.length > cap)
          return no('full', `The game's files would pass its ${Math.round(cap / 1048576)} MB: delete some first.`);
        const file = fileOf(p);
        // a file can't be where a folder is, nor the other way round
        if (Object.keys(m).some(k => k.startsWith(`${p}/`) || p.startsWith(`${k}/`)))
          return no('path', `${p} is a folder of other files, or inside a file: pick another path.`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.gf-tmp`, bytes);
        await rename(`${file}.gf-tmp`, file);
        m[p] = {
          bytes: bytes.length,
          type: typeof type === 'string' && type ? type.slice(0, 200) : fileType(p),
          public: !!isPublic,
          updatedAt: Date.now(),
          etag: createHash('sha256').update(bytes).digest('hex').slice(0, 32),
        };
        await save();
        const url = m[p].public ? urlOf(p) : null;
        return { ok: true, path: p, bytes: bytes.length, ...(url ? { url } : {}) };
      });
    },
    /** → {ok, body (a Buffer), type, bytes, public} */
    async get(p) {
      const h = await this.head(p);
      if (!h.ok) return h;
      try {
        return { ...h, body: await readFile(fileOf(p)) };
      } catch {
        return no('not-found', 'No such file.');
      }
    },
    /** → {ok, path, type, bytes, public, updatedAt, etag} */
    async head(p) {
      const bad = filePathProblem(p);
      if (bad) return no('path', bad);
      await chain;
      const f = at(await load(), p);
      if (!f) return no('not-found', 'No such file.');
      return { ok: true, ...item(p, f), etag: f.etag };
    },
    /** {prefix ('' or ending in /), after (the last path of the page before), limit ≤ 1000} → {ok, items, after} */
    async list({ prefix = '', after = '', limit = 100 } = {}) {
      if (typeof prefix !== 'string' || (prefix && (!prefix.endsWith('/') || filePathProblem(prefix.slice(0, -1)))))
        return no('prefix', 'A prefix is empty, or a folder ending in /: "replays/".');
      await chain;
      const n = Math.max(1, Math.min(FILES.listMax, Number(limit) | 0 || 100));
      const m = await load();
      const names = Object.keys(m)
        .filter(k => k.startsWith(prefix) && (!after || k > String(after)))
        .sort();
      const page = names.slice(0, n);
      return {
        ok: true,
        items: page.map(k => item(k, m[k])),
        after: names.length > n ? page.at(-1) : null,
      };
    },
    /** → {ok, deleted} */
    delete(p) {
      return queued(async () => {
        const bad = filePathProblem(p);
        if (bad) return no('path', bad);
        const m = await load();
        if (!at(m, p)) return { ok: true, deleted: false };
        delete m[p];
        await rm(fileOf(p), { force: true });
        await save();
        return { ok: true, deleted: true };
      });
    },
    /** → {ok, bytes, files, cap} */
    async usage() {
      await chain;
      const m = await load();
      return { ok: true, bytes: used(m), files: Object.keys(m).length, cap };
    },
    /** The file's bytes on disk, for the files server (a public file only). → {meta, file} | null */
    async served(p) {
      await chain;
      const f = at(await load(), p);
      if (!f?.public) return null;
      const file = fileOf(p);
      return existsSync(file) ? { meta: f, file, size: (await stat(file)).size } : null;
    },
  };
}

/** The headers every answer of the files domain carries (§8.7). */
export const FILE_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'content-security-policy': "sandbox; default-src 'none'",
  'cross-origin-resource-policy': 'cross-origin',
  'access-control-allow-origin': '*',
  'referrer-policy': 'no-referrer',
});

const isLocalHost = host =>
  /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d{1,5})?$/i.test(String(host ?? ''));

/**
 * The public files on an origin of their own: GET, HEAD and OPTIONS; a path decoded once (an encoded / or a ..
 * refused); only a public file; ETag and one byte range; media, fonts, JSON and plain text inline, anything else as
 * application/octet-stream with Content-Disposition: attachment. → {origin, server, close()}
 */
export function serveFiles(store, { port = 0, host = '127.0.0.1' } = {}) {
  const server = createServer(async (req, res) => {
    const send = (status, extra = {}, body = '') => {
      res.writeHead(status, { ...FILE_HEADERS, 'cache-control': 'no-store', ...extra });
      res.end(body);
    };
    if (!isLocalHost(req.headers.host)) return send(403, { 'content-type': 'text/plain' }, 'This machine only.');
    if (req.method === 'OPTIONS')
      return send(204, {
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'range',
      });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { allow: 'GET, HEAD, OPTIONS' });
    const raw = new URL(req.url, 'http://x').pathname.slice(1);
    // decoded once: an encoded slash (a path that is not the one it looks like) or a dot segment is refused
    let p;
    try {
      if (/%2f|%5c/i.test(raw)) throw new Error('slash');
      p = decodeURIComponent(raw);
    } catch {
      return send(400, { 'content-type': 'text/plain' }, 'Not a file path.');
    }
    if (filePathProblem(p)) return send(404, { 'content-type': 'text/plain' }, 'No such file.');
    const f = await store.served(p);
    if (!f) return send(404, { 'content-type': 'text/plain' }, 'No such file.');
    const { type, inline } = servedType(f.meta.type);
    const etag = `"${f.meta.etag}"`;
    const head = {
      'content-type': type,
      etag,
      'accept-ranges': 'bytes',
      'last-modified': new Date(f.meta.updatedAt).toUTCString(),
      ...(inline ? {} : { 'content-disposition': `attachment; filename="${path.basename(p)}"` }),
    };
    if (req.headers['if-none-match'] === etag) return send(304, head);
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    let start = 0,
      end = f.size - 1,
      status = 200;
    if (req.headers.range) {
      if (!range || (range[1] === '' && range[2] === '')) return send(416, { 'content-range': `bytes */${f.size}` });
      if (range[1] === '') start = Math.max(0, f.size - Number(range[2]));
      else {
        start = Number(range[1]);
        if (range[2] !== '') end = Math.min(end, Number(range[2]));
      }
      if (start > end || start >= f.size) return send(416, { 'content-range': `bytes */${f.size}` });
      status = 206;
      head['content-range'] = `bytes ${start}-${end}/${f.size}`;
    }
    res.writeHead(status, { ...FILE_HEADERS, 'cache-control': 'no-store', ...head, 'content-length': end - start + 1 });
    if (req.method === 'HEAD' || f.size === 0) return res.end();
    createReadStream(f.file, { start, end })
      .on('error', () => res.destroy())
      .pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const origin = `http://${host}:${server.address().port}`;
      resolve({ origin, server, close: () => new Promise(r => server.close(() => r())) });
    });
  });
}
