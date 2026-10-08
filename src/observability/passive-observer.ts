import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface PassiveObservation {
  toolName: string;
  startedAtMs: number;
  requestBytes: number | null;
  responseBytes: number | null;
  isError: boolean;
  errorClass?: string | null;
  remote: boolean;
  metadata?: unknown;
}

const enabled = process.env.DC_OBSERVER_ENABLED === 'true';
const spoolPath = process.env.DC_OBSERVER_SPOOL || path.join(process.cwd(), '.dc-observer', 'raw-trace.jsonl');
let writeChain: Promise<void> = Promise.resolve();

function safeRef(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

export function measuredJsonBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return null;
  }
}

function queueLine(line: string): void {
  if (!enabled) return;
  writeChain = writeChain
    .then(async () => {
      await mkdir(path.dirname(spoolPath), { recursive: true });
      await appendFile(spoolPath, line, 'utf8');
    })
    .catch(() => {
      // Observation must never alter or block Desktop Commander behavior.
    });
}

export function recordPassiveObservation(observation: PassiveObservation): void {
  if (!enabled) return;
  try {
    const metadata = observation.metadata && typeof observation.metadata === 'object'
      ? observation.metadata as Record<string, unknown>
      : {};
    const callId = safeRef(metadata.call_id) || randomUUID();
    const event = {
      schema_version: 'rdc-raw-trace/v1',
      event_id: randomUUID(),
      // Until the relay supplies a task/trace identity, one authoritative call
      // is the smallest defensible trace boundary. Never invent cross-call grouping.
      trace_id: safeRef(metadata.trace_id) || callId,
      call_id: callId,
      runner: 'RDC',
      device_id: safeRef(process.env.DC_OBSERVER_DEVICE_ID) || 'UNKNOWN',
      rdc_revision: safeRef(process.env.DC_OBSERVER_REVISION) || 'UNKNOWN',
      observer_version: 'rdc-observer/v1',
      tool_name: observation.toolName,
      started_at: new Date(observation.startedAtMs).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Math.max(0, Date.now() - observation.startedAtMs),
      request_bytes: observation.requestBytes,
      response_bytes: observation.responseBytes,
      outcome: observation.isError ? 'ERROR' : 'SUCCESS',
      error_class: observation.errorClass || null,
      remote: observation.remote || process.env.DC_OBSERVER_FORCE_REMOTE === 'true',
      project_ref: safeRef(metadata.project_ref),
      work_ref: safeRef(metadata.work_ref),
      attempt_ref: safeRef(metadata.attempt_ref),
    };
    queueLine(`${JSON.stringify(event)}\n`);
  } catch {
    // Fail open: analytics cannot affect execution semantics.
  }
}

export async function flushPassiveObserver(): Promise<void> {
  await writeChain;
}
