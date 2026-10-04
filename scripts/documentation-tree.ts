import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function isDocumentationOnlyTree(root: string): boolean {
  let documents = 0;
  function inspect(directory: string): boolean {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (directory === root && entry.name === 'node_modules' && entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (directory === root && entry.name !== 'docs') return false;
        if (!inspect(join(directory, entry.name))) return false;
      } else if (entry.isFile() && entry.name.endsWith('.md')) documents += 1;
      else return false;
    }
    return true;
  }
  return inspect(root) && documents > 0;
}
