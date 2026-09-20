-- Developer telemetry, in its own database file rather than alongside the app's
-- real tables in stats.db.
--
-- These tables are written on hot paths, pruned aggressively, and safe to
-- delete at any moment. Keeping them in a separate file means a telemetry bug
-- can never lock, bloat or corrupt match history, and "clear telemetry" is a
-- file deletion rather than a careful cascade of DELETEs.
--
-- Every timestamp here is epoch milliseconds, not the TEXT datetime used in
-- stats.db. Every read is a range scan over time and every write sits on a path
-- being measured, so integer comparison keeps reads index-friendly and writes
-- cheap.

-- One row per ATTEMPT, not per logical request.
--
-- The rate limiter retries by re-running the same closure (see handleJobError
-- in riot/rateLimiter.ts), so a request that 429s twice before succeeding
-- produces three rows sharing one request_id. Grouping by request_id gives the
-- caller's view of what happened; the individual rows give the limiter's.
CREATE TABLE riot_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  -- The span active when this request was scheduled, if any. Nullable because
  -- only sync runs are traced — live-game checks and searches are not.
  span_id TEXT,
  attempt INTEGER NOT NULL,

  -- Path template, e.g. '/lol/match/v5/matches/{matchId}'.
  --
  -- Passed explicitly by each endpoint wrapper rather than derived from the
  -- concrete path, for two reasons: the concrete path embeds PUUIDs and match
  -- IDs that must never be stored, and a regex normaliser rots silently the
  -- first time an endpoint is added without updating it.
  endpoint TEXT NOT NULL,
  -- Truncated SHA-256 of the concrete path. Makes it visible that several rows
  -- hit the same match or player without the identifier itself being
  -- recoverable from a file someone else might read.
  path_hash TEXT NOT NULL,
  host TEXT NOT NULL,

  scheduled_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  -- Time spent waiting before this attempt ran.
  --
  -- On attempt 1 that is pure queue wait (started_at - scheduled_at). On later
  -- attempts it is time since the previous attempt ended, which includes the
  -- limiter's 429/5xx backoff pause. Both are worth knowing, but they are not
  -- the same measurement — don't average across attempts without filtering.
  wait_ms INTEGER NOT NULL,
  network_ms INTEGER NOT NULL,

  status INTEGER,
  -- ok | http_error | parse_error | network_error | key_invalid | never_ran
  --
  -- parse_error is the reason Zod validation moved inside the instrumented
  -- call. It used to run in the endpoint wrapper after the fetch had already
  -- resolved, so a changed Riot payload would have recorded a clean 200 here
  -- and blown up somewhere else entirely.
  --
  -- never_ran covers jobs the limiter rejected without ever running them,
  -- which is what happens to the entire queue when the key expires mid-backfill.
  outcome TEXT NOT NULL,
  bytes INTEGER,
  error_kind TEXT,
  error_message TEXT,

  -- Riot's advertised limits and current counts, verbatim (e.g. '20:1,100:120').
  --
  -- Recorded but never acted upon: the limiter keeps its hardcoded
  -- configuration. These columns exist to show whether that configuration
  -- matches what Riot actually counts, without changing how the app calls Riot.
  app_limit TEXT,
  app_limit_count TEXT,
  method_limit TEXT,
  method_limit_count TEXT,
  retry_after_ms INTEGER
);

-- The panel's default view is "recent requests, newest first".
CREATE INDEX idx_riot_requests_time ON riot_requests(started_at DESC);
-- Filtering to one endpoint, still in time order.
CREATE INDEX idx_riot_requests_endpoint ON riot_requests(endpoint, started_at DESC);
-- Collapsing attempts back into the logical request they belong to.
CREATE INDEX idx_riot_requests_request ON riot_requests(request_id);

-- Raw rows survive 48 hours; these buckets survive 30 days.
--
-- Percentiles stored here cannot be re-aggregated exactly across buckets — a
-- p95 of p95s is not a p95. That imprecision is accepted for a developer tool;
-- the alternative is storing t-digests, which is not worth it here. Read these
-- as "the shape of that minute", not as an exact quantile over a wider range.
CREATE TABLE riot_request_rollup_1m (
  -- Epoch ms truncated to the minute.
  bucket_at INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  requests INTEGER NOT NULL,
  errors_4xx INTEGER NOT NULL DEFAULT 0,
  errors_5xx INTEGER NOT NULL DEFAULT 0,
  -- parse_error, network_error, key_invalid and never_ran together: failures
  -- with no HTTP status to classify them by.
  errors_other INTEGER NOT NULL DEFAULT 0,
  wait_min INTEGER,
  wait_p50 INTEGER,
  wait_p95 INTEGER,
  wait_max INTEGER,
  net_min INTEGER,
  net_p50 INTEGER,
  net_p95 INTEGER,
  net_max INTEGER,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_at, endpoint)
);

CREATE INDEX idx_riot_rollup_time ON riot_request_rollup_1m(bucket_at DESC);

-- One row per Electron process per sample tick, from app.getAppMetrics().
CREATE TABLE resource_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sampled_at INTEGER NOT NULL,
  -- 'Browser' (main), 'Tab' (renderer), 'GPU', 'Utility' — Electron's own
  -- vocabulary, kept verbatim so it matches what the docs and Task Manager say.
  process_type TEXT NOT NULL,
  pid INTEGER NOT NULL,
  cpu_percent REAL,
  working_set_kb INTEGER,

  -- Event-loop delay and limiter queue depth are properties of the main
  -- process, so they are null on every other row rather than living in their
  -- own table. They are captured on the same tick as CPU, and reading them
  -- next to CPU is the entire point — a spike in one explains the other.
  loop_delay_mean_ms REAL,
  loop_delay_p99_ms REAL,
  loop_delay_max_ms REAL,
  queue_depth INTEGER
);

CREATE INDEX idx_resource_samples_time ON resource_samples(sampled_at DESC);

CREATE TABLE resource_rollup_1m (
  bucket_at INTEGER NOT NULL,
  process_type TEXT NOT NULL,
  samples INTEGER NOT NULL,
  cpu_avg REAL,
  cpu_max REAL,
  mem_avg_kb INTEGER,
  mem_max_kb INTEGER,
  loop_delay_max_ms REAL,
  queue_depth_max INTEGER,
  PRIMARY KEY (bucket_at, process_type)
);

CREATE INDEX idx_resource_rollup_time ON resource_rollup_1m(bucket_at DESC);

-- Traced operations. Only sync runs open a root span in v1; there is no
-- waterfall view yet, so these accumulate so that history exists to build
-- against rather than starting from an empty table.
CREATE TABLE spans (
  span_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  -- Rows are inserted once, when the span closes, rather than opened on start
  -- and updated on finish — one write instead of two on a measured path. So
  -- these are populated in practice; they stay nullable only so a future
  -- open-then-update writer would not need a migration.
  ended_at INTEGER,
  duration_ms INTEGER,
  status TEXT,
  error_message TEXT,
  -- Redacted JSON. Never contains identifiers, only counts and outcomes.
  attrs_json TEXT
);

CREATE INDEX idx_spans_trace ON spans(trace_id, started_at);
CREATE INDEX idx_spans_roots ON spans(started_at DESC) WHERE parent_id IS NULL;

-- League client integration.
--
-- The watcher polls loopback every 10s connected / 30s idle, forever, including
-- in tray mode — roughly 8,600 successful polls a day. Storing all of them
-- would swamp every other table with data that says "still fine". So:
-- transitions and errors are always recorded, and successful polls contribute
-- at most one latency sample per minute, which is enough for a sparkline.
CREATE TABLE lcu_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at INTEGER NOT NULL,
  -- connected | disconnected | poll | error
  kind TEXT NOT NULL,
  latency_ms INTEGER,
  detail TEXT
);

CREATE INDEX idx_lcu_events_time ON lcu_events(occurred_at DESC);

-- Bookkeeping for the retention job: last prune, last rollup watermark, and the
-- running count of events dropped when the write buffer overflowed. Dropped
-- events are recorded rather than silently lost, because a panel showing gaps
-- should be able to say the gap is instrumentation and not idleness.
CREATE TABLE telemetry_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
