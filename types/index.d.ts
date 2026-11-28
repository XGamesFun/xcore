// Types for @xgamesfun/xcore's library entry point (lib/api.mjs). docs/API.md documents each call.

/** A line of a report: what is wrong or worth a look, and how to fix it. */
export interface Finding {
  what: string;
  fix: string;
}

export interface AdoptOptions {
  /** The command that builds the published files (default: the project's build script). */
  build?: string | null;
  /** The folder that is published (default: the build's output, or the folder itself). */
  out?: string | null;
  /** The folder the build copies unchanged (Vite, Next.js, Astro: public). */
  static?: string | null;
  /** Use what is already built; do not run the build. */
  noBuild?: boolean;
  /** Called with each line of the build's output. */
  onLine?: (line: string) => void;
  env?: Record<string, string | undefined>;
}

export interface AdoptReport {
  dir: string;
  /** The folder's type, as detected (plain static files, a build, an engine export…). */
  shape: { kind: string; [key: string]: unknown } | null;
  /** The record written to gamesfun.json → page, or null when the folder is refused. */
  page: Record<string, unknown> | null;
  wrote: boolean;
  built: { ran: boolean; code: number | null; seconds: number; tail: string[] } | null;
  /** It can't be hosted as it is; nothing was written. */
  refused: Finding[];
  /** It would be refused or break once published. */
  fix: Finding[];
  /** Worth a look. */
  warn: Finding[];
  origins: { declared: string[]; found: string[] };
  files: number;
  bytes: number;
  /** True when nothing is refused or left to fix. */
  ok: boolean;
  [key: string]: unknown;
}

export interface CheckOptions {
  /** Check what is already built; do not run the build. */
  noBuild?: boolean;
  /** Where the record and screenshots go (default: <dir>/evidence/verify-N/). */
  out?: string | null;
  /** The port to serve the page on (default: any free port). */
  port?: number;
  /** Called with each line of progress. */
  log?: (line: string) => void;
}

export interface CheckRecord {
  /** True when every check passed. */
  pass: boolean;
  checks: { n: number; name: string; ok: boolean | null; detail: string }[];
  notes: string[];
  /** The folder with the record (record.json) and the screenshots. */
  outDir: string;
  [key: string]: unknown;
}

export interface PublishCheckOptions {
  /** The xgames.fun to check against (default: GAMESFUN_STUDIO, else https://xgames.fun). */
  origin?: string;
}

export interface PublishCheck {
  /** True when nothing would refuse the publish. */
  ok: boolean;
  files: number;
  bytes: number;
  skipped: string[];
  problems: string[];
  /** Why the publish would stop for something that looks like a secret, or null. */
  secrets: string | null;
  /** The other sites the published page may reach (backend.json). */
  backend: string[];
  cardWarnings: string[];
  server: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface PublishStatusOptions {
  origin?: string;
  env?: Record<string, string | undefined>;
}

export interface PublishStatus {
  signedIn: { email?: string; as?: string; [key: string]: unknown } | null;
  signIn: { state: 'signed-in' | 'signed-out' | 'expired' | 'unreadable'; [key: string]: unknown };
  /** never: not published; started: a publish began and no version finished; public, draft or draft-over-public. */
  link: 'never' | 'started' | 'public' | 'draft' | 'draft-over-public';
  known: { projectId: string; slug: string | null; url?: string; gameUrl?: string; [key: string]: unknown } | null;
  live: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface PlanLimits {
  cpuMs: number;
  saves: { valueBytes: number; keysPerPlayer: number; gameBytes: number; writesPerMinute: number };
  scores: { boards: number; rules: number; entriesPerBoard: number; submitsPerMinute: number };
  reads: { perMinute: number };
  files: { bytes: number; fileBytes: number };
  /** the game's database (D1); past it, its server is stopped (every api/ request answers 451) */
  database: { bytes: number };
}

/** `xcore adopt`: write the folder's record (gamesfun.json → page) and list what does not fit the hosting. */
export function adopt(dir: string, options?: AdoptOptions): Promise<AdoptReport>;
/** `xcore check`: the page check in Chrome (Chrome, Edge or Chromium; else Playwright's Chromium), as xgames.fun hosts the game. */
export function check(dir: string, options?: CheckOptions): Promise<CheckRecord>;
/** `xcore publish --check`: the offline part of a publish. Sends nothing. */
export function publishCheck(dir: string, options?: PublishCheckOptions): Promise<PublishCheck>;
/** `xcore publish --status`: the sign-in, and where the folder's game is published. */
export function publishStatus(dir: string, options?: PublishStatusOptions): Promise<PublishStatus>;
/** What a game's server, saves, scores and files may use on each plan (sizes in bytes). */
export const PLAN_LIMITS: Readonly<{ free: PlanLimits; creator: PlanLimits; scale: PlanLimits }>;
