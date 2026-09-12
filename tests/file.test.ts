import { describe,it,expect } from 'vitest';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AssignmentAttachmentAdapter, FileClient, attachmentLinks, below, dispositionFileName, downloadDirectory, downloadHeaders, fileUrl, publishDownloaded, safeName, sourceFileUrl } from '../src/client/FileClient.js';

describe('local download security',()=>{
  it('sanitizes traversal, absolute syntax and Windows reserved names',()=>{
    expect(safeName('../CON:<x>.pdf')).not.toMatch(/[<>:"/\\|?*]/);expect(safeName('CON')).toBe('_CON');
    const root=path.resolve('safe-root'),target=downloadDirectory(root,{courseId:'7',courseName:'../Course',courseCode:'A/B',semester:'2026-2'});
    expect(below(root,target)).toBe(true);expect(target).toContain(`2026-2${path.sep}`);
    expect(fileUrl('https://evil.example/pluginfile.php/1/x')).toBeUndefined();expect(fileUrl('https://ys.learnus.org/mod/ubfile/view.php?id=2&delete=1')).toBeUndefined();
  });
  it('does not create the configured root until download is called',async()=>{
    const root=path.join(await mkdtemp(path.join(tmpdir(),'learnus-lazy-')),'missing');process.env.LEARNUS_DOWNLOAD_ROOT=root;
    new FileClient();await expect(import('node:fs/promises').then(fs=>fs.stat(root))).rejects.toMatchObject({code:'ENOENT'});delete process.env.LEARNUS_DOWNLOAD_ROOT;
  });
  it('publishes complete files with collision-safe names',async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),'learnus-collision-')),temp=path.join(dir,'.partial');await writeFile(temp,'ok');await writeFile(path.join(dir,'Lecture.pdf'),'old');
    const result=await publishDownloaded(temp,dir,'Lecture.pdf');expect(path.basename(result)).toBe('Lecture (2).pdf');expect(await readFile(result,'utf8')).toBe('ok');
  });
  it('discovers only observed same-origin pluginfile attachments',()=>{
    const html='<div id="intro"><a target="_blank" href="https://ys.learnus.org/pluginfile.php/1/mod_assign/introattachment/0/file.pdf?forcedownload=1">Synthetic PDF</a><a href="https://evil.example/file.pdf">External</a></div>';
    expect(attachmentLinks(html,'assignment')).toEqual([{name:'Synthetic PDF',url:'https://ys.learnus.org/pluginfile.php/1/mod_assign/introattachment/0/file.pdf?forcedownload=1'}]);
    expect(sourceFileUrl('https://ys.learnus.org/pluginfile.php/1/mod_assign/introattachment/2/file.pdf?forcedownload=1','assignment')).toBeUndefined();
    expect(sourceFileUrl('https://ys.learnus.org/pluginfile.php/1/mod_assign/introattachment/0/file.pdf?forcedownload=0','assignment')).toBeUndefined();
    expect(new AssignmentAttachmentAdapter(new FileClient()).resolve(html,'7','11')[0]).toMatchObject({sourceType:'assignment',courseId:'7',parentId:'11',downloadable:true});
  });
  it('requires binary attachment headers and enforces declared size for assignments',()=>{
    expect(downloadHeaders('assignment',{'content-type':'application/pdf','content-disposition':'attachment; filename="synthetic.pdf"','content-length':'10'},20)).toMatchObject({mime:'application/pdf',contentDisposition:true,contentLengthHeader:true});
    expect(()=>downloadHeaders('assignment',{'content-type':'application/pdf'},20)).toThrow('ENDPOINT_UNAVAILABLE');
    expect(()=>downloadHeaders('assignment',{'content-disposition':'attachment'},20)).toThrow('ENDPOINT_UNAVAILABLE');
    expect(()=>downloadHeaders('assignment',{'content-type':'application/pdf','content-disposition':'attachment','content-length':'21'},20)).toThrow('DOWNLOAD_TOO_LARGE');
  });
  it('decodes UTF-8 bytes carried in a plain Content-Disposition filename',()=>{
    const mojibake=Buffer.from('2026-2학기-운영방안.pdf','utf8').toString('latin1');
    expect(dispositionFileName(`attachment; filename="${mojibake}"`)).toBe('2026-2학기-운영방안.pdf');
    expect(dispositionFileName('attachment; filename="café.pdf"')).toBe('café.pdf');
  });
});
