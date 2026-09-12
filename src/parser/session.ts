import { load } from 'cheerio';
import { parse } from 'acorn';
import { ORIGIN } from './dashboard.js';
type Node = { type?: string; [key: string]: unknown };
function member(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Node;
  if (n.type === 'Identifier') return String(n.name);
  if (n.type === 'MemberExpression') return `${member(n.object)}.${n.computed ? String((n.property as Node)?.value) : member(n.property)}`;
  return '';
}
// Parse JavaScript syntax without executing scripts from remote HTML.
export function extractSesskey(html: string): string | undefined {
  const $ = load(html);
  let result: string | undefined;
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const n = value as Node;
    if (n.type === 'AssignmentExpression') {
      if (member(n.left) === 'M.cfg.sesskey' && typeof (n.right as Node)?.value === 'string') result = (n.right as Node).value as string;
      if (member(n.left) === 'M.cfg' && (n.right as Node)?.type === 'ObjectExpression') {
        for (const prop of (n.right as Node).properties as Node[]) {
          const key = prop.key as Node, val = prop.value as Node;
          if ((key.name === 'sesskey' || key.value === 'sesskey') && typeof val.value === 'string') result = val.value;
        }
      }
    }
    for (const child of Object.values(n)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  $('script:not([src])').each((_, el) => { try { visit(parse($(el).html() || '', {ecmaVersion:'latest'})); } catch { /* Optional script may use unsupported syntax. */ } });
  return result || $('input[name="sesskey"]').first().attr('value') || undefined;
}
export function authenticatedHtml(html: string, url: string): boolean {
  try {
    const u = new URL(url);
    if (u.origin !== ORIGIN || /\/(login|passni)\//.test(u.pathname)) return false;
    const $ = load(html);
    return !$('input#loginPasswd, input[name="password"], body.notloggedin').length &&
      !!extractSesskey(html) && !!$('a[href*="/login/logout.php"], a[href*="/passni/sso/spLogout"], body.loggedin').length;
  } catch { return false; }
}
