import * as p from '@clack/prompts';
import { theme } from './theme.js';

export function handleCancel(value: unknown): never {
  if (p.isCancel(value)) {
    p.cancel(theme.muted('已取消配置。'));
    process.exit(0);
  }
  return value as never;
}

export { p, theme };
