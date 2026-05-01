import { createInterface } from 'node:readline';

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const esc = (code: string) => `\x1b[${code}m`;

/**
 * Low-level ANSI wrapper: apply one or more SGR codes to text.
 */
function wrap(text: string, ...codes: string[]): string {
  return `${codes.map(esc).join('')}${text}${esc('0')}`;
}

// ── 1. Colors ─────────────────────────────────────────────────────────────────

export const color = {
  // Foreground colours
  green:    (text: string) => wrap(text, '32'),
  red:      (text: string) => wrap(text, '31'),
  yellow:   (text: string) => wrap(text, '33'),
  blue:     (text: string) => wrap(text, '34'),
  cyan:     (text: string) => wrap(text, '36'),
  magenta:  (text: string) => wrap(text, '35'),

  // Styles
  bold:   (text: string) => wrap(text, '1'),
  dim:    (text: string) => wrap(text, '2'),
  italic: (text: string) => wrap(text, '3'),

  // Prefixed messages
  success: (text: string) => `${color.green('✔')} ${text}`,
  error:   (text: string) => `${color.red('✘')} ${text}`,
  warning: (text: string) => `${color.yellow('⚠')} ${text}`,
  info:    (text: string) => `${color.blue('ℹ')} ${text}`,
} as const;

// ── 2. Box drawing ────────────────────────────────────────────────────────────

interface BoxOptions {
  title?: string;
  padding?: number;
}

/**
 * Render a Unicode box around `content`.
 *
 * @example
 *   box('hello world', { title: 'Greeting' })
 *   //  ╔══ Greeting ══╗
 *   //  ║               ║
 *   //  ║  hello world  ║
 *   //  ║               ║
 *   //  ╚═══════════════╝
 */
export function box(content: string, options: BoxOptions = {}): string {
  const { title, padding = 1 } = options;

  const lines = content.split('\n');
  const pad = ' '.repeat(padding);
  const innerWidth = Math.max(
    ...lines.map((l) => stripAnsi(l).length),
    title ? stripAnsi(title).length + 4 : 0,
  );
  const totalWidth = innerWidth + padding * 2;

  const horizontal = '═'.repeat(totalWidth);
  const emptyLine  = `${'║'}${' '.repeat(totalWidth)}║`;

  // Top border (with optional title)
  let top: string;
  if (title) {
    const titleStr = ` ${title} `;
    const titleVisible = stripAnsi(title).length + 2;
    const leftPad  = Math.floor((totalWidth - titleVisible) / 2);
    const rightPad = totalWidth - titleVisible - leftPad;
    top = `╔${'═'.repeat(leftPad)}${titleStr}${'═'.repeat(rightPad)}╗`;
  } else {
    top = `╔${horizontal}╗`;
  }

  const bottom = `╚${horizontal}╝`;

  const body = lines.map((line) => {
    const visibleLen = stripAnsi(line).length;
    const spacer = ' '.repeat(innerWidth - visibleLen);
    return `║${pad}${line}${spacer}${pad}║`;
  });

  const paddingLines = padding > 0
    ? Array.from({ length: padding }, () => emptyLine)
    : [];

  return [top, ...paddingLines, ...body, ...paddingLines, bottom].join('\n');
}

// ── 3. Spinner ────────────────────────────────────────────────────────────────

const BRAILLE_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣷', '⣯'];

export interface Spinner {
  start(): void;
  stop(): void;
  success(text?: string): void;
  error(text?: string): void;
}

/**
 * Create an animated terminal spinner.
 */
export function createSpinner(text: string): Spinner {
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentText = text;

  const clearLine = () => {
    process.stderr.write('\r\x1b[2K');
  };

  const render = () => {
    clearLine();
    process.stderr.write(`${color.cyan(BRAILLE_FRAMES[frameIndex])} ${currentText}`);
    frameIndex = (frameIndex + 1) % BRAILLE_FRAMES.length;
  };

  return {
    start() {
      if (timer) return;
      render();
      timer = setInterval(render, 80);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      clearLine();
    },

    success(msg?: string) {
      this.stop();
      process.stderr.write(`${color.success(msg ?? currentText)}\n`);
    },

    error(msg?: string) {
      this.stop();
      process.stderr.write(`${color.error(msg ?? currentText)}\n`);
    },
  };
}

// ── 4. Progress bar ───────────────────────────────────────────────────────────

/**
 * Render a single-line progress bar string.
 *
 * @example
 *   progressBar(50, 100)  // "[████████████░░░░░░░░░░░░] 50%"
 */
export function progressBar(
  current: number,
  total: number,
  width = 30,
): string {
  const ratio = total > 0 ? Math.min(current / total, 1) : 0;
  const filled = Math.round(width * ratio);
  const empty  = width - filled;

  const bar = color.green('█'.repeat(filled)) + '░'.repeat(empty);
  const pct = Math.round(ratio * 100);
  return `[${bar}] ${pct}%`;
}

// ── 5. Table ──────────────────────────────────────────────────────────────────

/**
 * Render a simple ASCII table.
 */
export function table(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const colCount = headers.length;

  // Compute max width per column
  const colWidths = Array.from({ length: colCount }, (_, col) =>
    Math.max(...allRows.map((r) => stripAnsi(r[col] ?? '').length)),
  );

  const sep = `+${colWidths.map((w) => '-'.repeat(w + 2)).join('+')}+`;

  const formatRow = (row: string[]) => {
    const cells = row.map((cell, i) => {
      const visible = stripAnsi(cell ?? '').length;
      return ` ${cell ?? ''}${' '.repeat(colWidths[i] - visible)} `;
    });
    return `|${cells.join('|')}|`;
  };

  return [
    sep,
    formatRow(headers),
    sep,
    ...rows.map(formatRow),
    sep,
  ].join('\n');
}

// ── 6. Prompts ────────────────────────────────────────────────────────────────

/**
 * Raw-mode prompt helper. Returns a readline interface and a cleanup function.
 */
function rawPrompt(): {
  rl: ReturnType<typeof createInterface>;
  cleanup: () => void;
} {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    rl,
    cleanup: () => rl.close(),
  };
}

/**
 * Prompt for free-form text input.
 */
export function promptInput(
  question: string,
  defaultVal?: string,
): Promise<string> {
  return new Promise((resolve) => {
    const suffix = defaultVal !== undefined ? ` (${defaultVal})` : '';
    const { rl, cleanup } = rawPrompt();
    rl.question(`${color.cyan('?')} ${question}${suffix}: `, (answer) => {
      cleanup();
      const trimmed = answer.trim();
      resolve(trimmed !== '' ? trimmed : defaultVal ?? '');
    });
  });
}

/**
 * Prompt for a yes / no confirmation.
 */
export function promptConfirm(
  question: string,
  defaultVal = true,
): Promise<boolean> {
  return new Promise((resolve) => {
    const hint = defaultVal ? 'Y/n' : 'y/N';
    const { rl, cleanup } = rawPrompt();
    rl.question(`${color.cyan('?')} ${question} (${hint}): `, (answer) => {
      cleanup();
      const norm = answer.trim().toLowerCase();
      if (!norm) return resolve(defaultVal);
      resolve(norm === 'y' || norm === 'yes');
    });
  });
}

/**
 * Prompt with masked input (password / secret).
 */
export function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`${color.cyan('?')} ${question}: `);

    let value = '';
    const onKey = (_chunk: Buffer, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      if (!process.stdin.isTTY) return;

      if (key.name === 'enter' || (key.ctrl && key.name === 'c')) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onKey);
        process.stdout.write('\n');
        resolve(value);
        return;
      }

      if (key.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (key.sequence && !key.ctrl) {
        value += key.sequence;
      }
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.on('data', onKey);
    } else {
      resolve('');
    }
  });
}

/**
 * Prompt the user to select one option from a list (arrow-key navigation).
 */
export function promptSelect(
  question: string,
  choices: { label: string; description?: string; value: string }[],
): Promise<string> {
  return new Promise((resolve) => {
    let selected = 0;

    const render = () => {
      // Move cursor up to overwrite previous render
      if (rendered > 0) {
        process.stdout.write(`\x1b[${rendered}A`);
      }

      // Question line (only on first render)
      if (rendered === 0) {
        process.stdout.write(`${color.cyan('?')} ${question}\n`);
        rendered++;
      }

      for (let i = 0; i < choices.length; i++) {
        const c = choices[i];
        const active = i === selected;
        const prefix = active ? color.green(' > ') : '   ';
        const label  = active ? color.bold(c.label) : color.dim(c.label);
        const desc   = c.description ? color.dim(` - ${c.description}`) : '';
        process.stdout.write(`\x1b[2K${prefix}${label}${desc}\n`);
      }

      rendered = choices.length + 1;
    };

    let rendered = 0;
    render();

    const onData = (_chunk: Buffer, key: { name?: string; sequence?: string }) => {
      if (!process.stdin.isTTY) return;

      if (key.name === 'up') {
        selected = (selected - 1 + choices.length) % choices.length;
        render();
      } else if (key.name === 'down') {
        selected = (selected + 1) % choices.length;
        render();
      } else if (key.name === 'enter') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        // Clear the list area and print the final selection
        process.stdout.write(`\x1b[${choices.length}A`);
        for (let i = 0; i <= choices.length; i++) {
          process.stdout.write('\x1b[2K\n');
        }
        process.stdout.write(`\x1b[${choices.length + 1}A`);
        process.stdout.write(`${color.green('✔')} ${choices[selected].label}\n`);
        resolve(choices[selected].value);
      }
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.on('data', onData);
    } else {
      resolve(choices[0]?.value ?? '');
    }
  });
}

// ── 7. Banner ─────────────────────────────────────────────────────────────────

/**
 * Display a prominent ASCII-art banner in a box.
 */
export function showBanner(title: string, subtitle?: string): void {
  const lines = [color.bold(title)];
  if (subtitle) lines.push(color.dim(subtitle));
  console.log(box(lines.join('\n'), { padding: 1 }));
}

// ── 8. Step indicator ─────────────────────────────────────────────────────────

/**
 * Print a step indicator line, e.g. "▸ Step 1/5: LLM Provider".
 */
export function step(current: number, total: number, text: string): void {
  console.log(`${color.cyan('▸')} Step ${color.bold(`${current}/${total}`)}: ${text}`);
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Strip ANSI escape sequences from a string (used for visible-length calculations).
 */
function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}
