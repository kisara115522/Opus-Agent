import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * A parsed Git commit.
 */
export interface GitCommit {
  /** Commit SHA (short) */
  commitId: string;
  /** Author name */
  author: string;
  /** Commit timestamp (ISO string) */
  committedAt: string;
  /** Commit message (first line) */
  message: string;
}

/**
 * A changed file entry from a Git diff.
 */
export interface GitFile {
  /** File path relative to repo root */
  path: string;
  /** Change status: added, modified, deleted, renamed */
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

/**
 * A diff for a single file.
 */
export interface GitDiff {
  /** File path */
  path: string;
  /** Unified diff content */
  patch: string;
}

/**
 * Options for the runGit helper.
 */
export interface RunGitOptions {
  /** Working directory for the git command */
  cwd: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Run a git command and return its stdout.
 * Throws on non-zero exit code.
 *
 * @param args - Git command arguments (e.g. ['log', '--oneline', '-5'])
 * @param options - Working directory and timeout
 */
export async function runGit(
  args: string[],
  options: RunGitOptions,
): Promise<string> {
  const { cwd, timeout = 30_000 } = options;
  const { stdout } = await execFileAsync('git', args, { cwd, timeout });
  return stdout.trim();
}

/**
 * Collect commits between two refs.
 */
export async function collectCommits(
  cwd: string,
  baseRef: string,
  headRef: string = 'HEAD',
): Promise<GitCommit[]> {
  const separator = '---GIT_SEP---';
  const format = ['%h', '%an', '%aI', '%s'].join(separator);
  const output = await runGit(
    ['log', `${baseRef}..${headRef}`, `--pretty=format:${format}`],
    { cwd },
  );

  if (!output) {
    return [];
  }

  return output.split('\n').map((line) => {
    const [commitId, author, committedAt, message] = line.split(separator);
    return { commitId, author, committedAt, message };
  });
}

/**
 * Collect changed files between two refs.
 */
export async function collectChangedFiles(
  cwd: string,
  baseRef: string,
  headRef: string = 'HEAD',
): Promise<GitFile[]> {
  const output = await runGit(
    ['diff', '--name-status', `${baseRef}..${headRef}`],
    { cwd },
  );

  if (!output) {
    return [];
  }

  const statusMap: Record<string, GitFile['status']> = {
    A: 'added',
    M: 'modified',
    D: 'deleted',
    R: 'renamed',
  };

  return output.split('\n').map((line) => {
    const [rawStatus, path] = line.split('\t');
    return {
      path,
      status: statusMap[rawStatus[0]] ?? 'modified',
    };
  });
}

/**
 * Collect unified diff patches for files between two refs.
 */
export async function collectPatches(
  cwd: string,
  baseRef: string,
  headRef: string = 'HEAD',
  maxPatchChars: number = 10_000,
): Promise<GitDiff[]> {
  const output = await runGit(
    ['diff', `${baseRef}..${headRef}`],
    { cwd },
  );

  if (!output) {
    return [];
  }

  // Split on "diff --git" boundaries
  const chunks = output.split(/^diff --git /m).filter(Boolean);

  return chunks.map((chunk) => {
    // First line is "a/path b/path"
    const firstLine = chunk.split('\n')[0];
    const pathMatch = firstLine.match(/ b\/(.+)$/);
    const path = pathMatch ? pathMatch[1] : 'unknown';
    const patch = `diff --git ${chunk}`;
    return {
      path,
      patch: patch.length > maxPatchChars
        ? patch.slice(0, maxPatchChars) + '\n... (truncated)'
        : patch,
    };
  });
}
