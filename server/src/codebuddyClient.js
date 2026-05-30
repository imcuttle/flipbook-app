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
import { PlannerError, PlannerRefusalError, ImageGenError, TimeoutError } from './lib/errors.js';
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
      const result = [...top].reverse().find((m) => m && m.type === 'result');
      if (result) {
        // Newer clients sometimes return result already as an object.
        if (result.result && typeof result.result === 'object') return result.result;
        if (typeof result.result === 'string') answer = result.result;
      }
    } else if (top && typeof top === 'object') {
      // Single-object shape (older clients): {result: "..."} or already the JSON itself
      if (typeof top.result === 'string') answer = top.result;
      else if (top.result && typeof top.result === 'object') return top.result;
      else return top; // Already-parsed payload
    }
  } catch { /* not array/object — fall through */ }

  // Step 1b: if the top-level parse failed (e.g. stdout was truncated mid-
  // stream because the child process was killed), salvage the model's reply
  // by regex-extracting the last `"result":"<...>"` pair. Stdout is line-
  // oriented JSON, so the regex looks for the final result entry's value
  // and unescapes it as a JSON string literal.
  if (answer === null) {
    const m = stdout.match(/"type"\s*:\s*"result"\s*,[^]*?"result"\s*:\s*("(?:[^"\\]|\\.)*"|\{[\s\S]*\})/);
    if (m) {
      const candidate = m[1];
      try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed === 'string') answer = parsed;
        else if (parsed && typeof parsed === 'object') return parsed;
      } catch { /* fall through */ }
    }
  }

  // Step 2: scan within the model's `answer` first (preferred), falling
  // back to the raw stdout only if there's no answer (which means the
  // top-level parse failed, e.g. truncated output). We DO NOT mix the two
  // because the stdout's first parseable JSON is the message-array itself,
  // which would shadow the planner output buried in result.result.
  if (answer !== null) {
    const fromAnswer = parseAnswerString(answer);
    if (fromAnswer !== undefined) return fromAnswer;
    // No JSON anywhere in the model's reply. The most common cause is a
    // content-policy refusal: the model wrote prose explaining why it
    // can't help (e.g. "I cannot process this request because..."). Detect
    // that case and surface the prose as a typed RefusalError so the
    // pipeline broadcasts a friendly toast instead of swallowing it as a
    // generic parse error → wasted retry → opaque stack trace.
    const trimmed = answer.trim();
    const looksLikeProse = /^[A-Za-z\u3400-\u9FFF]/.test(trimmed) && trimmed.length >= 20;
    if (looksLikeProse) {
      throw new PlannerRefusalError(trimmed.slice(0, 1200));
    }
    throw new Error('could not parse JSON from codebuddy result text');
  }

  // No `answer` — try a brace-scan across the raw stdout. This branch only
  // helps when stdout itself is malformed JSON wrapping a coherent {...}
  // block (rare, but cheap fallback).
  const fromRaw = parseAnswerString(stdout);
  if (fromRaw !== undefined) return fromRaw;
  throw new Error('could not parse JSON from codebuddy stdout');
}

// Try every reasonable shape for an LLM answer string:
//   - bare JSON
//   - JSON wrapped in ```json fences
//   - JSON wrapped in <json_output>/<output> tags
//   - JSON-encoded JSON (string whose value is itself JSON)
//   - JSON object/array embedded in surrounding prose
// Returns `undefined` when nothing parseable is found, so caller can throw
// a specific error for the higher-level branch.
function parseAnswerString(text) {
  if (typeof text !== 'string') return undefined;
  let stripped = text.trim();
  if (!stripped) return undefined;

  // Strip ```json ... ``` (anchored OR loose: surrounding prose is fine).
  const fenced = stripped.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) stripped = fenced[1].trim();
  // Strip <json_output> / <output> wrapping tags some models emit.
  const tagged = stripped.match(/<(?:json_output|json|output)>([\s\S]*?)<\/(?:json_output|json|output)>/i);
  if (tagged) stripped = tagged[1].trim();

  // Direct parse.
  let direct;
  try { direct = JSON.parse(stripped); } catch { /* fall through */ }
  if (direct !== undefined) {
    // If the parse yielded a string (i.e. JSON-encoded JSON), recurse once.
    if (typeof direct === 'string') {
      const inner = parseAnswerString(direct);
      if (inner !== undefined) return inner;
    }
    return direct;
  }

  // Balanced-brace / bracket scan: return the first complete {…} or […]
  // that parses, scanning the whole string. Tolerates prose, comments,
  // stray braces in string values.
  return extractFirstJson(stripped);
}

// Walk `s` and return the first balanced JSON value (object or array) that
// JSON.parses cleanly. Returns `undefined` if none found.
function extractFirstJson(s) {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '{' && ch !== '[') continue;
    const end = findMatchingClose(s, i);
    if (end < 0) continue;
    const slice = s.slice(i, end + 1);
    try { return JSON.parse(slice); } catch { /* keep scanning */ }
  }
  return undefined;
}

// Given an opening `{` or `[` at index `start`, return the index of its
// matching close, accounting for string literals (with escapes). Returns -1
// if unbalanced.
function findMatchingClose(s, start) {
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export async function callOnce({ prompt, timeoutMs = config.plannerTimeoutMs }) {
  return sem.run(async () => {
    let lastErr;
    let lastStdout = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const finalPrompt = attempt === 1
          ? prompt
          : `${prompt}\n\n# IMPORTANT\nReturn JSON ONLY. No prose. No backticks. No commentary. Start your response with { and end with }.`;
        const { stdout } = await runCodebuddy({
          args: ['--print', '--output-format', 'json', '-y'],
          stdin: finalPrompt,
          timeoutMs,
        });
        lastStdout = stdout ?? '';
        if (!stdout?.trim()) throw new PlannerError('empty stdout from codebuddy');
        const parsed = tryParseJson(stdout);
        return { raw: stdout, parsed };
      } catch (e) {
        lastErr = e;
        log.warn(`callOnce attempt ${attempt} failed:`, e?.message);
        // A content-policy refusal won't change on retry — same prompt,
        // same model, same answer. Bail out immediately so we don't waste
        // 30+s on a doomed second attempt.
        if (e instanceof PlannerRefusalError) break;
      }
    }
    // Refusal: surface the prose directly without dumping a debug file
    // (the failure isn't actionable from a developer's perspective —
    // the model just said no).
    if (lastErr instanceof PlannerRefusalError) {
      throw lastErr;
    }
    // Dump a diagnostic file so the failure mode is recoverable from disk.
    try {
      const dumpPath = `/tmp/flipbook-planner-fail-${Date.now()}.log`;
      await fs.writeFile(
        dumpPath,
        [
          `# planner failure: ${lastErr?.message ?? 'unknown'}`,
          '',
          '## prompt (truncated to 4k):',
          (prompt ?? '').slice(0, 4000),
          '',
          // Bumped to 64k so we capture the full codebuddy stdout for any
          // realistic failure (typical successful outputs are ~30k).
          '## last stdout (truncated to 64k):',
          lastStdout.slice(0, 64_000),
        ].join('\n'),
      );
      log.warn(`callOnce dumped failure to ${dumpPath}`);
    } catch {}
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
  seedImagePath = null,
  timeoutMs = config.imageTimeoutMs,
  onEvent,
}) {
  // Build a single-turn user message that asks codebuddy to call either
  // ImageEdit (when a seed image is attached, so the source's composition
  // and subject carry over) or ImageGen (text-to-image, no seed).
  // Both tools accept output_dir + return their actual filename via
  // tool_result; we capture it from the SSE event.
  const userMessage = seedImagePath
    ? [
        'Use the ImageEdit tool exactly once with the parameters below via DeferExecuteTool.',
        'After the tool returns, reply with a single word "OK" and nothing else.',
        '',
        'Tool name: ImageEdit',
        `prompt: ${imagePrompt}`,
        `image: ${seedImagePath}`,
        `size: ${size}`,
        `output_dir: ${outputDir}`,
      ].join('\n')
    : [
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
            // Look for tool_result with image-tool result payload (both
            // ImageGen and ImageEdit emit a similar shape — `type` differs
            // but `images[].localPath` is consistent).
            if (evt?.type === 'user' && Array.isArray(evt?.message?.content)) {
              for (const c of evt.message.content) {
                if (c?.type !== 'tool_result') continue;
                // First try the structured rawResponse on _meta
                const raw = c?._meta?.rawResponse;
                if (raw && /image_(gen|edit)_tool_result/.test(String(raw.type)) && Array.isArray(raw.images)) {
                  const local = raw.images.find((i) => i?.localPath)?.localPath;
                  if (local) { capturedPath = local; return; }
                }
                // Fallback: tool_result.content[].text is a JSON string we can parse
                const items = Array.isArray(c.content) ? c.content : [];
                for (const item of items) {
                  if (item?.type !== 'text' || typeof item.text !== 'string') continue;
                  try {
                    const j = JSON.parse(item.text);
                    if (j && /image_(gen|edit)_tool_result/.test(String(j.type)) && Array.isArray(j.images)) {
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
  // Kept only when nothing parsed — surfaced as a fallback debug dump so we can
  // diagnose future tool_result format changes without re-instrumenting code.
  const failureSamples = [];

  return sem.run(async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        captured.length = 0;
        failureSamples.length = 0;
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
            if (evt?.type !== 'user' || !Array.isArray(evt?.message?.content)) return;
            for (const c of evt.message.content) {
              if (c?.type !== 'tool_result') continue;
              const before = captured.length;
              const raw = c?._meta?.rawResponse;
              if (raw && Array.isArray(raw.results)) {
                pushSearchResults(captured, raw.results);
              } else {
                const items = Array.isArray(c.content) ? c.content : [];
                for (const item of items) {
                  if (item?.type !== 'text' || typeof item.text !== 'string') continue;
                  // 1) JSON-shaped (older clients)
                  let parsedJson = null;
                  try {
                    const j = JSON.parse(item.text);
                    const arr = Array.isArray(j?.results) ? j.results : Array.isArray(j) ? j : [];
                    if (arr.length) { pushSearchResults(captured, arr); parsedJson = true; }
                  } catch { /* not JSON; fall through to markdown */ }
                  if (parsedJson) continue;
                  // 2) Markdown-shaped (current codebuddy CLI WebSearch output)
                  const mdResults = parseSearchMarkdown(item.text);
                  if (mdResults.length) pushSearchResults(captured, mdResults);
                }
              }
              // If this tool_result yielded nothing, hold a small sample for
              // later dump in case all queries come up empty.
              if (captured.length === before && failureSamples.length < 3) {
                const items = Array.isArray(c.content) ? c.content : [];
                const text = items.find((i) => i?.type === 'text')?.text;
                failureSamples.push({
                  preview: typeof text === 'string' ? text.slice(0, 600) : null,
                  hasMeta: !!c?._meta,
                });
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
        // No results parsed from any tool_result: dump a small diagnostic file.
        if (out.length === 0 && failureSamples.length) {
          try {
            await fs.writeFile(
              `/tmp/flipbook-websearch-empty-${Date.now()}.json`,
              JSON.stringify({ queries, failureSamples }, null, 2),
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

/**
 * Parse the markdown form codebuddy's WebSearch tool returns.
 * Each result block looks like:
 *
 *   ## 1. [Title](https://url...)
 *
 *   snippet text...
 *
 *   **URL:** https://url...
 *
 *   ---
 *
 * Returns [{title, url, snippet}].
 */
function parseSearchMarkdown(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  // Split on result headings: "## <num>. " — we use a lookahead so the heading
  // stays attached to its block.
  const blocks = text.split(/\n(?=##\s+\d+\.\s+)/g);
  for (const block of blocks) {
    const headRe = /^##\s+\d+\.\s+\[([^\]]+)\]\(([^)]+)\)/m;
    const head = block.match(headRe);
    if (!head) continue;
    const title = head[1].trim();
    const url = head[2].trim();
    // Snippet: everything after the heading up to the **URL:** marker (or block end).
    const afterHead = block.slice(head.index + head[0].length);
    const stop = afterHead.search(/\n\s*\*\*URL:\*\*/);
    const snippetSrc = stop >= 0 ? afterHead.slice(0, stop) : afterHead;
    const snippet = snippetSrc.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ title, url, snippet });
  }
  return out;
}

function hostnameOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}
