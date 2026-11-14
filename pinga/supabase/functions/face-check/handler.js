// Face check: compares each new selfie with the person's reference photo using
// AWS Rekognition CompareFaces (EU Ireland). Runs every few minutes from the Supabase schedule.
// Switched OFF until AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION are saved as secrets:
// then it does nothing and selfies simply wait. Clock-ins and visits never depend on it.
// Plain JS with no imports: runs on Supabase (Deno) and in our Node tests.

export const MATCH_AT = 90;      // default similarity (0–100) to count as the same person; each company can set its own
const BATCH = 20;                // selfies per run (each run is a few seconds)

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const keyHeaders = (key) => (key.startsWith('sb_') ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` });

// ── AWS Signature Version 4 (how AWS checks a request really comes from the key holder) ──
const te = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? te.encode(data) : data));
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? te.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, te.encode(msg));
}

// Returns the headers to send, including Authorization. `now` is a Date (passed in for tests).
export async function signV4({ method, host, path = '/', query = '', headers = {}, body = '', region, service, accessKeyId, secretAccessKey, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host, 'x-amz-date': amzDate };
  const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const signedHeaders = names.join(';');
  const canonical = [method, path, query, names.map((n) => `${n}:${lower[n]}\n`).join(''), signedHeaders, await sha256(body)].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');
  let k = await hmac('AWS4' + secretAccessKey, day);
  k = await hmac(k, region);
  k = await hmac(k, service);
  k = await hmac(k, 'aws4_request');
  const signature = hex(await hmac(k, toSign));
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// One comparison. Returns { status: 'match' | 'mismatch' | 'no_face' | 'error', similarity }.
export async function compareFaces(reference, selfie, aws, fetchFn = fetch, matchAt = MATCH_AT) {
  const host = `rekognition.${aws.region}.amazonaws.com`;
  const body = JSON.stringify({ SourceImage: { Bytes: b64(reference) }, TargetImage: { Bytes: b64(selfie) }, SimilarityThreshold: 0 });
  const headers = await signV4({
    method: 'POST', host, body, region: aws.region, service: 'rekognition',
    accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey,
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'RekognitionService.CompareFaces' },
  });
  delete headers.host;
  const r = await fetchFn(`https://${host}/`, { method: 'POST', headers, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // AWS says this when either photo has no face it can find.
    if ((data.__type || '').includes('InvalidParameterException')) return { status: 'no_face', similarity: 0 };
    return { status: 'error', similarity: null, detail: `${r.status} ${data.__type || ''} ${data.message || data.Message || ''}`.trim() };
  }
  const best = Math.max(0, ...(data.FaceMatches || []).map((m) => m.Similarity || 0));
  return { status: best >= matchAt ? 'match' : 'mismatch', similarity: Math.round(best * 10) / 10 };
}

export async function handle(req, env, fetchFn = fetch) {
  const h = { ...keyHeaders(env.key), 'content-type': 'application/json' };
  const rpc = async (fn, args = {}) => {
    const r = await fetchFn(`${env.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(args) });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${fn}: ${r.status} ${JSON.stringify(data)}`);
    return data;
  };

  const key = req.headers.get('x-job-key') || '';
  if (!key || !(await rpc('job_key_ok', { p_key: key }))) return json(401, { error: 'Not allowed' });

  const aws = { accessKeyId: env.awsKeyId, secretAccessKey: env.awsSecret, region: env.awsRegion };
  const enabled = !!(aws.accessKeyId && aws.secretAccessKey && aws.region);
  await rpc('face_check_report', { p_enabled: enabled });
  if (!enabled) return json(200, { skipped: 'Face check is off until AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION are set.' });

  const photo = async (path) => {
    const r = await fetchFn(`${env.url}/storage/v1/object/photos/${path}`, { headers: keyHeaders(env.key) });
    if (!r.ok) throw new Error(`photo ${r.status}`);
    return r.arrayBuffer();
  };

  const due = await rpc('face_checks_due', { p_limit: BATCH });
  const result = { checked: 0, match: 0, mismatch: 0, no_face: 0, no_reference: 0, error: 0 };
  for (const item of due) {
    let outcome;
    try {
      if (!item.reference_path) outcome = { status: 'no_reference', similarity: null };
      else outcome = await compareFaces(await photo(item.reference_path), await photo(item.photo_path), aws, fetchFn, item.match_percent || MATCH_AT);
    } catch (e) {
      outcome = { status: 'error', similarity: null, detail: String(e.message || e) };
    }
    if (outcome.status === 'error') console.error('face check error', item.kind, item.id, outcome.detail);
    await rpc('face_check_save', { p_kind: item.kind, p_id: item.id, p_status: outcome.status, p_similarity: outcome.similarity });
    result.checked++;
    result[outcome.status]++;
  }
  return json(200, result);
}
