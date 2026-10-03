import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
// @ts-ignore
import {JSDOM} from 'jsdom';

test('resetting a focused native composer keeps the caret in a text paragraph and never steals another editor selection',async()=>{
 const dom=new JSDOM('<div id="host"></div><div id="note" contenteditable="true">笔记内容</div>',{url:'https://localhost/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,MutationObserver:dom.window.MutationObserver});
 Object.defineProperty(dom.window.HTMLElement.prototype,'contentEditable',{get(){return this.getAttribute('contenteditable');},set(value){this.setAttribute('contenteditable',value);},configurable:true});
 const dir=mkdtempSync(join(tmpdir(),'native-composer-caret-'));
 try{
  const bundle=await build({entryPoints:['src/native-composer.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'native-host',setup(b){
   b.onResolve({filter:/^siyuan$/},()=>({path:'host',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export class Protyle{
    constructor(app,host){const content=document.createElement('div');content.className='protyle-content';const root=document.createElement('div');root.className='protyle-wysiwyg';root.contentEditable='true';content.append(root);host.append(content);this.protyle={wysiwyg:{element:root},lute:{Md2BlockDOM:value=>value?'<div data-node-id="fixture" data-type="NodeParagraph"><div contenteditable="true">'+value+'</div></div>':'',BlockDOM2StdMd:html=>{const node=document.createElement('div');node.innerHTML=html;return node.textContent;}}};}
    clearStack(){} focus(){const range=document.createRange();range.selectNodeContents(this.protyle.wysiwyg.element);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}destroy(){}
   }`}));
  }}]});
  const file=join(dir,'native.cjs');writeFileSync(file,bundle.outputFiles[0].contents);const {nativeComposer}=createRequire(import.meta.url)(file);
  const composer=nativeComposer({})(document.getElementById('host'),()=>{},()=>{}),selection=window.getSelection()!;
  composer.focus();assert.equal(selection.anchorNode,composer.element.querySelector('[contenteditable="true"]'));
  composer.value='待发送';const previous=composer.element.querySelector('[contenteditable="true"]')!;
  const range=document.createRange();range.selectNodeContents(previous);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
  composer.value='';const empty=composer.element.querySelector('[contenteditable="true"]')!;
  assert.equal(selection.anchorNode,empty);assert.notEqual(empty,previous);assert.notEqual(selection.anchorNode,composer.element);assert.equal(composer.value,'');
  const note=document.getElementById('note')!;range.selectNodeContents(note);range.collapse(false);selection.removeAllRanges();selection.addRange(range);composer.value='';assert.equal(selection.anchorNode,note);
  range.selectNodeContents(composer.element);range.collapse(false);selection.removeAllRanges();selection.addRange(range);composer.element.dispatchEvent(new dom.window.MouseEvent('mouseup',{bubbles:true}));assert.equal(selection.anchorNode,composer.element.querySelector('[contenteditable="true"]'));
  composer.destroy();
 }finally{dom.window.close();rmSync(dir,{recursive:true,force:true});}
});
