import test from "node:test";
import assert from "node:assert/strict";
import { buildRacePlan } from "../src/race-engine.js";

const players=[1,2,3,4].map(i=>({id:`p${i}`,name:`马${i}`,horse:{stats:{speed:60+i*4,stamina:65+i,burst:62+i*2,luck:60+i}}}));

test("race plan is a visible 12 second process with many frames",()=>{
  const race=buildRacePlan(players,"1234",1700000000000);
  assert.equal(race.durationMs,12000);
  assert.ok(race.frames.length>=50);
  assert.equal(race.frames[0].positions.every(v=>v===0),true);
  assert.equal(race.frames.at(-1).positions.every(v=>v===1),true);
  assert.equal(race.order.length,players.length);
});

test("positions never jump backwards",()=>{
  const race=buildRacePlan(players,"5678",1700000000123);
  for(let p=0;p<players.length;p++)for(let i=1;i<race.frames.length;i++)assert.ok(race.frames[i].positions[p]>=race.frames[i-1].positions[p]);
});
