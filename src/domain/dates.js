// Date and duration helpers. Pure: no DOM, no store.

/** Local 'YYYY-MM-DD' for a Date or an ISO string (never the UTC date). */
export function localDateStr(d){ if(!(d instanceof Date)) d=new Date(d); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
export function todayStr(d = new Date()){ return localDateStr(d); }
export function fmtDateShort(iso){ var p=iso.split('-'); var d=new Date(+p[0],+p[1]-1,+p[2]); return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
export function fmtDuration(sec){ sec=Math.max(0,Math.round(sec)); var h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60; return [h,m,s].map(function(v){return String(v).padStart(2,'0');}).join(':'); }
export function hoursFromSeconds(sec){ return Math.round((sec/3600)*100)/100; }
export function monthRange(monthStr){ // 'YYYY-MM'
  var p=monthStr.split('-'); var y=+p[0], m=+p[1];
  var start=y+'-'+String(m).padStart(2,'0')+'-01';
  var lastDay=new Date(y,m,0).getDate();
  var end=y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
  return {start:start,end:end};
}
export function monthLabel(monthStr){ var p=monthStr.split('-'); var d=new Date(+p[0],+p[1]-1,1); return d.toLocaleDateString('en-US',{month:'long',year:'numeric'}); }
/** Local 'YYYY-MM' for the given date (the invoice month default). */
export function currentMonthStr(d = new Date()){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
