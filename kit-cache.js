'use strict';
// Downloads each media kit once and shares it.
//
// One click of "Fetch From Media Kit" asks three routes about the same PDF (power play / penalty kill, goalie
// records, and coaches / records / schedules). Each used to download its own copy, so the league's server saw three
// requests for the same file within a few seconds. Now the first request downloads it and the others reuse that
// copy for a few minutes, including requests that arrive while it is still downloading.

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const KEEP_MS = 5 * 60 * 1000;     // long enough to cover one click and a retry, short enough to pick up a re-published kit
const MAX_KITS = 6;
const kits = new Map();            // url -> { at, promise }

function downloadFailure(message) { const e = new Error(message); e.status = 502; return e; }

async function fetchKit(url) {
  let res;
  try { res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } }); }
  catch (e) { throw downloadFailure('Could not download the PDF: ' + e.message); }
  if (!res.ok) throw downloadFailure('Could not download the PDF (status ' + res.status + ').');
  return Buffer.from(await res.arrayBuffer());
}

// Resolves to a fresh Buffer for every caller (so one reader can never disturb another's copy). Rejects with an
// Error whose .status is the HTTP status to send back and whose .message is safe to show.
async function downloadKit(url) {
  const now = Date.now();
  for (const [key, entry] of kits) if (now - entry.at > KEEP_MS) kits.delete(key);
  let entry = kits.get(url);
  if (!entry) {
    entry = { at: now, promise: fetchKit(url) };
    kits.set(url, entry);
    entry.promise.catch(() => { if (kits.get(url) === entry) kits.delete(url); });   // a failed download is never remembered
    while (kits.size > MAX_KITS) kits.delete(kits.keys().next().value);
  }
  return Buffer.from(await entry.promise);
}

module.exports = { downloadKit };
