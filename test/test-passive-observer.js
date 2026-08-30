import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-observer-'));
const spool = path.join(dir, 'trace.jsonl');
process.env.DC_OBSERVER_ENABLED = 'true';
process.env.DC_OBSERVER_SPOOL = spool;
process.env.DC_OBSERVER_DEVICE_ID = 'DEV-TEST-001';
process.env.DC_OBSERVER_REVISION = 'abc123';
process.env.DC_OBSERVER_FORCE_REMOTE = 'true';

const { recordPassiveObservation, flushPassiveObserver, measuredJsonBytes } = await import('../dist/observability/passive-observer.js');
const secret = 'TOP-SECRET-COMMAND-ARG';
recordPassiveObservation({
  toolName: 'start_process',
  startedAtMs: Date.now() - 5,
  requestBytes: measuredJsonBytes({ command: secret }),
  responseBytes: measuredJsonBytes({ content: secret }),
  isError: false,
  remote: false,
  metadata: { trace_id: 'trace-1', project_ref: 'PRJ-001', unsafe_ref: '/secret/path' },
});
await flushPassiveObserver();
const raw = await fs.readFile(spool, 'utf8');
assert.equal(raw.includes(secret), false, 'observer must not persist request/result content');
const event = JSON.parse(raw.trim());
assert.equal(event.schema_version, 'rdc-raw-trace/v1');
assert.equal(event.device_id, 'DEV-TEST-001');
assert.equal(event.rdc_revision, 'abc123');
assert.equal(event.tool_name, 'start_process');
assert.equal(event.trace_id, 'trace-1');
assert.equal(event.project_ref, 'PRJ-001');
assert.equal(event.outcome, 'SUCCESS');
assert.equal(event.remote, true, 'deployment route may force remote attribution');
assert.equal(typeof event.request_bytes, 'number');
assert.equal(typeof event.response_bytes, 'number');
// Reload under a bad spool so the actual write failure path is exercised.
const blocker = path.join(dir, 'not-a-directory');
await fs.writeFile(blocker, 'x');
process.env.DC_OBSERVER_SPOOL = path.join(blocker, 'trace.jsonl');
const failingObserver = await import('../dist/observability/passive-observer.js?failopen=1');
failingObserver.recordPassiveObservation({
  toolName: 'read_file',
  startedAtMs: Date.now(),
  requestBytes: 1,
  responseBytes: 1,
  isError: true,
  errorClass: 'SyntheticError',
  remote: false,
});
await failingObserver.flushPassiveObserver();
console.log('PASS passive observer privacy, attribution, and fail-open behavior');
