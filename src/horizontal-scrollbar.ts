let scrollbarID=0;

/** A thin rail for a native horizontal scroll viewport, independent of OS scrollbar settings. */
export class HorizontalScrollbar {
  readonly element=document.createElement('div');
  private thumb=document.createElement('span');
  private drag?:{id:number;offset:number};
  private destroyed=false;
  private hideTimer?:ReturnType<typeof setTimeout>;
  private regionNear=false;private railNear=false;private keyboardFocused=false;private pointerFocusing=false;
  constructor(private viewport:HTMLElement,private hoverRegion:HTMLElement=viewport){
    this.element.className='la-session-scrollbar';this.thumb.className='la-session-scrollbar-thumb';
    this.element.hidden=true;this.element.tabIndex=0;
    this.element.setAttribute('role','scrollbar');this.element.setAttribute('aria-label','会话标签横向滚动');this.element.setAttribute('aria-orientation','horizontal');this.element.setAttribute('aria-valuemin','0');
    if(!viewport.id)viewport.id='la-session-tabs-'+(++scrollbarID);
    this.element.setAttribute('aria-controls',viewport.id);this.element.append(this.thumb);
    viewport.addEventListener('scroll',this.scrolled);viewport.addEventListener('wheel',this.wheel,{passive:false});
    hoverRegion.addEventListener('pointerenter',this.regionEnter);hoverRegion.addEventListener('pointerleave',this.regionLeave);
    this.element.addEventListener('pointerenter',this.railEnter);this.element.addEventListener('pointerleave',this.railLeave);this.element.addEventListener('focus',this.focus);this.element.addEventListener('blur',this.blur);
    this.element.addEventListener('wheel',this.wheel,{passive:false});
    this.element.addEventListener('pointerdown',this.down);this.element.addEventListener('pointermove',this.move);this.element.addEventListener('pointerup',this.up);this.element.addEventListener('pointercancel',this.up);this.element.addEventListener('lostpointercapture',this.lostCapture);this.element.addEventListener('keydown',this.keydown);
  }
  private get maximum(){return Math.max(0,this.viewport.scrollWidth-this.viewport.clientWidth);}
  private clearHideTimer(){if(this.hideTimer!==undefined)clearTimeout(this.hideTimer);this.hideTimer=undefined;}
  private scheduleHide(){
    this.clearHideTimer();
    if(this.destroyed||this.element.hidden||this.regionNear||this.railNear||this.keyboardFocused||this.drag)return;
    this.hideTimer=setTimeout(()=>{this.hideTimer=undefined;if(!this.destroyed&&!this.regionNear&&!this.railNear&&!this.keyboardFocused&&!this.drag)this.element.classList.remove('la-scrollbar-visible');},1500);
  }
  private reveal(){if(this.destroyed||this.element.hidden)return;this.element.classList.add('la-scrollbar-visible');this.scheduleHide();}
  private regionEnter=()=>{this.regionNear=true;this.reveal();};
  private regionLeave=()=>{this.regionNear=false;this.scheduleHide();};
  private railEnter=()=>{this.railNear=true;this.reveal();};
  private railLeave=()=>{this.railNear=false;this.scheduleHide();};
  private focus=()=>{this.keyboardFocused=!this.pointerFocusing&&this.element.matches(':focus-visible');this.reveal();};
  private blur=()=>{this.keyboardFocused=false;this.scheduleHide();};
  private scrolled=()=>{this.update();this.reveal();};
  private geometry(){
    const width=this.element.clientWidth;
    const thumb=Math.min(width,Math.max(24,width*this.viewport.clientWidth/Math.max(1,this.viewport.scrollWidth)));
    return {width,thumb,travel:Math.max(0,width-thumb)};
  }
  update=()=>{
    if(this.destroyed)return;
    const max=this.maximum,wasHidden=this.element.hidden;
    this.element.hidden=max<=1;
    this.element.setAttribute('aria-valuemax',String(Math.round(max)));
    const value=Math.min(max,Math.max(0,this.viewport.scrollLeft));
    this.element.setAttribute('aria-valuenow',String(Math.round(value)));
    this.element.setAttribute('aria-valuetext',max?Math.round(value/max*100)+'%':'0%');
    const {thumb,travel}=this.geometry();
    this.thumb.style.width=thumb+'px';this.thumb.style.transform=`translateX(${max?value/max*travel:0}px)`;
    if(this.element.hidden&&this.drag)this.endDrag();
    if(this.element.hidden){this.clearHideTimer();this.element.classList.remove('la-scrollbar-visible');}else if(wasHidden)this.reveal();
  };
  private scrollTo(value:number){this.viewport.scrollLeft=Math.min(this.maximum,Math.max(0,value));this.update();this.reveal();}
  private down=(e:PointerEvent)=>{
    if(e.button!==0||this.drag||this.element.hidden)return;
    e.preventDefault();e.stopPropagation();this.keyboardFocused=false;this.pointerFocusing=true;
    try{this.element.focus({preventScroll:true});}finally{this.pointerFocusing=false;}
    const {thumb}=this.geometry();
    this.drag={id:e.pointerId,offset:e.target===this.thumb?e.clientX-this.thumb.getBoundingClientRect().left:thumb/2};
    this.element.classList.add('la-scrollbar-dragging');this.reveal();this.element.setPointerCapture?.(e.pointerId);this.move(e);
  };
  private move=(e:PointerEvent)=>{
    if(!this.drag||e.pointerId!==this.drag.id)return;
    const {travel}=this.geometry();
    if(travel)this.scrollTo((e.clientX-this.element.getBoundingClientRect().left-this.drag.offset)/travel*this.maximum);
  };
  private endDrag(){
    const id=this.drag?.id;this.drag=undefined;this.element.classList.remove('la-scrollbar-dragging');
    if(id!==undefined&&this.element.hasPointerCapture?.(id))this.element.releasePointerCapture(id);
    this.scheduleHide();
  }
  private up=(e:PointerEvent)=>{if(e.pointerId===this.drag?.id)this.endDrag();};
  private lostCapture=()=>{this.drag=undefined;this.element.classList.remove('la-scrollbar-dragging');this.scheduleHide();};
  private wheel=(e:WheelEvent)=>{
    // Leave trackpad horizontal gestures and Ctrl+wheel zoom to the browser.
    const onRail=e.currentTarget===this.element,delta=onRail?(e.deltaX||e.deltaY):e.deltaY;
    if(e.ctrlKey||(!onRail&&(e.shiftKey||e.deltaX))||!delta||this.maximum<=1)return;
    const scale=e.deltaMode===1?16:e.deltaMode===2?this.viewport.clientWidth:1;
    const next=Math.min(this.maximum,Math.max(0,this.viewport.scrollLeft+delta*scale));
    if(next===this.viewport.scrollLeft)return;
    e.preventDefault();this.scrollTo(next);
  };
  private keydown=(e:KeyboardEvent)=>{
    let value:number|undefined;const page=this.viewport.clientWidth*.9;
    if(e.key==='ArrowLeft')value=this.viewport.scrollLeft-40;
    if(e.key==='ArrowRight')value=this.viewport.scrollLeft+40;
    if(e.key==='PageUp')value=this.viewport.scrollLeft-page;
    if(e.key==='PageDown')value=this.viewport.scrollLeft+page;
    if(e.key==='Home')value=0;if(e.key==='End')value=this.maximum;
    if(value!==undefined){e.preventDefault();e.stopPropagation();this.keyboardFocused=true;this.scrollTo(value);}
  };
  destroy(){
    this.destroyed=true;this.clearHideTimer();this.endDrag();this.viewport.removeEventListener('scroll',this.scrolled);this.viewport.removeEventListener('wheel',this.wheel);
    this.hoverRegion.removeEventListener('pointerenter',this.regionEnter);this.hoverRegion.removeEventListener('pointerleave',this.regionLeave);
    this.element.removeEventListener('pointerenter',this.railEnter);this.element.removeEventListener('pointerleave',this.railLeave);this.element.removeEventListener('focus',this.focus);this.element.removeEventListener('blur',this.blur);
    this.element.removeEventListener('wheel',this.wheel);
    this.element.removeEventListener('pointerdown',this.down);this.element.removeEventListener('pointermove',this.move);this.element.removeEventListener('pointerup',this.up);this.element.removeEventListener('pointercancel',this.up);this.element.removeEventListener('lostpointercapture',this.lostCapture);this.element.removeEventListener('keydown',this.keydown);this.element.remove();
  }
}
