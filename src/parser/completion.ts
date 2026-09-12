import { load } from 'cheerio';
export type CompletionState='complete'|'incomplete'|'not_tracked'|'unknown';
// Recorded course HTML uses Moodle completion-auto-n icons. Its y counterpart
// is covered synthetically; never interpret this as a download receipt.
export function parseActivityCompletion(html:string):CompletionState {
  const $=load(html),states=new Set<string>();
  $('img').each((_,node)=>{const match=($(node).attr('src')||'').match(/completion-(?:auto|manual)-(y|n)(?:[.?/]|$)/);if(match)states.add(match[1]);});
  if(states.size===1)return states.has('y')?'complete':'incomplete';
  if(states.size>1||/completion|type=["']checkbox/i.test(html))return 'unknown';
  return 'not_tracked';
}
