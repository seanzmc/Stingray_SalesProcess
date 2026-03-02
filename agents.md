# agents.md — Google Apps Script (GAS) Best-Practices Contract for Codex

You are writing **Google Apps Script** code. Follow this file as a hard contract.

Primary goals:

1) Reliability in production (time limits, quotas, triggers, concurrency)
2) Performance (minimize calls to Apps Script services)
3) Safety (least privilege scopes, no secret leakage)
4) Maintainability (clear structure, predictable behavior)

Authoritative references:

- Apps Script Best Practices (performance & service calls)  [oai_citation:0‡Google for Developers](https://developers.google.com/apps-script/guides/support/best-practices?utm_source=chatgpt.com)
- Apps Script Quotas & Limits (design within constraints)  [oai_citation:1‡Google for Developers](https://developers.google.com/apps-script/guides/services/quotas?utm_source=chatgpt.com)
- Apps Script Logging (execution log vs Cloud Logging/Error Reporting)  [oai_citation:2‡Google for Developers](https://developers.google.com/apps-script/guides/logging?utm_source=chatgpt.com)
- clasp local development workflow  [oai_citation:3‡Google for Developers](https://developers.google.com/apps-script/guides/clasp?utm_source=chatgpt.com)
- Google JavaScript Style Guide (code style)  [oai_citation:4‡Google GitHub](https://google.github.io/styleguide/jsguide.html?utm_source=chatgpt.com)

---

## 0) Non-negotiables (MUST)

- **Use V8 syntax**. Prefer `const` by default, `let` only when reassignment is necessary. **Do not use `var`.**  [oai_citation:5‡Google GitHub](https://google.github.io/styleguide/jsguide.html?utm_source=chatgpt.com)
- **Batch service calls**:
  - Never loop over `getRange()`, `getValue()`, `setValue()`, `appendRow()`, `UrlFetchApp.fetch()`, etc.
  - Read once (`getValues()`), compute in memory, write once (`setValues()`).
  - Minimizing service calls is a core GAS performance rule.  [oai_citation:6‡Google for Developers](https://developers.google.com/apps-script/guides/support/best-practices?utm_source=chatgpt.com)
- **Design for quotas and time limits**:
  - Assume scripts can fail by quota/timeouts; handle gracefully and resume when possible.  [oai_citation:7‡Google for Developers](https://developers.google.com/apps-script/guides/services/quotas?utm_source=chatgpt.com)
- **No secrets in code or logs**:
  - Do not hardcode API keys/tokens.
  - Never log secrets, auth headers, or full payloads containing PII.
- **Idempotency**:
  - Functions invoked by triggers/webhooks must be safe to re-run without duplicating side effects.

---

## 1) Project layout & file organization

All Google Apps Script source files live under /saleslog_files/.
Do not modify files outside this directory.
Keep files small, single-purpose, and readable. Suggested file split:

- `Main.gs`
  Entrypoints only: menu handlers, trigger handlers, webapp endpoints (`doGet/doPost`), top-level orchestration.
- `Services/*.gs` (or flat file names if not using clasp folders)
  `SheetsService.gs`, `DriveService.gs`, `MailService.gs`, `HttpService.gs`…
- `Domain/*.gs`
  Data models, validation, transformation.
- `Infra/*.gs`
  `Locking.gs`, `Cache.gs`, `Props.gs`, `Retry.gs`, `Logging.gs`.
- `Config.gs`
  Central config, constants, feature flags, environment selectors.

Notes:

- In the Apps Script editor, files are flat. If using clasp, folders map to filename prefixes.  [oai_citation:8‡Google for Developers](https://developers.google.com/apps-script/guides/clasp?utm_source=chatgpt.com)

---

## 2) Style & naming

Follow the Google JS Style Guide for JavaScript formatting and conventions.  [oai_citation:9‡Google GitHub](https://google.github.io/styleguide/jsguide.html?utm_source=chatgpt.com)

### Naming

- Functions: `camelCase` (e.g., `syncOrders()`).
- Classes: `PascalCase` (e.g., `OrderRepository`).
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `MAX_RETRIES`).
- Private/internal helpers: prefix `_` (e.g., `_normalizePhone()`).

### Top-level functions

- Only expose functions that are meant to be called from triggers/menus/web endpoints.
- Everything else should be nested in modules/objects or marked internal.

---

## 3) Service-call discipline (performance rules)

### Spreadsheets

MUST:

- Use `getValues()` / `setValues()` for bulk operations.
- Prefer `RangeList` where appropriate.
- Avoid `SpreadsheetApp.flush()` unless you truly need it.

SHOULD:

- Use `TextFinder` for search operations vs manual scanning when it reduces calls.
- Compute indexes/maps in memory for lookups instead of repeated sheet reads.

### Drive/Gmail/Calendar/UrlFetch

MUST:

- Avoid per-item calls inside loops. Build batches where possible.
- Use caching (`CacheService`) for repeated reads and expensive computations.
- Use exponential backoff for transient failures (esp. UrlFetch).

General best-practice emphasis: **minimize calls to other services**.  [oai_citation:10‡Google for Developers](https://developers.google.com/apps-script/guides/support/best-practices?utm_source=chatgpt.com)

---

## 4) Concurrency & correctness

### Locking

MUST:

- Use `LockService` for any code that mutates shared state (sheets, properties, Drive files).
- Keep lock duration short. Acquire lock → do minimal critical writes → release.

### Idempotency keys

MUST:

- For webhook-like handlers or repeated triggers, store a “processed id” marker in `PropertiesService` or a sheet log.
- Before writing side effects, check if the id is already processed.

---

## 5) Storage rules (Properties / Cache)

### PropertiesService

Use for:

- Small configuration, tokens (if unavoidable), last-run cursors, idempotency markers.

Rules:

- Namespaced keys: `APP:feature:lastCursor`, `APP:lock:state`, etc.
- Never store large blobs if it can be avoided.

### CacheService

Use for:

- Expensive computed data that can be regenerated.
- Rate-limiting repeated fetches.

Rules:

- Include versioning in cache keys: `v1:sheetId:tabName:...`
- Always handle cache misses cleanly.

---

## 6) Error handling & retries

MUST:

- Wrap entrypoints in a `try/catch` that:
  - logs a structured error
  - rethrows when you want the execution to be marked failed (common for triggers)
- Use targeted retries for transient issues (network, rate limit) with exponential backoff.
- Do not blanket-retry non-transient exceptions (validation errors, missing permissions, etc.).

Suggested approach:

- `retry(fn, { retries: 3, baseMs: 250, maxMs: 3000, jitter: true })`
- Identify transient errors by message/HTTP status codes when using UrlFetch.

---

## 7) Logging (dev vs prod)

Use the right logging mechanism:

- Dev: `console.log()` / `Logger.log()` for quick checks.
- Prod/multi-user: use **Cloud Logging** + Error Reporting (via Apps Script’s logging integrations).  [oai_citation:11‡Google for Developers](https://developers.google.com/apps-script/guides/logging?utm_source=chatgpt.com)

MUST:

- Log in structured-ish lines (prefixes or JSON-like objects).
- Include correlation ids where useful: `runId`, `user`, `sheetId`, `jobId`.
- Redact secrets and PII.

---

## 8) Scopes & security

MUST:

- Keep OAuth scopes minimal; don’t request broad scopes “just because”.
- Do not add advanced services unless required.
- For web apps/add-ons: validate inputs rigorously; never trust user-supplied parameters.

---

## 9) Triggers & scheduling

MUST:

- Trigger handlers must be fast and resilient.
- If work is heavy, enqueue via:
  - time-based continuation (store cursor, schedule next chunk)
  - or split into smaller operations (cursor pagination)
- Always store progress checkpoints (cursor/offset) so a timeout can resume.

---

## 10) Testing & local workflow

Preferred workflow:

- Use clasp for local version control, PRs, code review, and repeatable deploys.  [oai_citation:12‡Google for Developers](https://developers.google.com/apps-script/guides/clasp?utm_source=chatgpt.com)

MUST:

- Keep pure logic in “pure functions” that don’t touch Apps Script services, so they can be unit-tested locally.
- Put Apps Script service calls behind thin adapters (e.g., `SheetsGateway`) to mock in tests.

---

## 11) Output requirements when generating code (Codex behavior)

When you generate or modify code, ALWAYS:

1) Identify entrypoints and keep them thin.
2) Move logic into testable helpers/services.
3) Batch all Sheets reads/writes.
4) Add:
   - input validation
   - locking (if shared writes)
   - retries (only for transient ops)
   - structured logging
5) Avoid:
   - `var`
   - service calls inside loops
   - global mutable state
   - hardcoded IDs/secrets

If any of these constraints conflict with an existing codebase pattern, refactor toward these rules.

---

## 12) Reference implementation patterns (snippets)

### Entrypoint wrapper (thin)

```js
function runJob() {
  const runId = Utilities.getUuid();
  try {
    console.info(`[runJob] start runId=${runId}`);
    JobRunner.run({ runId });
    console.info(`[runJob] done runId=${runId}`);
  } catch (err) {
    console.error(`[runJob] failed runId=${runId} msg=${err && err.message}`);
    throw err;
  }
}

Batch sheet read/compute/write

function updateStatuses_(sheet) {
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());
  const values = range.getValues();

  const updated = values.map((row) => {
    // compute in memory
    return row;
  });

  range.setValues(updated);
}

Locking for shared writes

function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30_000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}


⸻

13) Quota-aware mindset

Assume:
 • UrlFetch and other services can hit “service invoked too many times” daily limits.  ￼
 • Long-running jobs can time out.
 • Triggers can overlap.

Therefore, code must:
 • cache
 • batch
 • checkpoint progress
 • lock critical sections
 • degrade gracefully

END.
