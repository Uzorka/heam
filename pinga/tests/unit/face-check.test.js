import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signV4, compareFaces, handle, MATCH_AT } from '../../supabase/functions/face-check/handler.js';

test('AWS request signing matches AWS\'s own signer (botocore 1.44.3, same inputs)', async () => {
  const h = await signV4({
    method: 'POST', host: 'rekognition.eu-west-1.amazonaws.com', region: 'eu-west-1', service: 'rekognition',
    body: '{"SourceImage":{"Bytes":"AAEC"},"TargetImage":{"Bytes":"AwQF"},"SimilarityThreshold":0}',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', now: new Date('2026-11-14T19:54:19Z'),
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'RekognitionService.CompareFaces' },
  });
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261114/eu-west-1/rekognition/aws4_request, '
    + 'SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=be8f54e0eccf0fe9d37234e43819f1b7cb97ed41d320c11cb7e37398bd969dc4');
});

test('AWS\'s published example (get-vanilla) signs correctly', async () => {
  const h = await signV4({ method: 'GET', host: 'example.amazonaws.com', region: 'us-east-1', service: 'service',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', now: new Date('2015-08-30T12:36:00Z') });
  assert.match(h.authorization, /Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31$/);
});

const aws = { accessKeyId: 'AKID', secretAccessKey: 'secret', region: 'eu-west-1' };
const awsReply = (status, body) => async () => new Response(JSON.stringify(body), { status });

test('similar faces are a match; different faces a mismatch; no face is reported', async () => {
  const img = new Uint8Array([1, 2, 3]).buffer;
  assert.deepEqual(await compareFaces(img, img, aws, awsReply(200, { FaceMatches: [{ Similarity: 99.71 }] })), { status: 'match', similarity: 99.7 });
  assert.deepEqual(await compareFaces(img, img, aws, awsReply(200, { FaceMatches: [{ Similarity: MATCH_AT - 5 }], UnmatchedFaces: [] })), { status: 'mismatch', similarity: 85 });
  assert.deepEqual(await compareFaces(img, img, aws, awsReply(200, { FaceMatches: [], UnmatchedFaces: [{}] })), { status: 'mismatch', similarity: 0 });
  assert.deepEqual(await compareFaces(img, img, aws, awsReply(400, { __type: 'InvalidParameterException', Message: 'Request has invalid parameters' })), { status: 'no_face', similarity: 0 });
  assert.equal((await compareFaces(img, img, aws, awsReply(403, { __type: 'AccessDeniedException' }))).status, 'error');
});

test('the request goes to Rekognition in EU (Ireland), signed, with both photos', async () => {
  let sent;
  await compareFaces(new Uint8Array([1, 2]).buffer, new Uint8Array([3]).buffer, aws, async (url, init) => { sent = { url, init }; return new Response('{"FaceMatches":[]}'); });
  assert.equal(sent.url, 'https://rekognition.eu-west-1.amazonaws.com/');
  assert.equal(sent.init.headers['x-amz-target'], 'RekognitionService.CompareFaces');
  assert.match(sent.init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/eu-west-1\/rekognition\/aws4_request/);
  assert.deepEqual(JSON.parse(sent.init.body), { SourceImage: { Bytes: 'AQI=' }, TargetImage: { Bytes: 'Aw==' }, SimilarityThreshold: 0 });
});

// A pretend Supabase + AWS for the whole job.
function fake({ keyOk = true, due = [], rekognition = { FaceMatches: [{ Similarity: 98 }] } } = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, body: init.body && !url.includes('amazonaws') ? JSON.parse(init.body) : undefined });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (url.endsWith('/job_key_ok')) return ok(keyOk);
    if (url.endsWith('/face_check_report')) return ok(null);
    if (url.endsWith('/face_checks_due')) return ok(due);
    if (url.endsWith('/face_check_save')) return ok(null);
    if (url.includes('/storage/v1/object/photos/')) return new Response(new Uint8Array([9, 9]));
    if (url.includes('amazonaws.com')) return ok(rekognition);
    throw new Error('unexpected ' + url);
  };
  return { calls, fetchFn };
}
const env = { url: 'https://p.supabase.co', key: 'sb_secret_x' };
const awsEnv = { ...env, awsKeyId: 'AKID', awsSecret: 'secret', awsRegion: 'eu-west-1' };
const req = (key = 'k') => new Request('https://fn', { method: 'POST', headers: { 'x-job-key': key } });

test('switched off without the AWS secrets: nothing is checked or charged, status says off', async () => {
  const f = fake({ due: [{ kind: 'attendance', id: 'a1', photo_path: 'p', reference_path: 'r' }] });
  const res = await handle(req(), env, f.fetchFn);
  assert.match((await res.json()).skipped, /off until AWS_ACCESS_KEY_ID/);
  assert.deepEqual(f.calls.find((c) => c.url.endsWith('/face_check_report')).body, { p_enabled: false });
  assert.ok(!f.calls.some((c) => c.url.includes('amazonaws') || c.url.endsWith('/face_checks_due')));
});

test('switched on: compares each waiting selfie with the reference photo and saves the result', async () => {
  const f = fake({ due: [
    { kind: 'attendance', id: 'a1', photo_path: 'c/m/a1.jpg', reference_path: 'c/m/reference.jpg' },
    { kind: 'visit', id: 'v1', photo_path: 'c/m/v1.jpg', reference_path: null },
  ] });
  const res = await (await handle(req(), awsEnv, f.fetchFn)).json();
  assert.deepEqual(res, { checked: 2, match: 1, mismatch: 0, no_face: 0, no_reference: 1, error: 0 });
  const saves = f.calls.filter((c) => c.url.endsWith('/face_check_save')).map((c) => c.body);
  assert.deepEqual(saves, [
    { p_kind: 'attendance', p_id: 'a1', p_status: 'match', p_similarity: 98 },
    { p_kind: 'visit', p_id: 'v1', p_status: 'no_reference', p_similarity: null },
  ]);
  assert.equal(f.calls.filter((c) => c.url.includes('amazonaws')).length, 1, 'no AWS charge when there is no reference photo');
  assert.ok(f.calls.some((c) => c.url.endsWith('/storage/v1/object/photos/c/m/reference.jpg')));
});

test('refuses callers without the schedule key', async () => {
  const f = fake({ keyOk: false });
  assert.equal((await handle(req('guess'), awsEnv, f.fetchFn)).status, 401);
  assert.equal((await handle(new Request('https://fn', { method: 'POST' }), awsEnv, f.fetchFn)).status, 401);
});
