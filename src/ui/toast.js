// The single toast at the bottom of the page.
import { $ } from './dom.js';

let hideTimer;

export function toast(msg,type){
  var el=$('#toast'); el.textContent=msg; el.className='toast'+(type?(' '+type):''); el.hidden=false;
  clearTimeout(hideTimer); hideTimer=setTimeout(function(){el.hidden=true;},3800);
}
