import type {Reference} from './context';
export interface Composer {
  value:string;
  element:HTMLElement;
  references():Reference[];
  validate?():void;
  focus():void;
  destroy():void;
  insertReference?(ref:Reference):void;
  insertContent?(content:{html?:string;markdown?:string;text:string}):void;
  bookmark?():()=>boolean;
  extractMedia?(start?:number,capacity?:number):import('./composer-media').MediaSource[];
  cursor():{text:string;offset:number}|undefined;
  replaceRange(start:number,end:number,text:string):void;
}
export type ComposerFactory=(host:HTMLElement,onSend:()=>void,onChange:()=>void)=>Composer;
export class InputHistory {
  private items:string[]=[];private index=-1;private draft='';
  push(text:string){if(text&&this.items.at(-1)!==text)this.items.push(text);this.items=this.items.slice(-50);this.index=-1;}
  reset(){this.index=-1;}
  up(value:string){if(this.index<0){if(value.trim()||!this.items.length)return;this.draft=value;this.index=this.items.length;}this.index=Math.max(0,this.index-1);return this.items[this.index];}
  down(){if(this.index<0)return;if(++this.index>=this.items.length){this.index=-1;return this.draft;}return this.items[this.index];}
}
export const textareaComposer:ComposerFactory=(host,send,change)=>{
  const input=document.createElement('textarea');input.className='b3-text-field la-input';input.rows=3;input.placeholder='随心输入';input.setAttribute('aria-label','消息');host.append(input);
  input.oninput=change;input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}};
  const insert=(text:string)=>{input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');change();};
  return {get value(){return input.value;},set value(v){input.value=v;input.setSelectionRange(v.length,v.length);change();},element:input,references:()=>Array.from(input.value.matchAll(/\(\((\d{14}-[a-z0-9]{7})\s+['"]([^\n]*?)['"]\)\)/g)).map(m=>({id:m[1],title:m[2]})),focus:()=>input.focus(),destroy:()=>input.remove(),
    insertReference:ref=>insert(`((${ref.id} '${ref.title.replace(/'/g,'&#39;')}')) `),insertContent:content=>insert(content.markdown??content.text),
    bookmark(){const start=input.selectionStart,end=input.selectionEnd;return()=>{input.focus();input.setSelectionRange(start,end);return true;};},
    cursor:()=>input.selectionStart===input.selectionEnd?{text:input.value,offset:input.selectionStart}:undefined,
    replaceRange(start,end,text){input.setRangeText(text,start,end,'end');change();}
  };
};
