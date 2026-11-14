// SDA Sabbath service worker: installs the whole app (Bibles, hymns, fonts, pdf.js) in one go
// so it runs with no internet. VERSION is rewritten by tools/build.py on every build.
const VERSION = '1e89cdce915f';
// Caches are named per address ('selah-/|<version>' at ssdesk.online), so two apps on the same site
// (for example this one and an older copy under another folder) never delete each other's offline files.
const SCOPE = new URL(self.registration.scope).pathname;
const PREFIX = 'selah-' + SCOPE + '|';
const CACHE = PREFIX + VERSION;
const LEGACY = /^selah-[0-9a-f]{6,}$/; // the first versions: one shared name, 'selah-<hash>'
const NETWORK_ONLY = /\/(api|media|ws|download)(\/|$)|\/(hq|studio)\.sf3$|\/FluidR3_GM\.sf2\.part\d$|\/GeneralUser-GS\.sf2$/; // the optional sound packs keep their own cache (musicengine.js, fluidengine.js)

async function broadcast(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  cs.forEach((c) => c.postMessage(msg));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * fetch() that cannot hang: Wi-Fi with no internet ("lie-fi") leaves requests open forever. It gives up when the
 * answer does not start within headMs, or when the download stalls for stallMs (a slow line that keeps moving is
 * fine). The whole body is read here, so a file cut off half-way is an error, not a short file.
 */
async function fetchT(url, opts = {}, headMs = 15000, stallMs = 20000) {
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(), headMs);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: ctl.signal }));
    clearTimeout(timer);
    if (!r.ok || !r.body) return r;
    const reader = r.body.getReader();
    const parts = [];
    for (;;) {
      timer = setTimeout(() => ctl.abort(), stallMs);
      const { done, value } = await reader.read();
      clearTimeout(timer);
      if (done) break;
      parts.push(value);
    }
    return new Response(new Blob(parts, { type: r.headers.get('content-type') || '' }), { status: r.status, statusText: r.statusText, headers: r.headers });
  } finally { clearTimeout(timer); }
}
/** fetch() that tries again a few times: church Wi-Fi and phone hotspots drop requests. */
async function fetchRetry(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetchT(url, opts); if (r.ok) return r; last = new Error('HTTP ' + r.status); if (r.status === 404) break; }
    catch (e) { last = e; }
    if (i < tries - 1) await sleep(400 * (i + 1));
  }
  throw last || new Error('fetch failed');
}
/** First 16 hex digits of the SHA-256 of a body: the same fingerprint tools/build.py writes into the file list. */
async function sha16(blob) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  let s = '';
  for (let i = 0; i < 8; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}
// A Wi-Fi login page ("captive portal") or a proxy error answers with an HTML page and status 200 in place of the
// file. Such an answer is never stored as an app file.
const htmlInstead = (f, r) => !/\.html?$/.test(f) && /text\/html/i.test(r.headers.get('content-type') || '');
/**
 * The response with its content checked against the file list: returns a stored-ready copy stamped as checked,
 * or null when it is not the real file (wrong content, a login page, a stale copy from a cache).
 */
async function verified(f, r, want) {
  if (!r || htmlInstead(f, r)) return null;
  const blob = await r.blob();
  if (want && (await sha16(blob)) !== want) return null;
  const hd = new Headers(r.headers);
  if (want) { hd.set('x-selah-hash', want); hd.set('x-selah-ok', want); }
  return new Response(blob, { status: 200, statusText: 'OK', headers: hd });
}
/** A stored copy that was checked against this fingerprint already (cheap: a header). */
const checkedFor = (r, want) => !!(r && want && r.headers.get('x-selah-ok') === want);
// The app itself: without these nothing starts. The first install must store all of them before it takes over;
// Bibles, hymns, music and the rest may follow later (the self-check fetches what is missing).
const SHELL = (f) => /\.(html|webmanifest)$/.test(f) || /^(js|css|fonts|icons)\//.test(f);
const appCaches = async () => (await caches.keys()).filter((k) => k.startsWith(PREFIX));
/** Old-style caches whose files all belong to this app's address: they are ours to reuse and then remove.
 *  A cache holding another app's files (or nothing we can recognise) is left alone. */
async function legacyOwn() {
  const mine = [];
  for (const k of (await caches.keys()).filter((n) => LEGACY.test(n))) {
    try {
      const reqs = await (await caches.open(k)).keys();
      if (reqs.length && reqs.every((r) => new URL(r.url).pathname.startsWith(SCOPE))) mine.push(k);
    } catch (e) { /* unreadable: leave it */ }
  }
  return mine;
}
/** The file from any stored version (newest first): an older copy is far better than nothing offline. */
async function fromAnyCache(req, except) {
  const keys = (await appCaches()).concat(await legacyOwn()).filter((k) => k !== except).reverse();
  for (const k of keys) { const r = await (await caches.open(k)).match(req, { ignoreSearch: true }); if (r) return r; }
  return null;
}
/** The last resort when offline: a copy from another stored version, but only one that is this version's file
 *  (same fingerprint as in this version's file list) — never a newer version's file mixed into this one, and
 *  never a login page stored by mistake. Files not in the list (extra data added later) only need to be real. */
async function storedCopy(f, except) {
  const man = await getManifest();
  const want = man && man.hashes && man.hashes[f];
  const keys = (await appCaches()).concat(await legacyOwn()).filter((k) => k !== except).reverse();
  for (const k of keys) {
    const r = await (await caches.open(k)).match(f, { ignoreSearch: true });
    if (!r || htmlInstead(f, r)) continue;
    if (!want) { if (!(man && man.files && man.files.includes(f))) return r; continue; }
    if (checkedFor(r, want)) return r;
    const ok = await verified(f, r, want).catch(() => null);
    if (ok) return ok;
  }
  return null;
}
/** Is this a real file list (not a login page or a cut-off download)? */
function goodManifest(m) {
  return !!(m && Array.isArray(m.files) && m.files.length && m.files.every((f) => typeof f === 'string') && m.hashes && typeof m.hashes === 'object');
}
// The first visit stores the app, the indexes, the hymnbooks and one Bible before it takes over; the rest (the
// other Bibles, hymn music, the PDF reader, the sound engine and streaming) follows straight after, in the
// background, while the app can already be used. Updates always store everything before they take over.
const LATER = (f) => /^data\/music\//.test(f) || /^vendor\/(pdfjs|spessasynth|fluidsynth|hls)\//.test(f) || (/^data\/bibles\/[^/]+\//.test(f) && !/^data\/bibles\/kjv\//.test(f));
const BATCH = 12;

let manifest = null;
async function getManifest() {
  if (manifest) return manifest;
  const r = await (await caches.open(CACHE)).match('asset-manifest.json');
  if (r) manifest = await r.json();
  return manifest;
}

self.addEventListener('install', (event) => {
  // First install: take over at once. Updates wait until the operator presses "Update now"
  // (the page sends {t:'skip'}), so a running service is never switched mid-way.
  const first = !self.registration.active;
  if (first) self.skipWaiting();
  event.waitUntil((async () => {
    const manRes = await fetchRetry('asset-manifest.json?v=' + VERSION, { cache: 'no-store' });
    // A login page or a cut-off download in place of the file list is never stored: the install stops here.
    let man = null;
    try { if (!htmlInstead('asset-manifest.json', manRes)) man = await manRes.clone().json(); } catch (e) { man = null; }
    if (!goodManifest(man)) throw new Error('not the real file list');
    const cache = await caches.open(CACHE);
    // Keep the file list too: the app reads it offline (offline status, optional licensed Bibles).
    await cache.put('asset-manifest.json', manRes.clone());
    manifest = man;
    const files = man.files;
    const hashes = man.hashes || {};
    const older = (await appCaches()).filter((k) => k !== CACHE).concat(await legacyOwn());
    // A file whose content did not change is copied from the previous version's cache, so an
    // update only downloads what is new (the instruments and hymn music are about 6 MB). Its content is checked
    // (once), so a login page stored by an older version is never carried over.
    async function unchanged(f) {
      const want = hashes[f];
      if (!want) return null;
      for (const k of older) {
        const r = await (await caches.open(k)).match(f);
        if (!r || r.headers.get('x-selah-hash') !== want) continue;
        if (checkedFor(r, want)) return r;
        const ok = await verified(f, r, want);
        if (ok) return ok;
      }
      return null;
    }
    /** Download one file and store it only if it is the real file (checked against the file list). */
    async function getOne(f) {
      const here = await cache.match(f);                 // an earlier, interrupted attempt
      if (here && (checkedFor(here, hashes[f]) || !hashes[f]) && !htmlInstead(f, here)) return;
      const old = await unchanged(f);
      if (old) { await cache.put(f, old); return; }
      const ok = await verified(f, await fetchRetry(f, { cache: 'no-cache' }), hashes[f]);
      if (!ok) throw new Error('not the real file: ' + f);
      await cache.put(f, ok);
    }
    let done = 0, streak = 0;
    const missing = [];
    const firstVisit = !older.length;
    // On mobile data with Data saver or a slow connection, a first visit stores only the app itself; the hymnbooks
    // and Bible follow straight after in the background (the app's self-check), like the music.
    const cn = self.navigator && self.navigator.connection;
    const slow = !!(cn && (cn.saveData || /(^|-)2g$|^3g$/.test(cn.effectiveType || '')));
    const later = firstVisit ? files.filter((f) => !SHELL(f) && (LATER(f) || slow)) : [];
    const shell = files.filter(SHELL), rest = files.filter((f) => !SHELL(f) && !later.includes(f));
    // Batches keep memory and connections reasonable on weak devices. The app itself comes first.
    for (const [group, isShell] of [[shell, true], [rest, false]]) {
      for (let i = 0; i < group.length; i += BATCH) {
        const batch = group.slice(i, i + BATCH);
        // No answers at all for a while (no internet): stop trying the data now; the self-check fetches it later.
        if (!isShell && !older.length && streak >= 12) { batch.forEach((f) => missing.push(f)); done += batch.length; continue; }
        await Promise.all(batch.map(async (f) => {
          try { await getOne(f); streak = 0; } catch (e) { missing.push(f); streak++; }
          done++;
        }));
        broadcast({ t: 'progress', done, total: files.length - later.length });
      }
      // Without the app itself, a first install never takes over: the next visit tries again.
      if (isShell && !older.length && missing.length) {
        broadcast({ t: 'health', total: files.length, missing: missing.length, install: 'failed' });
        throw new Error('First install incomplete: ' + missing.length + ' app files');
      }
    }
    if (missing.length && older.length) {
      // An update that could not download everything is not used: the working version stays in
      // charge (fully offline) and the update is tried again later. Nothing is ever half-updated.
      broadcast({ t: 'health', total: files.length, missing: missing.length, update: 'failed' });
      throw new Error('Update incomplete: ' + missing.length + ' files');
    }
    if (missing.length) broadcast({ t: 'health', total: files.length, missing: missing.length });
  })().catch(async (e) => {
    // A first install that failed leaves nothing half-done behind (an update keeps its checked files, so the
    // next try only downloads what is still missing).
    if (!self.registration.active) { try { await caches.delete(CACHE); } catch (er) { /* */ } }
    throw e;
  }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = (await appCaches()).concat(await legacyOwn());
    const cache = await caches.open(CACHE);
    const man = await getManifest();
    // Before an old version is removed, anything the new one lacks is copied across.
    if (man) {
      const hashes = man.hashes || {};
      for (const f of man.files) {
        if (await cache.match(f)) continue;
        const r = await fromAnyCache(f, CACHE);
        const ok = r && (checkedFor(r, hashes[f]) ? r : await verified(f, r, hashes[f]));
        if (ok) await cache.put(f, ok);
      }
    }
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    broadcast({ t: 'progress', done: 1, total: 1 });
  })());
});

/** Is every app file stored, and is each one the real file? Missing files are downloaded again when there is
 *  internet. One check at a time (the first one reads every file once to check it; later ones are quick). */
let checking = Promise.resolve();
function checkAndRepair(repair, first) {
  const run = checking.then(() => checkOnce(repair, first));
  checking = run.catch(() => {});
  return run;
}
async function checkOnce(repair, first) {
  const man = await getManifest();
  if (!man) return { total: 0, have: 0, missing: [] };
  const cache = await caches.open(CACHE);
  const hashes = man.hashes || {};
  const missing = [];
  let bad = 0;
  for (const f of man.files) {
    const r = await cache.match(f);
    if (!r) { missing.push(f); continue; }
    if (checkedFor(r, hashes[f]) || (!hashes[f] && !htmlInstead(f, r))) continue;
    // Not checked yet (stored by an older version): check it once; a wrong file counts as missing.
    const ok = await verified(f, r, hashes[f]).catch(() => null);
    if (ok) await cache.put(f, ok);
    else { await cache.delete(f); missing.push(f); bad++; }
  }
  let fixed = 0;
  if (repair && missing.length) {
    // What the page needs first (its chosen Bible and hymnbook) comes first, then the rest, several at a time.
    const prio = (f) => { const i = (first || []).findIndex((p) => typeof p === 'string' && p && f.startsWith(p)); return i < 0 ? 99 : i; };
    const todo = missing.slice().sort((a, b) => prio(a) - prio(b));
    const total = man.files.length, start = total - missing.length;
    let fails = 0;
    const one = async (f) => {
      try {
        const ok = await verified(f, await fetchRetry(f, { cache: 'no-cache' }, 2), hashes[f]);
        if (!ok) throw new Error('not the real file');
        await cache.put(f, ok); fixed++; missing.splice(missing.indexOf(f), 1); fails = 0;
      } catch (e) {
        const ok = await storedCopy(f, CACHE);
        if (ok) { await cache.put(f, ok); fixed++; missing.splice(missing.indexOf(f), 1); } else fails++;
      }
    };
    for (let i = 0; i < todo.length; i += BATCH) {
      if (fails >= 24) break; // no internet after all: the next check carries on
      await Promise.all(todo.slice(i, i + BATCH).map(one));
      broadcast({ t: 'progress', done: start + fixed, total });
    }
    broadcast({ t: 'progress', done: total, total });
  }
  return { total: man.files.length, have: man.files.length - missing.length, missing: missing.slice(0, 20), missingCount: missing.length, fixed, bad, version: VERSION };
}

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.t === 'skip') self.skipWaiting();
  if (d.t === 'check') {
    const reply = (m) => { try { e.source && e.source.postMessage(m); } catch (er) { /* */ } };
    e.waitUntil(checkAndRepair(!!d.repair, Array.isArray(d.first) ? d.first.slice(0, 6) : null).then((r) => reply(Object.assign({ t: 'health' }, r))).catch((er) => reply({ t: 'health', error: String(er) })));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || NETWORK_ONLY.test(url.pathname)) return;
  // The internet check (js/core/net.js) must reach the real network: never answer it from here.
  if (url.searchParams.has('ping')) return;
  if (req.headers.get('range')) {
    // Audio and video ask for byte ranges. A stored file answers them itself, so it also plays offline once the
    // browser's own short-lived cache is gone; anything not stored goes to the network (or the companion).
    event.respondWith((async () => {
      const hit = await (await caches.open(CACHE)).match(req, { ignoreSearch: true });
      if (!hit) return fetch(req);
      const blob = await hit.blob();
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
      let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : blob.size - 1;
      if (m && !m[1] && m[2]) { start = Math.max(0, blob.size - +m[2]); end = blob.size - 1; } // the last n bytes
      if (!m || start >= blob.size || start > end) return new Response('', { status: 416, headers: { 'Content-Range': 'bytes */' + blob.size } });
      end = Math.min(end, blob.size - 1);
      return new Response(blob.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
        'Content-Type': hit.headers.get('content-type') || blob.type || 'application/octet-stream',
        'Content-Range': 'bytes ' + start + '-' + end + '/' + blob.size, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
    })());
    return;
  }
  const rel = url.pathname.startsWith(SCOPE) ? url.pathname.slice(SCOPE.length) : url.pathname.replace(/^\//, '');
  const nav = req.mode === 'navigate';
  // A deep or odd address (…/index.html/, …/some/path, …/tab/bible): the page's own files would be looked for in
  // the wrong folder, so send it to the start page in the app's folder. (…/stage/ is the stage screen.)
  if (nav && rel.includes('/')) {
    const to = /^stage\/$/.test(rel) ? 'stage.html' : 'index.html';
    event.respondWith(Response.redirect(new URL(to + url.search + url.hash, self.registration.scope).href, 302));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const isPage = nav || /\.html$/.test(url.pathname);
    // The short address for phones (…/stage or …/stage/) is the stage screen page.
    const isStage = /\/stage\/?$/.test(url.pathname) || /\/stage\.html$/.test(url.pathname);
    let hit = await cache.match(req, { ignoreSearch: isPage });
    if (!hit && isPage && rel === '') hit = await cache.match('index.html'); // the folder address people bookmark
    if (!hit && isStage) hit = await cache.match('stage.html', { ignoreSearch: true });
    if (!hit && isPage) hit = await cache.match(req, { ignoreSearch: true });
    if (!hit && /[?&](v|r)=/.test(url.search)) hit = await cache.match(req, { ignoreSearch: true }); // cache-busting retries
    if (hit && htmlInstead(url.pathname, hit)) { event.waitUntil(cache.delete(req).catch(() => {})); hit = null; } // a stored login page
    if (hit) return hit;
    try {
      // Never wait forever (Wi-Fi with no internet): pages give up after 4 s, other files after 8 s.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), isPage ? 4000 : 8000);
      let res;
      try { res = await fetch(req, { signal: ctl.signal }); } finally { clearTimeout(timer); }
      if (!res.ok && isPage) throw new Error('HTTP ' + res.status);
      // Keep a copy of app files that were missing, and of extra data added later (licensed Bibles) — only
      // the real file: checked against the file list, and never a login page in place of data.
      const jsonOK = !/\.json$/.test(url.pathname) || /json/i.test(res.headers.get('content-type') || '');
      if (res.ok && res.type === 'basic' && !res.redirected && jsonOK && /\/(js|css|data|vendor|fonts|icons)\/|\.(html|webmanifest)$/.test(url.pathname) && !htmlInstead(url.pathname, res)) {
        const copy = res.clone();
        event.waitUntil((async () => {
          const man = await getManifest();
          const want = man && man.hashes && man.hashes[rel];
          const ok = await verified(url.pathname, copy, want);
          if (ok) await cache.put(isPage ? new Request(url.pathname) : req, ok);
        })().catch(() => {}));
      }
      return res;
    } catch (e) {
      // No internet: an older stored copy, then the app's start page for any page.
      const old = await storedCopy(isPage && rel === '' ? 'index.html' : rel, CACHE);
      if (old) return old;
      if (isPage) {
        const page = await cache.match(/display\.html/.test(url.pathname) ? 'display.html' : isStage ? 'stage.html' : /\.html$/.test(url.pathname) ? url.pathname.split('/').pop() : 'index.html', { ignoreSearch: true })
          || await cache.match('index.html', { ignoreSearch: true }) || await storedCopy('index.html', CACHE);
        if (page) return page;
      }
      return new Response('Offline and not stored on this device: ' + url.pathname, { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
