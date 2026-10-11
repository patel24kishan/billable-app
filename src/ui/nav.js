// Left-rail navigation between the four views.
import { $ } from './dom.js';

export function goToView(name){
  document.querySelectorAll('.view').forEach(function(v){ v.classList.toggle('active', v.id==='view-'+name); });
  document.querySelectorAll('.nav-item').forEach(function(b){ b.classList.toggle('active', b.dataset.view===name); });
}

/** Exposes goToView for index.html's inline onclick and wires the nav clicks. */
export function bindNav(){
  window.goToView=goToView;
  $('#nav').addEventListener('click',function(e){
    var btn=e.target.closest('.nav-item'); if(!btn) return;
    goToView(btn.dataset.view);
  });
}
