export type MenuTrigger={kind:'function'|'add';start:number;end:number;query:string};
export function menuTrigger(text:string,offset:number):MenuTrigger|undefined{
  const before=text.slice(0,offset);
  const at=before.lastIndexOf('@');
  if(at>=0&&!/[\n@]/.test(before.slice(at+1)))return {kind:'add',start:at,end:offset,query:before.slice(at+1)};
  if(text.startsWith('/')&&!/[\n/]/.test(before.slice(1))&&offset>0)return {kind:'function',start:0,end:offset,query:before.slice(1)};
}
export function menuMatches(query:string,...values:string[]){
  const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f\s_\-]/g,'').toLowerCase();
  const q=normalize(query);return values.some(value=>normalize(value).includes(q));
}
