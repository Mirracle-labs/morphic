/**
 * Returns a unique id like `resp_3f9a...` (prefix + 32 hex chars).
 * @param prefix Identifier prefix indicating item type
 * @returns Formatted random identifier string
 */
export function newId(prefix: 'resp' | 'msg' | 'fc' | 'call'): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

