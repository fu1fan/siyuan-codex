import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {JSDOM} from 'jsdom';
import {HorizontalScrollbar} from '../src/horizontal-scrollbar';

function setup(){
  const dom=new JSDOM('<div id="viewport"></div>');Object.assign(globalThis,{document:dom.window.document});
  const viewport=document.getElementById('viewport')!;let content=800;
  Object.defineProperties(viewport,{clientWidth:{value:200},scrollWidth:{get:()=>content}});
  const scrollbar=new HorizontalScrollbar(viewport),rail=scrollbar.element;document.body.append(rail);
  Object.defineProperty(rail,'clientWidth',{value:200});rail.getBoundingClientRect=()=>({left:10,width:200} as DOMRect);
  const thumb=rail.firstElementChild as HTMLElement;thumb.getBoundingClientRect=()=>({left:10+viewport.scrollLeft/4,width:50} as DOMRect);
  let captured:number|undefined;rail.setPointerCapture=id=>{captured=id;};rail.hasPointerCapture=id=>captured===id;rail.releasePointerCapture=()=>{captured=undefined;};
  const pointer=(target:HTMLElement,type:string,x:number,id=1)=>{const e=new dom.window.MouseEvent(type,{clientX:x,button:0,bubbles:true,cancelable:true});Object.defineProperty(e,'pointerId',{value:id});target.dispatchEvent(e);};
  scrollbar.update();return {dom,viewport,scrollbar,rail,thumb,pointer,captured:()=>captured,content:(value:number)=>{content=value;scrollbar.update();},close:()=>{scrollbar.destroy();dom.window.close();}};
}
test('custom rail reflects scroll and resize, and hides when content fits',()=>{
 const s=setup();try{
  assert.equal(s.rail.hidden,false);assert.equal(s.thumb.style.width,'50px');assert.equal(s.rail.getAttribute('aria-controls'),'viewport');
  s.viewport.scrollLeft=300;s.viewport.dispatchEvent(new s.dom.window.Event('scroll'));assert.equal(s.rail.getAttribute('aria-valuenow'),'300');assert.equal(s.rail.getAttribute('aria-valuetext'),'50%');assert.equal(s.thumb.style.transform,'translateX(75px)');
  s.content(200);assert.equal(s.rail.hidden,true);assert.equal(s.rail.getAttribute('aria-valuemax'),'0');
 }finally{s.close();}
});
test('thumb dragging keeps the grab offset, clamps at both ends and cleans up capture',()=>{
 const s=setup();try{
  s.viewport.scrollLeft=200;s.scrollbar.update();s.pointer(s.thumb,'pointerdown',64);assert.equal(s.viewport.scrollLeft,200);assert.equal(s.captured(),1);
  s.pointer(s.rail,'pointermove',114);assert.equal(s.viewport.scrollLeft,400);s.pointer(s.rail,'pointermove',1000,2);assert.equal(s.viewport.scrollLeft,400);
  s.pointer(s.rail,'pointermove',1000);assert.equal(s.viewport.scrollLeft,600);s.pointer(s.rail,'pointermove',-100);assert.equal(s.viewport.scrollLeft,0);s.pointer(s.rail,'pointerup',-100);assert.equal(s.captured(),undefined);
  s.pointer(s.rail,'pointerdown',110);assert.equal(s.viewport.scrollLeft,300);s.pointer(s.rail,'pointercancel',110);assert.equal(s.rail.classList.contains('la-scrollbar-dragging'),false);
  s.pointer(s.thumb,'pointerdown',89);s.content(200);assert.equal(s.captured(),undefined);assert.equal(s.rail.hidden,true);
 }finally{s.close();}
});
test('wheel and keyboard scroll the viewport without swallowing edge scrolling or zoom; destroy removes input handlers',()=>{
 const s=setup();try{
  const key=(key:string)=>s.rail.dispatchEvent(new s.dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  key('ArrowRight');assert.equal(s.viewport.scrollLeft,40);key('PageDown');assert.equal(s.viewport.scrollLeft,220);key('End');assert.equal(s.viewport.scrollLeft,600);
  const wheel=(deltaY:number,options={})=>{const e=new s.dom.window.WheelEvent('wheel',{deltaY,bubbles:true,cancelable:true,...options});s.viewport.dispatchEvent(e);return e;};
  assert.equal(wheel(50).defaultPrevented,false);key('Home');assert.equal(s.viewport.scrollLeft,0);assert.equal(wheel(50).defaultPrevented,true);assert.equal(s.viewport.scrollLeft,50);
  assert.equal(wheel(50,{ctrlKey:true}).defaultPrevented,false);assert.equal(wheel(50,{deltaX:20}).defaultPrevented,false);assert.equal(s.viewport.scrollLeft,50);
  s.scrollbar.destroy();assert.equal(wheel(50).defaultPrevented,false);key('End');assert.equal(s.viewport.scrollLeft,50);assert.equal(s.rail.isConnected,false);
 }finally{s.close();}
});
test('auto hide waits after leaving, re-entry cancels it and scroll reveals without background updates reopening it',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const s=setup();
 const visible=()=>s.rail.classList.contains('la-scrollbar-visible');
 const hover=(target:HTMLElement,type:string)=>target.dispatchEvent(new s.dom.window.Event(type));
 try{
  assert.equal(visible(),true);t.mock.timers.tick(1500);assert.equal(visible(),false);
  hover(s.viewport,'pointerenter');assert.equal(visible(),true);hover(s.viewport,'pointerleave');t.mock.timers.tick(1000);assert.equal(visible(),true);
  hover(s.viewport,'pointerenter');t.mock.timers.tick(5000);assert.equal(visible(),true);hover(s.viewport,'pointerleave');t.mock.timers.tick(1500);assert.equal(visible(),false);
  s.scrollbar.update();assert.equal(visible(),false);s.viewport.dispatchEvent(new s.dom.window.Event('scroll'));assert.equal(visible(),true);t.mock.timers.tick(1500);assert.equal(visible(),false);
  hover(s.viewport,'pointerenter');hover(s.rail,'pointerenter');hover(s.rail,'pointerleave');t.mock.timers.tick(5000);assert.equal(visible(),true);
 }finally{s.close();}
});
test('drag and keyboard focus keep the rail visible; pointer focus alone does not pin it after release',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const s=setup(),visible=()=>s.rail.classList.contains('la-scrollbar-visible');
 try{
  s.pointer(s.thumb,'pointerdown',20);t.mock.timers.tick(5000);assert.equal(visible(),true);s.pointer(s.rail,'pointerup',20);
  assert.equal(document.activeElement,s.rail);t.mock.timers.tick(1500);assert.equal(visible(),false);
  s.rail.dispatchEvent(new s.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));t.mock.timers.tick(5000);assert.equal(visible(),true);
  s.rail.blur();t.mock.timers.tick(1500);assert.equal(visible(),false);
  s.viewport.dispatchEvent(new s.dom.window.Event('scroll'));s.scrollbar.destroy();t.mock.timers.tick(5000);assert.equal(s.rail.isConnected,false);
 }finally{s.close();}
});
