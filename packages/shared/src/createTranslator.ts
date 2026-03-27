type MsgTree = string | { [k: string]: MsgTree };

function getLeaf(tree: MsgTree, key: string): string {
  const parts = key.split(".").filter(Boolean);
  let cur: MsgTree | undefined = tree;
  for (const p of parts) {
    if (typeof cur === "string") return key;
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : key;
}

export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function createTranslator(messages: MsgTree): TranslateFn {
  return function t(key, vars) {
    let s = getLeaf(messages, key);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replaceAll(`{{${k}}}`, String(v));
      }
    }
    return s;
  };
}
