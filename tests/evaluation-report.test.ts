import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('keeps the generated evaluation report structural and free of fixture content',()=>{
  const report=readFileSync(new URL('../docs/m8-performance-evaluation.md',import.meta.url),'utf8');
  expect(report).toMatch(/Integration evaluation: (?:NOT RUN|RUN)/);
  expect(report).toContain('NOT_AUTOMATICALLY_VERIFIED');
  expect(report).not.toMatch(/Synthetic course|Synthetic assignment|Synthetic announcement|Synthetic notification|pluginfile\.php|forcedownload=1/);
});
