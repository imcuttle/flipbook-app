// Codebuddy CLI subprocess wrapper.
//
// Two entrypoints:
//   - callOnce({prompt, timeoutMs}): one-shot text/JSON generation.
//     Spawns: codebuddy --print --output-format json
//   - callImageGen({imagePrompt, outputPath, ...}): asks codebuddy to invoke
//     ImageGen tool. Spawns: codebuddy --print --output-format stream-json
//     --input-format stream-json (and we feed stdin a single user-message frame).
//
// Reliability:
//   - Empty stdout is treated as failure (sympathy with prior silent-failure pattern).
//   - For image gen, we ALWAYS verify the output file on disk via fs.stat ≥ 512 bytes.
//   - 1 retry per call. Second failure surfaces a typed error.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { Semaphore } from './generation/queue.js';
import { PlannerError, ImageGenError, TimeoutError } from './lib/errors.js';
import { log } from './lib/log.js';

const sem = new Semaphore(config.maxParallelCodebuddy);

function runCodebuddy({ args, stdin, timeoutMs, onStdoutLine }) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.codebuddyBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      try { child.kill('SIGTERM'); } catch {}
      err ? reject(err) : resolve(val);
    };

    const t = setTimeout(() => finish(new TimeoutError(`codebuddy timed out after ${timeoutMs}ms`)), timeoutMs);

    if (onStdoutLine) {
      let buf = '';
      child.stdout.on('data', (chunk) => {
        const s = chunk.toString('utf8');
        stdout += s;
        buf += s;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.trim()) {
            try { onStdoutLine(line); } catch (e) { log.warn('onStdoutLine err', e?.message); }
          }
        }
      });
    } else {
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    }
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(`codebuddy exited ${code}: ${stderr.slice(0, 500)}`));
    });

    if (stdin !== undefined) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

// Best-effort JSON extraction from a possibly-wrapped stdout.
// codebuddy --print --output-format json emits a JSON ARRAY of session
// messages; the final element with {type:"result", result:"<text>"} carries the
// model's final answer. We extract that string and JSON.parse it again.
function tryParseJson(stdout) {
  if (!stdout || !stdout.trim()) throw new Error('empty stdout');

  // Step 1: parse top-level JSON array if present.
  let answer = null;
  try {
    const top = JSON.parse(stdout);
    if (Array.isArray(top)) {
      const result = [...top].reverse().find((m) => m && m.type === 'result' && typeof m.result === 'string');
      if (result) answer = result.result;
    } else if (top && typeof top === 'object') {
      // Single-object shape (older clients): {result: "..."} or already the JSON itself
      if (typeof top.result === 'string') answer = top.result;
      else return top; // Already-parsed payload
    }
  } catch { /* not array/object — fall through */ }

  // Step 2: if no `answer` extracted, treat full stdout as the answer.
  const text = answer ?? stdout;

  // Step 3: parse the answer text as JSON. Strip code fences and find the
  // first {...} or [...] block as a fallback.
  const stripped = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try { return JSON.parse(stripped); } catch {}

  const firstObj = stripped.indexOf('{');
  const lastObj = stripped.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) {
    try { return JSON.parse(stripped.slice(firstObj, lastObj + 1)); } catch {}
  }
  const firstArr = stripped.indexOf('[');
  const lastArr = stripped.lastIndexOf(']');
  if (firstArr >= 0 && lastArr > firstArr) {
    try { return JSON.parse(stripped.slice(firstArr, lastArr + 1)); } catch {}
  }
  throw new Error('could not parse JSON from codebuddy stdout');
}

export async function callOnce({ prompt, timeoutMs = config.plannerTimeoutMs }) {
  return sem.run(async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const finalPrompt = attempt === 1
          ? prompt
          : `${prompt}\n\n# IMPORTANT\nReturn JSON ONLY. No prose. No backticks. No commentary.`;
        const { stdout } = await runCodebuddy({
          args: ['--print', '--output-format', 'json', '-y'],
          stdin: finalPrompt,
          timeoutMs,
        });
        if (!stdout?.trim()) throw new PlannerError('empty stdout from codebuddy');
        const parsed = tryParseJson(stdout);
        return { raw: stdout, parsed };
      } catch (e) {
        lastErr = e;
        log.warn(`callOnce attempt ${attempt} failed:`, e?.message);
      }
    }
    throw new PlannerError(`planner failed after retries: ${lastErr?.message}`);
  });
}

async function assertWroteFile(filePath, minBytes = 512) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size >= minBytes;
  } catch {
    return false;
  }
}

export async function callImageGen({
  imagePrompt,
  outputDir,
  size = config.imageSize,
  timeoutMs = config.imageTimeoutMs,
  onEvent,
}) {
  // Build a single-turn user message that asks codebuddy to call ImageGen.
  // Note: ImageGen tool only accepts `output_dir`, not `output_path`. The tool
  // picks its own filename. We capture that filename from the tool_result event.
  const userMessage = [
    'Use the ImageGen tool exactly once with the parameters below via DeferExecuteTool.',
    'After the tool returns, reply with a single word "OK" and nothing else.',
    '',
    'Tool name: ImageGen',
    `prompt: ${imagePrompt}`,
    `size: ${size}`,
    `output_dir: ${outputDir}`,
  ].join('\n');

  // Captured by onEvent: the path the tool actually wrote.
  let capturedPath = null;

  return sem.run(async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        capturedPath = null;
        const frame = JSON.stringify({
          type: 'user',
          message: { role: 'user', content: userMessage },
        }) + '\n';
        await runCodebuddy({
          args: [
            '--print',
            '--output-format', 'stream-json',
            '--input-format', 'stream-json',
            '-y',
          ],
          stdin: frame,
          timeoutMs,
          onStdoutLine: (line) => {
            let evt;
            try { evt = JSON.parse(line); } catch { return; }
            if (onEvent) { try { onEvent(evt); } catch {} }
            // Look for tool_result with image_gen_tool_result payload
            if (evt?.type === 'user' && Array.isArray(evt?.message?.content)) {
              for (const c of evt.message.content) {
                if (c?.type !== 'tool_result') continue;
                // First try the structured rawResponse on _meta
                const raw = c?._meta?.rawResponse;
                if (raw?.type === 'image_gen_tool_result' && Array.isArray(raw.images)) {
                  const local = raw.images.find((i) => i?.localPath)?.localPath;
                  if (local) { capturedPath = local; return; }
                }
                // Fallback: tool_result.content[].text is a JSON string we can parse
                const items = Array.isArray(c.content) ? c.content : [];
                for (const item of items) {
                  if (item?.type !== 'text' || typeof item.text !== 'string') continue;
                  try {
                    const j = JSON.parse(item.text);
                    if (j?.type === 'image_gen_tool_result' && Array.isArray(j.images)) {
                      const local = j.images.find((i) => i?.localPath)?.localPath;
                      if (local) { capturedPath = local; return; }
                    }
                  } catch { /* ignore */ }
                }
              }
            }
          },
        });
        if (capturedPath && await assertWroteFile(capturedPath)) {
          return { ok: true, path: capturedPath };
        }
        throw new ImageGenError(capturedPath
          ? `image written to ${capturedPath} but file is missing or too small`
          : 'tool did not return localPath');
      } catch (e) {
        lastErr = e;
        log.warn(`callImageGen attempt ${attempt} failed:`, e?.message);
      }
    }
    return { ok: false, reason: lastErr?.message ?? 'image generation failed' };
  });
}

/**
 * Drive codebuddy to invoke the WebSearch tool one or more times.
 * Returns the captured search results as `[{title, url, snippet, source}]`.
 *
 * The agent's natural-language reply is ignored — we only care about the
 * `tool_result` payloads from each WebSearch call.
 */
export async function callWebSearch({
  queries,
  perQueryMax = 5,
  timeoutMs = 120_000,
  onEvent,
}) {
  if (!Array.isArray(queries) || queries.length === 0) return [];
  const userMessage = [
    'Use the WebSearch tool to gather concise factual references for the queries below.',
    'For each query, call WebSearch once with that query string. Do not summarize the results in prose.',
    'After all WebSearch calls return, reply with the single word "OK".',
    '',
    'Queries:',
    ...queries.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n');

  const captured = [];
  // Debug: capture every stream-json event for inspection.
  const dbgEvents = [];
  const dbgRawEvents = [];

  return sem.run(async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        captured.length = 0;
        dbgEvents.length = 0;
        const frame = JSON.stringify({
          type: 'user',
          message: { role: 'user', content: userMessage },
        }) + '\n';
        await runCodebuddy({
          args: [
            '--print',
            '--output-format', 'stream-json',
            '--input-format', 'stream-json',
            '-y',
          ],
          stdin: frame,
          timeoutMs,
          onStdoutLine: (line) => {
            let evt;
            try { evt = JSON.parse(line); } catch { return; }
            if (onEvent) { try { onEvent(evt); } catch {} }
            // Record full event for raw inspection (capped to keep memory sane).
            if (dbgRawEvents.length < 50) dbgRawEvents.push(evt);
            // Record a compact summary of each event for debugging.
            try {
              dbgEvents.push({
                type: evt?.type,
                role: evt?.message?.role,
                contentTypes: Array.isArray(evt?.message?.content)
                  ? evt.message.content.map((c) => c?.type).slice(0, 10)
                  : null,
                toolName: evt?.message?.content?.find?.((c) => c?.type === 'tool_use')?.name,
                hasToolResult: !!evt?.message?.content?.find?.((c) => c?.type === 'tool_result'),
              });
            } catch {}
            if (evt?.type !== 'user' || !Array.isArray(evt?.message?.content)) return;
            for (const c of evt.message.content) {
              if (c?.type !== 'tool_result') continue;
              const raw = c?._meta?.rawResponse;
              if (raw && Array.isArray(raw.results)) {
                pushSearchResults(captured, raw.results);
                continue;
              }
              const items = Array.isArray(c.content) ? c.content : [];
              for (const item of items) {
                if (item?.type !== 'text' || typeof item.text !== 'string') continue;
                try {
                  const j = JSON.parse(item.text);
                  const arr = Array.isArray(j?.results) ? j.results : Array.isArray(j) ? j : [];
                  pushSearchResults(captured, arr);
                } catch { /* not JSON; ignore */ }
              }
            }
          },
        });
        const seen = new Set();
        const out = [];
        for (const r of captured) {
          if (!r.url || seen.has(r.url)) continue;
          seen.add(r.url);
          out.push(r);
          if (out.length >= perQueryMax * queries.length) break;
        }
        // If we got nothing back, dump the event summary to disk for inspection.
        if (out.length === 0) {
          try {
            await fs.writeFile(
              `/tmp/flipbook-websearch-debug-${Date.now()}.json`,
              JSON.stringify({ queries, dbgEvents, dbgRawEvents, capturedRaw: captured }, null, 2),
            );
          } catch {}
        }
        return out;
      } catch (e) {
        lastErr = e;
        log.warn(`callWebSearch attempt ${attempt} failed:`, e?.message);
      }
    }
    log.warn('callWebSearch giving up:', lastErr?.message);
    return [];
  });
}

function pushSearchResults(out, arr) {
  for (const r of arr) {
    if (!r) continue;
    out.push({
      title: String(r.title ?? '').slice(0, 200),
      url: String(r.url ?? r.link ?? '').slice(0, 800),
      snippet: String(r.snippet ?? r.content ?? r.description ?? '').slice(0, 400),
      source: String(r.source ?? r.host ?? hostnameOf(r.url ?? r.link ?? '')).slice(0, 80),
    });
  }
}

function hostnameOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}
