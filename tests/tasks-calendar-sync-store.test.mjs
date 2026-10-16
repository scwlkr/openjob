import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { applyTaskCalendarCommand, validateTaskCalendarProjection, projectTaskCalendar } from '../shared/task-calendar-sync.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
import { InactiveUserError } from '../db/user-history.ts';
const ROOT = 'projects/openjob-dev/databases/(default)/documents/'; const key = createPrivateKey(); const owner = 'user_alex';
const offline = () => `offline_${crypto.randomUUID()}`;
async function fixture() {
 const db = createFakeFirestore(); let clock = Date.parse('2026-10-17T00:00:00Z'); let hook;
 for (const id of [owner, 'user_sam']) db.documents.set(`${ROOT}v1UserDirectory/${id}`, { name: `${ROOT}v1UserDirectory/${id}`, updateTime: '2026-10-17T00:00:00Z', fields: { userId: { stringValue: id } } });
 const config = { projectId:'openjob-dev',clientEmail:'fixture@example.invalid',privateKey:await key }; const fetcher = async (url, init) => { const response = await hook?.(url,init); return response ?? db.fetch(url,init); };
 const reopen = () => createFirestorePersonalWorkspaceStore(config,fetcher,{now:()=>clock}); const store = reopen();
 const batch = async (projection) => { const current=await store.readTaskCalendarSync(owner); return {operationId:crypto.randomUUID(),baseRevision:current.revision,expiresAt:new Date(clock+3600000).toISOString(),projection:projection ?? current.projection}; };
 return {db,store,reopen,batch,now:()=>clock,time:value=>{clock=value;},hook:fn=>{hook=fn;}};
}
function add(projection,title='Offline task') { return applyTaskCalendarCommand(projection,{type:'task.create',title},owner,offline); }
const doc = f => f.db.documents.get(`${ROOT}v1PersonalWorkspaces/${owner}`);

test('durable sync preserves mail/grants/private provenance, stable revision and idempotent lost acknowledgement',async()=>{
 const f=await fixture(); await f.store.command(owner,{type:'mail.examples.add'}); const task=await f.store.command(owner,{type:'task.create',title:'From invented mail',messageId:'example-message-1'});
 const grant=await f.store.createAgent(owner,{name:'Planner',scopes:['tasks:read'],resourceIds:['tasks:personal']}); const initial=await f.store.readTaskCalendarSync(owner);
 assert.equal(JSON.stringify(initial).includes('sourceMessageId'),false); assert.equal(JSON.stringify(initial).includes('colleague'),false);
 await f.store.command(owner,{type:'mail.read',messageId:'example-message-1',read:true}); assert.equal((await f.store.readTaskCalendarSync(owner)).revision,initial.revision);
 let projection=applyTaskCalendarCommand(initial.projection,{type:'task.update',taskId:task.id,title:'Offline rename'},owner,offline);
 projection=applyTaskCalendarCommand(projection,{type:'task.schedule',taskId:task.id,calendarId:'personal',start:'2026-10-17T10:00:00Z',end:'2026-10-17T11:00:00Z'},owner,offline); projection=add(projection);
 const batch=await f.batch(projection); const ack=await f.store.syncTaskCalendar(owner,batch); assert.notEqual(ack.revision,initial.revision);
 const before=structuredClone(doc(f)); assert.deepEqual(await f.reopen().syncTaskCalendar(owner,batch),ack); assert.deepEqual(doc(f),before);
 const view=await f.reopen().snapshot(owner); assert.equal(view.tasks[0].sourceMessageId,'example-message-1'); assert.equal(view.messages[0].read,true); assert.equal(view.events[0].taskId,task.id); assert.equal(view.activity.filter(item=>item.action==='task-calendar.sync').length,1); assert.equal((await f.store.listAgents(owner))[0].id,grant.agent.id);
 await f.store.command(owner,{type:'task.complete',taskId:task.id,completed:true}); assert.deepEqual(await f.store.syncTaskCalendar(owner,batch),ack);
 await assert.rejects(f.store.syncTaskCalendar(owner,{...batch,projection:add(batch.projection,'Different payload')}),error=>error.code==='conflict');
});

test('concurrent sync and normal Task edit conflict on retry without losing newer work',async()=>{
 const f=await fixture(); const task=await f.store.command(owner,{type:'task.create',title:'Original'}); const batch=await f.batch(); batch.projection.tasks[0].title='Offline old edit';
 f.db.synchronizeNextCommits(); const normal=f.store.command(owner,{type:'task.update',taskId:task.id,title:'New online title'}); await f.db.waitForPendingCommits();
 const syncing=f.store.syncTaskCalendar(owner,batch); const results=await Promise.allSettled([normal,syncing]); assert.equal(results[0].status,'fulfilled'); assert.equal(results[1].status,'rejected'); assert.equal(results[1].reason.code,'conflict'); assert.equal((await f.store.snapshot(owner)).tasks[0].title,'New online title');
});

test('expiry and bounded durable receipts never allow expired unknown replay or evict active acknowledgements',async()=>{
 const f=await fixture(); const batch=await f.batch(); await assert.rejects(f.store.syncTaskCalendar(owner,{...batch,expiresAt:new Date(f.now()+86400001).toISOString()}),e=>e.code==='sync_expired');
 const ack=await f.store.syncTaskCalendar(owner,batch); f.time(Date.parse(batch.expiresAt)+1); assert.deepEqual(await f.reopen().syncTaskCalendar(owner,batch),ack);
 await assert.rejects(f.store.syncTaskCalendar(owner,{...batch,operationId:crypto.randomUUID()}),e=>e.code==='sync_expired');
 const current=doc(f); const receipts=JSON.parse(current.fields.syncJson.stringValue); for(let i=1;i<100;i++)receipts.push({...receipts[0],operationId:crypto.randomUUID()}); current.fields.syncJson.stringValue=JSON.stringify(receipts);
 await assert.rejects(f.store.syncTaskCalendar(owner,await f.batch()),e=>e.code==='workspace_capacity'); assert.equal(JSON.parse(doc(f).fields.syncJson.stringValue).length,100);
 f.time(Date.parse(receipts[0].retainUntil)+1); await assert.rejects(f.store.syncTaskCalendar(owner,batch),e=>e.code==='sync_expired');
});

test('validates ownership, unchanged calendars, new IDs, provenance, private ID collisions and corrupt receipts',async()=>{
 const f=await fixture(); await f.store.command(owner,{type:'task.create',title:'Existing'}); const batch=await f.batch(); const before=structuredClone(doc(f));
 const cases=[p=>{p.tasks[0].ownerId='user_sam';},p=>{p.calendars[0].name='Forged';},p=>{p.tasks.push({id:'client-selected',ownerId:owner,title:'Bad',completed:false});},p=>{p.tasks[0].sourceMessageId='private';},p=>{p.tasks[0].calendarEventId='missing';},p=>{p.tasks[0].id=JSON.parse(before.fields.stateJson.stringValue).activity[0].id;}];
 for(const mutate of cases){const input=structuredClone(batch);mutate(input.projection);await assert.rejects(f.store.syncTaskCalendar(owner,input));assert.deepEqual(doc(f),before);}
 await assert.rejects(f.store.syncTaskCalendar('user_sam',batch),e=>e.code==='invalid_input'); assert.equal(f.db.documents.has(`${ROOT}v1PersonalWorkspaces/user_sam`),false);
 await f.store.syncTaskCalendar(owner,batch); const document=doc(f); document.fields.syncJson.stringValue=document.fields.syncJson.stringValue.replace(owner,'user_sam'); await assert.rejects(f.store.snapshot(owner),e=>e.code==='invalid_state');
});

test('account deletion and authorization-time expiry fence sync commit; cleanup removes receipts',async()=>{
 const f=await fixture(); const batch=await f.batch(add((await f.store.readTaskCalendarSync(owner)).projection)); let fenced=false;
 f.hook(url=>{if(String(url).endsWith('documents:commit')&&!fenced){fenced=true;const user=f.db.documents.get(`${ROOT}v1UserDirectory/${owner}`);user.updateTime='2026-10-17T00:01:00Z';user.fields.deletionState={stringValue:'pending'};}});
 await assert.rejects(f.store.syncTaskCalendar(owner,batch),InactiveUserError); assert.equal(doc(f),undefined);
 const g=await fixture();const pending=await g.batch();let reads=0;g.hook(url=>{if(String(url).endsWith(`/v1UserDirectory/${owner}`)&&++reads===2)g.time(Date.parse(pending.expiresAt));});await assert.rejects(g.store.syncTaskCalendar(owner,pending),e=>e.code==='sync_expired');assert.equal(doc(g),undefined);
});

test('pure reducer supports full linked CRUD atomically without mutating projection or command',()=>{
 const projection={tasks:[],calendars:[{id:'personal',ownerId:owner,name:'Personal',color:'#2454dc'}],events:[]}; const command={type:'task.create',title:'  Offline  '}; let next=applyTaskCalendarCommand(projection,command,owner,offline); assert.equal(command.title,'  Offline  ');assert.equal(projection.tasks.length,0);
 const task=next.tasks[0];next=applyTaskCalendarCommand(next,{type:'task.schedule',taskId:task.id,calendarId:'personal',start:'2026-10-17T10:00:00Z',end:'2026-10-17T11:00:00Z'},owner,offline);
 next=applyTaskCalendarCommand(next,{type:'calendar.update',eventId:next.events[0].id,title:'Updated block',start:'2026-10-17T12:00:00Z',end:'2026-10-17T13:00:00Z'},owner,offline);assert.equal(next.tasks[0].scheduledSlot.start,next.events[0].start);
 next=applyTaskCalendarCommand(next,{type:'task.complete',taskId:task.id,completed:true},owner,offline);next=applyTaskCalendarCommand(next,{type:'task.unschedule',taskId:task.id},owner,offline);assert.equal(next.events.length,0);assert.equal(next.tasks[0].completed,true);
 next=applyTaskCalendarCommand(next,{type:'calendar.create',calendarId:'personal',title:'Block',start:'2026-10-17T12:00:00Z',end:'2026-10-17T13:00:00Z'},owner,offline);next=applyTaskCalendarCommand(next,{type:'calendar.delete',eventId:next.events[0].id},owner,offline);next=applyTaskCalendarCommand(next,{type:'task.delete',taskId:task.id},owner,offline);assert.equal(next.tasks.length,0);
 assert.throws(()=>applyTaskCalendarCommand(projection,{type:'mail.examples.add'},owner,offline)); assert.throws(()=>applyTaskCalendarCommand(projection,{type:'task.create',title:'No source',messageId:'private'},owner,offline)); assert.throws(()=>validateTaskCalendarProjection(owner,{...projection,mail:[]})); assert.deepEqual(projectTaskCalendar(owner,{...projection,accounts:[],messages:[],drafts:[],sent:[],agents:[],activity:[]}),projection);
});

test('independent instances accept one concurrent operation exactly once and deletion cleanup removes receipt envelope',async()=>{
 const f=await fixture(); const batch=await f.batch(add((await f.store.readTaskCalendarSync(owner)).projection)); f.db.synchronizeNextCommits();
 const [one,two]=await Promise.all([f.store.syncTaskCalendar(owner,batch),f.reopen().syncTaskCalendar(owner,batch)]); assert.deepEqual(one,two);assert.equal((await f.store.snapshot(owner)).activity.filter(item=>item.action==='task-calendar.sync').length,1);assert.equal(JSON.parse(doc(f).fields.syncJson.stringValue).length,1);
 f.db.documents.get(`${ROOT}v1UserDirectory/${owner}`).fields.deletionState={stringValue:'pending'};
 await assert.rejects(f.store.syncTaskCalendar(owner,batch),InactiveUserError);assert.equal(await f.store.removeAllForUser(owner),1);assert.equal(doc(f),undefined);assert.equal(await f.store.removeAllForUser(owner),0);
});
