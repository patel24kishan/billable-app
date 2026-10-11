// The timer state machine as pure transitions. No store, no DOM, no guards:
// callers decide when a transition is allowed, exactly as before.

import { localDateStr } from './dates.js';

export const IDLE_TIMER = Object.freeze({ status:'idle', clientId:null, clientName:'', description:'', accumulatedSeconds:0, segmentStartedAt:null, startedAt:null });

export const TIMER_LABELS = { running:'Tracking', paused:'Paused', stopped:'Ready to save' };

export function sessionElapsedSeconds(timer, nowMs = Date.now()){
  var base = timer.accumulatedSeconds||0;
  if(timer.status==='running' && timer.segmentStartedAt){
    base += (nowMs-new Date(timer.segmentStartedAt).getTime())/1000;
  }
  return base;
}

/** The full timer doc for a fresh running session. */
export function startTimer({ clientId, clientName, description }, nowIso){
  return {
    status:'running', clientId:clientId, clientName:clientName, description:description,
    accumulatedSeconds:0, segmentStartedAt:nowIso, startedAt:nowIso
  };
}

export function pauseTimer(timer, nowMs = Date.now()){
  return Object.assign({}, timer, { status:'paused', accumulatedSeconds:sessionElapsedSeconds(timer, nowMs), segmentStartedAt:null });
}

export function resumeTimer(timer, nowIso){
  return Object.assign({}, timer, { status:'running', segmentStartedAt:nowIso });
}

export function stopTimer(timer, nowMs = Date.now()){
  return Object.assign({}, timer, { status:'stopped', accumulatedSeconds:sessionElapsedSeconds(timer, nowMs), segmentStartedAt:null });
}

/** The time entry a stopped session saves as. */
export function entryFromStoppedTimer(timer, nowIso){
  var seconds=Math.round(timer.accumulatedSeconds||0);
  return {
    seconds: seconds,
    entry: {
      clientId:timer.clientId, clientName:timer.clientName,
      date:localDateStr(timer.startedAt||nowIso), description:timer.description||'', seconds:seconds,
      invoiced:false, createdAt:nowIso
    }
  };
}
