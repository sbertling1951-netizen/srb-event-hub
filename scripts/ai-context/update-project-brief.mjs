#!/usr/bin/env node
// EpicentraX Librarian Engine (v1)
// Updates the generated status section of docs/ai-context/EPICENTRAX_PROJECT_BRIEF.md
// from verifiable local repository evidence only. See AGENTS.md / AUTHORITATIVE_SOURCES.md.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const PROJECT_BRIEF_PATH = path.join(REPO_ROOT, 'docs', 'ai-context', 'EPICENTRAX_PROJECT_BRIEF.md');
const ARCHITECTURE_DIR = path.join(REPO_ROOT, 'docs', 'architecture');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const IDENTITY_AUDITS_DIR = path.join(REPO_ROOT, 'supabase', 'identity-audits');

const START_MARKER = '<!-- EPICENTRAX_LIBRARIAN_START -->';
const END_MARKER = '<!-- EPICENTRAX_LIBRARIAN_END -->';

function fail(message) {
  console.error(`update-project-brief: ${message}`);
  process.exit(1);
}

function requireExists(targetPath, description) {
  if (!existsSync(targetPath)) {
    fail(`${description} not found at ${targetPath}`);
  }
}

function runGit(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

// Best-effort git: returns trimmed stdout, or null if the command fails
// (e.g. a ref that does not exist in this clone). Never throws.
function tryGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function getRepoStatus() {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const commitHash = runGit(['rev-parse', 'HEAD']).trim();
  const commitSubject = runGit(['log', '-1', '--format=%s']).trim();
  const commitDate = runGit(['log', '-1', '--format=%aI']).trim();

  // origin/main position and this HEAD's divergence from it. Best-effort:
  // a clone with no origin/main ref leaves these null rather than failing.
  let originMainHash = null;
  let aheadOfOriginMain = null;
  let behindOriginMain = null;
  originMainHash = tryGit(['rev-parse', 'origin/main']);
  if (originMainHash) {
    const divergence = tryGit(['rev-list', '--left-right', '--count', 'origin/main...HEAD']);
    if (divergence) {
      const [behind, ahead] = divergence.split(/\s+/).map((n) => Number.parseInt(n, 10));
      behindOriginMain = Number.isFinite(behind) ? behind : null;
      aheadOfOriginMain = Number.isFinite(ahead) ? ahead : null;
    }
  }

  // -z gives NUL-separated, unquoted paths (safe for spaces); rename/copy
  // records carry an extra old-path field with no leading status code.
  // --untracked-files=all expands untracked directories into individual
  // file entries so the untracked count is a file count, not a dir count.
  const porcelain = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const tokens = porcelain.split('\0').filter((token) => token.length > 0);

  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicted = 0;

  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    const x = entry[0];
    const y = entry[1];

    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i++; // skip the paired old-path field for renamed/copied entries
    }

    if (x === '?' && y === '?') {
      untracked++;
      continue;
    }

    const isConflicted =
      x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');

    if (isConflicted) {
      conflicted++;
      continue;
    }

    if (x !== ' ') staged++;
    if (y !== ' ') modified++;
  }

  const isClean = staged === 0 && modified === 0 && untracked === 0 && conflicted === 0;

  return {
    branch,
    commitHash,
    commitSubject,
    commitDate,
    originMainHash,
    aheadOfOriginMain,
    behindOriginMain,
    staged,
    modified,
    untracked,
    conflicted,
    isClean,
  };
}

function listArchitectureFiles() {
  requireExists(ARCHITECTURE_DIR, 'Architecture directory');
  return readdirSync(ARCHITECTURE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function listMigrationFiles() {
  requireExists(MIGRATIONS_DIR, 'Migrations directory');
  const files = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return {
    total: files.length,
    latest: files.length > 0 ? files[files.length - 1] : null,
    latestFive: files.slice(-5),
  };
}

function walkFiles(dir, baseDir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, fullPath).split(path.sep).join('/'));
    }
  }
  return results;
}

function listIdentityAuditFiles() {
  requireExists(IDENTITY_AUDITS_DIR, 'Identity-audits directory');
  const relativePaths = walkFiles(IDENTITY_AUDITS_DIR, IDENTITY_AUDITS_DIR);
  const sqlFiles = relativePaths.filter((p) => p.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
  const mdFiles = relativePaths.filter((p) => p.endsWith('.md')).sort((a, b) => a.localeCompare(b));
  const combined = [...sqlFiles, ...mdFiles].sort((a, b) => a.localeCompare(b));

  return {
    sqlCount: sqlFiles.length,
    mdCount: mdFiles.length,
    latestFive: combined.slice(-5),
  };
}

// Finds the "## ... milestone" section outside the librarian markers and
// extracts the value of a maintained "Target:" line, e.g.
//   Target: **September 1, 2026**  ->  "September 1, 2026"
// Returns null (never a guess) if no such line is present.
function findMilestone(textOutsideMarkers) {
  const lines = textOutsideMarkers.split('\n');
  let capturing = false;
  const block = [];

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (capturing) break;
      if (/milestone/i.test(line)) {
        capturing = true;
      }
      continue;
    }
    if (capturing) block.push(line);
  }

  for (const line of block) {
    const match = line.match(/^\s*(?:[-*]\s*)?target:\s*(.+?)\s*$/i);
    if (match) {
      const value = match[1].replace(/\*\*/g, '').trim();
      if (value.length > 0) return value;
    }
  }

  return null;
}

function localIsoTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  );
}

function buildSection({ generatedAt, status, archFiles, migrations, identityAudits, milestone }) {
  const lines = [];
  lines.push(START_MARKER);
  lines.push('## Librarian-generated repository status');
  lines.push(
    '> Derived local context generated from repository evidence. This section is not an authoritative source and must not override the Constitution, ADRs, migrations, database evidence, or verified runtime behavior.'
  );
  lines.push('');
  lines.push(`**Generated at:** \`${generatedAt}\``);
  lines.push(`**Branch:** \`${status.branch}\``);
  lines.push(`**Commit:** \`${status.commitHash.slice(0, 7)} ${status.commitSubject}\``);
  lines.push(`**Commit date:** \`${status.commitDate}\``);
  lines.push(
    `**origin/main:** \`${status.originMainHash ? status.originMainHash.slice(0, 7) : 'unknown'}\``
  );
  lines.push(
    `**HEAD vs origin/main:** ${
      status.originMainHash === null
        ? 'unknown (no origin/main ref in this clone)'
        : status.aheadOfOriginMain === null || status.behindOriginMain === null
          ? 'unknown'
          : `${status.aheadOfOriginMain} ahead, ${status.behindOriginMain} behind`
    }`
  );
  lines.push(`**Working tree (pre-update snapshot):** ${status.isClean ? 'Clean' : 'Pending changes'}`);
  lines.push(`**Tracked modified:** \`${status.modified}\``);
  lines.push(`**Staged:** \`${status.staged}\``);
  lines.push(`**Untracked:** \`${status.untracked}\``);
  if (status.conflicted > 0) {
    lines.push(`**Conflicted:** \`${status.conflicted}\``);
  }
  lines.push(
    '_Git status above was captured before this script wrote this section; writing this file changes the working tree afterward._'
  );
  lines.push('');
  lines.push('### Architecture records');
  for (const file of archFiles) lines.push(`- \`${file}\``);
  lines.push('');
  lines.push('### Migration inventory');
  lines.push(`- Total migration files: \`${migrations.total}\``);
  lines.push(`- Latest migration: \`${migrations.latest ?? 'None found'}\``);
  lines.push('- Latest five:');
  for (const file of migrations.latestFive) lines.push(`  - \`${file}\``);
  lines.push('');
  lines.push('### Identity-audit inventory');
  lines.push(`- SQL files: \`${identityAudits.sqlCount}\``);
  lines.push(`- Markdown files: \`${identityAudits.mdCount}\``);
  lines.push('- Latest five:');
  for (const file of identityAudits.latestFive) lines.push(`  - \`${file}\``);
  lines.push('');
  lines.push('### Current milestone');
  lines.push(`- \`${milestone ?? 'Not automatically verified'}\``);
  lines.push('');
  lines.push('### Known-issue boundary');
  lines.push(
    'Functional known issues are maintained manually in the authoritative project brief and are not inferred by the librarian.'
  );
  lines.push(END_MARKER);
  return lines.join('\n');
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function countOccurrences(text, marker) {
  let count = 0;
  let searchFrom = 0;
  let idx = text.indexOf(marker, searchFrom);
  while (idx !== -1) {
    count++;
    searchFrom = idx + marker.length;
    idx = text.indexOf(marker, searchFrom);
  }
  return count;
}

function main() {
  requireExists(PROJECT_BRIEF_PATH, 'Project brief');

  const originalContent = readFileSync(PROJECT_BRIEF_PATH, 'utf8');
  const briefLabel = path.relative(REPO_ROOT, PROJECT_BRIEF_PATH);

  const startCount = countOccurrences(originalContent, START_MARKER);
  const endCount = countOccurrences(originalContent, END_MARKER);

  if (startCount === 0) {
    fail(`Missing ${START_MARKER} marker in ${briefLabel}`);
  }
  if (startCount > 1) {
    fail(`Found ${startCount} occurrences of ${START_MARKER} in ${briefLabel}; expected exactly one`);
  }
  if (endCount === 0) {
    fail(`Missing ${END_MARKER} marker in ${briefLabel}`);
  }
  if (endCount > 1) {
    fail(`Found ${endCount} occurrences of ${END_MARKER} in ${briefLabel}; expected exactly one`);
  }

  const startIdx = originalContent.indexOf(START_MARKER);
  const endIdx = originalContent.indexOf(END_MARKER);
  if (endIdx < startIdx) {
    fail('End marker appears before start marker in project brief');
  }

  const before = originalContent.slice(0, startIdx);
  const after = originalContent.slice(endIdx + END_MARKER.length);
  const milestone = findMilestone(before + after);

  const status = getRepoStatus();
  const archFiles = listArchitectureFiles();
  const migrations = listMigrationFiles();
  const identityAudits = listIdentityAuditFiles();
  const generatedAt = localIsoTimestamp(new Date());

  const section = buildSection({ generatedAt, status, archFiles, migrations, identityAudits, milestone });
  const updatedContent = ensureTrailingNewline(before + section + after);

  writeFileSync(PROJECT_BRIEF_PATH, updatedContent, 'utf8');
  console.log(
    `Librarian updated ${path.relative(REPO_ROOT, PROJECT_BRIEF_PATH)} ` +
      `(branch ${status.branch}, commit ${status.commitHash.slice(0, 7)}).`
  );
}

main();
