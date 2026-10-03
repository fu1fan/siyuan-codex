import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {JSDOM} from 'jsdom';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {mediaTransfer,mediaSource,extractElementMedia} from '../src/composer-media';
import {importMedia,assetPath,attachmentInput} from '../src/media';
import {ChatView} from '../src/ui';
import {ChatSession,newSession} from '../src/session';
import {defaults} from '../src/codex';
import type {Attachment} from '../src/context';
function dom(){const d=new JSDOM('<div id="root"></div>',{url:'https://localhost/stage/build/desktop/'});Object.assign(globalThis,{window:d.window,document:d.window.document,location:d.window.location});return d;}
const transfer=(values:Record<string,string>,files:File[]=[])=>({getData:(type:string)=>values[type]||'',files:files as unknown as FileList});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2I5sAAAAASUVORK5CYII=','base64');
const tick=()=>new Promise(r=>setTimeout(r,0));
test('rich clipboard extracts ordered media markers, preserves formatting and refs, and deduplicates image files',()=>{
 const d=dom();try{
 const f=new File([png],'image.png',{type:'image/png'});
 const data=mediaTransfer(transfer({'text/html':`<p><strong>前文</strong><img src="file:///clip.png" alt="图示"><span data-type="block-ref" data-id="20261001124824-pq6acxs">笔记</span>中间<a href="assets/paper.pdf">paper.pdf</a>后文<script>bad()</script></p>`},[f]),3)!;
 assert.equal(data.sources.length,2);assert.equal(data.sources[0].file,f);assert.equal(data.sources[1].kind,'file');assert.match(data.text,/前文［图片 3：图示］笔记中间［附件 4：paper.pdf］后文/);assert.doesNotMatch(data.html!,/<img|<script|file:\/\//);assert.match(data.html!,/<strong>前文<\/strong>/);assert.match(data.html!,/data-type="block-ref"/);
 const pure=mediaTransfer(transfer({'text/html':'<img src="file:///clip.png">'},[f]))!;assert.equal(pure.sources.length,1);assert.equal(pure.text,'');assert.equal(pure.html,'');
 const markdown=mediaTransfer(transfer({'text/plain':'前文 ![图](assets/image.png) 后文 [附件](assets/paper.pdf) 结束'}))!;assert.equal(markdown.sources.length,2);assert.match(markdown.text,/前文 ［图片 1：图］ 后文 ［附件 2：附件］ 结束/);
 assert.equal(mediaTransfer(transfer({'text/plain':'((20261001124824-pq6acxs \'笔记\'))'})),undefined);
 assert.equal(mediaTransfer(transfer({'text/plain':'```\n![sample](assets/a.png)\n```'})),undefined);
 assert.equal(mediaTransfer(transfer({'text/uri-list':'https://localhost/assets/paper.pdf'}))!.sources[0].kind,'file');
 }finally{d.window.close();}
});
test('native image wrappers are replaced at their original positions without capturing emoji or normal links',()=>{
 const d=dom();try{const root=document.getElementById('root')!;root.innerHTML='<div contenteditable>前<span data-type="img"><span><img src="assets/a.png" alt="图"></span><span contenteditable="false">50%</span></span>后<img class="emoji" src="emoji.png"><a href="https://example.org">链接</a></div>';const media=extractElementMedia(root,input=>mediaSource(input,1));assert.equal(media.length,1);assert.equal(root.querySelector('[data-type=img]'),null);assert.equal(root.querySelectorAll('img').length,1);assert.match(root.textContent!,/^前［图片 1：图］后链接$/);}finally{d.window.close();}
});
test('files are durable plugin snapshots, existing assets stay untouched, and only image inputs use vision',async()=>{
 const d=dom(),dir=await mkdtemp(join(tmpdir(),'local-agent-media-'));
 try{await mkdir(join(dir,'data/assets'),{recursive:true});await writeFile(join(dir,'data/assets/original.png'),png);
 const source=mediaSource({url:'assets/original.png',kind:'image'},1);const image=await importMedia(source,dir,location.origin);assert.ok(image.media!.path!.includes(join('storage','petal','siyuan-codex','attachments')));assert.deepEqual(await readFile(image.media!.path!),png);assert.deepEqual(await readFile(join(dir,'data/assets/original.png')),png);
 await rm(join(dir,'data/assets/original.png'));assert.deepEqual(await readFile(image.media!.path!),png);
 const pdf=await importMedia(mediaSource({file:new File(['pdf-fixture'],'paper.pdf',{type:'application/pdf'})},2),dir,location.origin);const input=attachmentInput('查看这张图',[image,pdf]);assert.equal(input.length,2);assert.deepEqual(input[1],{type:'localImage',path:image.media!.path});assert.match(pdf.text,/本机附件路径/);
 assert.throws(()=>attachmentInput('x',[{title:'bad',text:'',media:{key:'key',kind:'image',marker:'x',status:'error'}}]),/尚未准备/);
 await assert.rejects(importMedia(mediaSource({file:new File([new Uint8Array(20*1024*1024+1)],'big.png',{type:'image/png'})},1),dir,location.origin),/20 MB/);
 const outside=join(dir,'outside');await mkdir(outside);await writeFile(join(outside,'private.txt'),'private');await symlink(outside,join(dir,'data/assets/escape'),process.platform==='win32'?'junction':'dir');await assert.rejects(assetPath('/assets/escape/private.txt',dir,location.origin),/无效/);
 }finally{d.window.close();await rm(dir,{recursive:true,force:true});}
});
test('paste shows media above the input, blocks early sends, retains failed drafts, and removal updates markers',async()=>{
 const d=dom();const root=document.getElementById('root')!;const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');let attachments:Attachment[]=[],release!:()=>void,sends=0;let errors:string[]=[];
 const view=new ChatView(root,()=>chat,{send:async()=>{sends++;return false;},stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>{},clear:()=>{},context:()=>'',attachments:()=>attachments,removeAttachment:i=>{attachments.splice(i,1);view.update();},importMedia:async sources=>{attachments.push(...sources.map(s=>({title:s.title,text:'',media:{key:s.key,kind:s.kind,marker:s.marker,status:'loading' as const}})));view.update();await new Promise<void>(r=>release=r);attachments.forEach(a=>{a.media!.status=undefined;a.media!.path='/tmp/test.png';a.media!.url='data:image/png;base64,'+png.toString('base64');});view.update();},error:e=>errors.push(e)});
 try{view.input.value='首尾';(view.input.element as HTMLTextAreaElement).setSelectionRange(1,1);const event=new d.window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:transfer({'text/html':'<p>文字<img src="assets/a.png" alt="图">结束</p>'})});view.input.element.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.match(view.input.value,/首文字［图片 1：图］结束尾/);assert.equal(root.querySelectorAll('.la-context .la-media-card').length,1);assert.equal(root.querySelectorAll('.la-composer-host img').length,0);
 const send=root.querySelector<HTMLButtonElement>('.la-send')!;assert.equal(send.disabled,true);release();await tick();assert.equal(send.disabled,false);assert.equal(root.querySelectorAll('.la-context img').length,1);send.click();await tick();assert.equal(sends,1);assert.match(view.input.value,/首文字/);root.querySelector<HTMLButtonElement>('[aria-label="移除 图"]')!.click();assert.equal(attachments.length,0);assert.match(view.input.value,/［已移除：图］/);assert.equal(errors.length,0);
 }finally{view.destroy();d.window.close();}
});

test('document drops insert inline references at the caret and cannot change a newer draft',async()=>{
 const d=dom(),root=document.getElementById('root')!;const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');const note={id:'20261001124824-pq6acxs',title:'文档'};let resolve!:(v:any)=>void,errors:string[]=[];
 const view=new ChatView(root,()=>chat,{send:async()=>false,stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>[note],clear:()=>{},context:()=>'',drop:async()=>new Promise(r=>resolve=r),error:e=>errors.push(e)});
 try{const drop=()=>{const e=new d.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:{types:['application/siyuan-file'],files:[],getData:(type:string)=>type==='application/siyuan-file'?note.id:''}});root.dispatchEvent(e);return e;};
 view.input.value='前后';(view.input.element as HTMLTextAreaElement).setSelectionRange(1,1);assert.equal(drop().defaultPrevented,true);resolve([note]);await tick();assert.equal(view.input.value,`前((${note.id} '文档')) 后`);assert.equal(root.querySelectorAll('.la-context-chip').length,0);
 drop();view.input.value='新草稿';resolve([note]);await tick();assert.equal(view.input.value,'新草稿');assert.match(errors[0],/已变更/);
 }finally{view.destroy();d.window.close();}
});

test('failed attachment cards expose retry, keep the same marker and prevent incomplete sends',async()=>{
 const d=dom(),root=document.getElementById('root')!;const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');const source=mediaSource({url:'assets/a.png',kind:'image',title:'图片.png'},1);const attachment:Attachment={title:source.title,text:'',media:{key:source.key,marker:source.marker,kind:'image',status:'error',error:'读取失败'}};let release!:()=>void;let calls=0;
 const view=new ChatView(root,()=>chat,{send:async()=>false,stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>{},clear:()=>{},context:()=>'',attachments:()=>[attachment],retryMedia:async key=>{assert.equal(key,source.key);calls++;attachment.media!.status='loading';attachment.media!.error=undefined;view.update();await new Promise<void>(r=>release=r);attachment.media!.status=undefined;attachment.media!.path='/tmp/a.png';attachment.media!.url='data:image/png;base64,'+png.toString('base64');view.update();}});
 try{view.input.value='前'+source.marker+'后';const send=root.querySelector<HTMLButtonElement>('.la-send')!;assert.equal(send.disabled,true);assert.match(root.querySelector('[role=alert]')!.textContent!,/读取失败/);root.querySelector<HTMLButtonElement>('.la-media-retry')!.click();assert.equal(calls,1);assert.equal(send.disabled,true);release();await tick();assert.equal(send.disabled,false);assert.equal(root.querySelector('[role=alert]'),null);assert.equal(view.input.value,'前'+source.marker+'后');}finally{view.destroy();d.window.close();}
});
