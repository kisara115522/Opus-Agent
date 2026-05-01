import chalk from 'chalk';

export const theme = {
  accent:      chalk.hex('#3B82F6'),
  accentBright:chalk.hex('#60A5FA'),
  accentDim:   chalk.hex('#1D4ED8'),
  success:     chalk.hex('#22C55E'),
  warn:        chalk.hex('#F59E0B'),
  error:       chalk.hex('#EF4444'),
  info:        chalk.hex('#06B6D4'),
  muted:       chalk.hex('#6B7280'),
  heading:     chalk.bold.hex('#3B82F6'),
  command:     chalk.cyan,
  option:      chalk.white,
  hint:        chalk.gray,
} as const;
