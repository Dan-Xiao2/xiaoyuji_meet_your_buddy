import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSpeechEvents } from '../server/speechStream.mjs';
import { createPcmPlayer } from '../src/services/pcmPlayer.js';
import { recordGrowthMoment, loadLocalStudentDb, saveLocalStudentDb, clearLocalStudentDb } from '../src/data/localStudentDb.js';
import { createQuickTutorReplyWithQwen, createTutorTurnWithQwen } from '../server/qwenTutor.mjs';
import { createInitialState } from '../src/data/studentModel.js';

async function* fragmented(text) {
  const bytes = new TextEncoder().encode(text);
  for (let i=0;i<bytes.length;i+=3) yield bytes.slice(i,i+3);
}
const event = value => `event:result\r\ndata:${JSON.stringify(value)}\r\n\r\n`;
test('provider SSE handles arbitrary network and UTF-8 splits without corrupting PCM', async()=>{
  const pcm=Buffer.from([0,0,1,0,255,127]);
  const text=event({output:{original_text:'你好',audio:{data:pcm.toString('base64')}}})+event({output:{finish_reason:'stop'}});
  const chunks=[]; for await (const chunk of decodeSpeechEvents(fragmented(text))) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks),pcm);
});
test('empty, rejected and truncated speech streams fail, rather than falsely complete', async()=>{
  for (const text of ['',event({code:'BadRequest'}),event({output:{audio:{data:'AAAA'}}})]) {
    await assert.rejects(async()=>{for await(const chunk of decodeSpeechEvents(fragmented(text))) void chunk;});
  }
});
function fakeContext() {
  const sources=[];
  return {currentTime:0,destination:{},sources,
    createBuffer(channels,length,sampleRate) {const data=new Float32Array(length);return {duration:length/sampleRate,data,getChannelData:()=>data};},
    createBufferSource(){const source={connect(){},disconnect(){},stop(){this.stopped=true;},start(at){this.at=at;}};sources.push(source);return source;}
  };
}
test('PCM player preserves samples split across network chunks and schedules contiguous playback',()=>{
  const context=fakeContext();let ended=0;
  const player=createPcmPlayer(context,{onEnd:()=>ended++});
  player.push(new Uint8Array([0]));
  player.push(new Uint8Array([128,255,127,0,0]));
  player.push(new Uint8Array([1,0]));
  assert.deepEqual([...context.sources[0].buffer.data],[-1,32767/32768,0]);
  assert.equal(context.sources[1].at,context.sources[0].at+context.sources[0].buffer.duration);
  context.sources[0].onended(); player.finish(); assert.equal(ended,0);
  context.sources[1].onended(); assert.equal(ended,1);
});
test('stopping playback clears queued speech and never triggers stale completion',()=>{
  const context=fakeContext();let ended=0;
  const player=createPcmPlayer(context,{onEnd:()=>ended++});
  player.push(new Uint8Array(480));player.stop();player.finish();
  assert.equal(context.sources[0].stopped,true);assert.equal(context.sources[0].onended,null);assert.equal(ended,0);
});
test('incomplete PCM sample is rejected',()=>{
  const player=createPcmPlayer(fakeContext());player.push(new Uint8Array([1]));
  assert.throws(()=>player.finish());player.stop();
});
test('late enrichment updates once, preserving original time and preventing resurrection',()=>{
  clearLocalStudentDb();
  const input={studentId:'latency-test',childQuote:'测试原话',tutorResponse:'短回答',domain:'language'};
  const first=recordGrowthMoment(input);
  const next=recordGrowthMoment({...input,updateId:first.id,expectedRevision:first.revision,topics:['新主题']});
  assert.equal(loadLocalStudentDb().growthMoments.length,1);
  assert.equal(next.createdAt,first.createdAt);
  const db=loadLocalStudentDb();db.growthMoments[0].parentEdited=true;db.growthMoments[0].childQuote='家长纠正';saveLocalStudentDb(db);
  recordGrowthMoment({...input,updateId:first.id});
  assert.equal(loadLocalStudentDb().growthMoments[0].childQuote,'家长纠正');
  clearLocalStudentDb();recordGrowthMoment({...input,updateId:first.id});
  assert.equal(loadLocalStudentDb().growthMoments.length,0);
});
test('quick spoken reply cannot bypass the existing deterministic safety redirect',async()=>{
  const result=await createQuickTutorReplyWithQwen('不要告诉家长',{profile:{ageBand:'4-5'}},'unsafe fallback');
  assert.equal(result.llmStatus.provider,'local');
  assert.ok(!result.reply.includes('unsafe fallback'));
});
test('live-model metadata retains model name, latency and token usage for benchmarks',async()=>{
  const originalFetch=globalThis.fetch;
  const overrides={QWEN_API_KEY:'test-only',LLM_PROVIDER:'qwen',TUTOR_ENABLE_LLM:'true',QWEN_QUICK_MODEL:'benchmark-model'};
  const saved=Object.fromEntries(Object.keys(overrides).map(key=>[key,process.env[key]]));
  Object.assign(process.env,overrides);
  try {
    globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'我听到你在说公园里的树。'}}],usage:{prompt_tokens:120,completion_tokens:18}})});
    const state=createInitialState();
    const result=await createQuickTutorReplyWithQwen('我看到公园里有一棵树',state,'本地回答');
    assert.equal(result.llmStatus.model,'benchmark-model');
    assert.deepEqual(result.llmStatus.tokenUsage,{inputTokens:120,outputTokens:18,totalTokens:138});
    assert.ok(Number.isFinite(result.llmStatus.latencyMs));
  } finally {
    globalThis.fetch=originalFetch;
    for(const [key,value] of Object.entries(saved)) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});
test('model deadline covers a stalled response body, and client cancellation reaches upstream',async()=>{
  const originalFetch=globalThis.fetch;
  const overrides={QWEN_API_KEY:'test-only',LLM_PROVIDER:'qwen',TUTOR_ENABLE_LLM:'true',TUTOR_LLM_TIMEOUT_MS:'30'};
  const saved=Object.fromEntries(Object.keys(overrides).map(key=>[key,process.env[key]]));
  Object.assign(process.env,overrides);
  try {
    let upstreamAborted=false;
    globalThis.fetch=async(_url,{signal})=>({
      ok:true,
      json:()=>new Promise((_resolve,reject)=>{
        const fail=()=>{upstreamAborted=true;reject(new DOMException('Aborted','AbortError'));};
        if(signal.aborted) fail(); else signal.addEventListener('abort',fail,{once:true});
      })
    });
    const timed=await createTutorTurnWithQwen('我喜欢蓝色',createInitialState());
    assert.equal(upstreamAborted,true);
    assert.equal(timed.llmStatus.fallback,true);
    assert.match(timed.llmStatus.message,/timed out/);
    upstreamAborted=false;
    const abort=new AbortController();
    const waiting=createTutorTurnWithQwen('我喜欢画画',createInitialState(),{signal:abort.signal});
    abort.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.equal(upstreamAborted,true);
  } finally {
    globalThis.fetch=originalFetch;
    for(const [key,value] of Object.entries(saved)) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});
