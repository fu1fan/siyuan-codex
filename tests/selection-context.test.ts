import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {JSDOM} from 'jsdom';
import {SelectionContext} from '../src/selection-context';
import {contextPrompt,type Attachment} from '../src/context';

test('latest note selection replaces only the temporary item; menu and chat actions explicitly add annotations',()=>{
 const dom=new JSDOM('<div class="protyle-wysiwyg"><p data-node-id="20261005120000-abcdefg">笔记正文</p><p id="second" data-node-id="20261005120000-bcdefgh">第二段</p></div><div class="la-panel"><article class="la-assistant" data-message-id="reply-1"><div class="la-body">AI 回复内容</div></article><div class="protyle-wysiwyg">输入草稿</div></div>');
 Object.assign(globalThis,{window:dom.window,document:dom.window.document});
 const root=document.querySelector<HTMLElement>('.la-panel')!;let items:Attachment[]=[];const errors:string[]=[];
 const context=new SelectionContext(root,()=>items,next=>{items=next;context.update('a');},message=>errors.push(message));root.append(context.element);context.update('a');
 const click=(label:string)=>{const button=document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);assert.ok(button,label);button.click();};
 const select=(selector:string)=>{const range=document.createRange();range.selectNodeContents(document.querySelector(selector)!);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);document.dispatchEvent(new dom.window.MouseEvent('mouseup'));return range;};
 try{
  const first=select('p');select('p');assert.equal(items.length,1);assert.equal(items[0].selectionMode,'latest');
  let menuItem:any;context.addNoteMenu({addItem:item=>{menuItem=item;}},first);assert.equal(menuItem.label,'添加到 Codex');assert.equal(items.length,1);menuItem.click();assert.equal(items.length,2);
  select('#second');assert.equal(items.length,2);assert.equal(items.find(a=>a.selectionMode==='latest')!.text,'第二段');assert.equal(items.find(a=>a.selectionMode==='manual')!.text,'笔记正文');
  assert.equal(context.element.querySelectorAll('.la-context-chip').length,2);
  select('.la-assistant .la-body');assert.equal(items.length,2);assert.equal(document.querySelectorAll('.la-selection-toolbar button').length,2);
  [...document.querySelectorAll<HTMLButtonElement>('.la-selection-toolbar button')].find(b=>b.textContent==='添加到对话')!.click();assert.equal(items.length,3);assert.equal(document.querySelector('.la-selection-toolbar'),null);
  select('.la-panel .protyle-wysiwyg');assert.equal(items.length,3);
  const payload=JSON.parse(contextPrompt(items).split('<response-annotations>\n')[1].split('\n</response-annotations>')[0]);assert.equal(payload[0].source.blockId,'20261005120000-abcdefg');assert.equal(payload[2].source.messageId,'reply-1');assert.equal(payload[0].originalText,undefined);
  click('查看所选文本');click('编辑选文 1');const editor=context.element.querySelector<HTMLTextAreaElement>('[aria-label="编辑所选文本"]')!;editor.value='编辑后的引用';context.element.querySelector<HTMLTextAreaElement>('[aria-label="可选评论"]')!.value='评论';[...context.element.querySelectorAll('button')].find(b=>b.textContent==='保存')!.click();assert.equal(items[0].text,'编辑后的引用');assert.equal(items[0].selection!.originalText,'笔记正文');assert.equal(items[0].annotation,'评论');
  click('移除最新选区');assert.equal(items.length,2);assert.ok(items.every(a=>a.selectionMode!=='latest'));
  click('移除全部选文');assert.equal(items.length,0);
  select('.la-assistant .la-body');context.update('b');assert.equal(document.querySelector('.la-selection-toolbar'),null);assert.equal(items.length,0);
  context.destroy();select('p');assert.equal(items.length,0);assert.deepEqual(errors,[]);
 }finally{context.destroy();dom.window.close();}
});
