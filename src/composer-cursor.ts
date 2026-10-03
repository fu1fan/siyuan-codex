type Point={node:Node;offset:number};
// Map visible editor text to DOM ranges without flattening Markdown or block references.
function textMap(root:HTMLElement){
  const chars:{value:string;start:Point;end:Point}[]=[];
  const walk=(node:Node)=>{
    if(node.nodeType===3){for(let i=0;i<(node.textContent||'').length;i++){const value=node.textContent![i];if(value!=='\u200b')chars.push({value,start:{node,offset:i},end:{node,offset:i+1}});}return;}
    if(node instanceof window.Element&&node.matches('.protyle-attr,[contenteditable="false"]:not([data-type~="block-ref"])'))return;
    if(node.nodeName==='BR'){const parent=node.parentNode!,offset=Array.from(parent.childNodes).indexOf(node as ChildNode);chars.push({value:'\n',start:{node:parent,offset},end:{node:parent,offset:offset+1}});return;}
    Array.from(node.childNodes).forEach((child,index)=>{walk(child);if(node===root&&index<node.childNodes.length-1&&child instanceof window.Element&&child.hasAttribute('data-node-id'))chars.push({value:'\n',start:{node,offset:index+1},end:{node,offset:index+1}});});
  };walk(root);return chars;
}
export function editorCursor(root:HTMLElement){
  const selection=window.getSelection();if(!selection?.rangeCount||!selection.isCollapsed)return;
  const caret=selection.getRangeAt(0);if(!root.contains(caret.startContainer))return;
  const chars=textMap(root);let offset=0;
  for(const char of chars){if(caret.comparePoint(char.end.node,char.end.offset)>0)break;offset++;}
  return {text:chars.map(c=>c.value).join(''),offset};
}
export function selectEditorRange(root:HTMLElement,start:number,end:number){
  const chars=textMap(root),range=document.createRange();
  const first=chars[start]?.start||chars.at(-1)?.end||{node:root.querySelector('[contenteditable]')||root,offset:0};
  const last=end>start?chars[end-1]?.end:first;
  range.setStart(first.node,first.offset);range.setEnd((last||first).node,(last||first).offset);
  const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);return range;
}
