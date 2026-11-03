import test from 'node:test';
import assert from 'node:assert/strict';
import {NodeApiClient} from '../src/dsh-client.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
class Socket {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
  static instances = [];
  constructor() { this.readyState = 0; this.frames = []; this.listeners = new Map(); Socket.instances.push(this); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, event = {}) { for (const fn of [...(this.listeners.get(type) || [])]) fn(event); }
  send(data) { this.frames.push(JSON.parse(data)); }
  open() { this.readyState = 1; this.emit('open'); }
  close() { this.readyState = 3; this.emit('close'); }
  frame(value) { this.emit('message', {data: JSON.stringify(value)}); }
  follows(id) { return this.frames.filter(f => f.endpoint === 'session/follow' && f.payload.args.request.address.sessionId === id); }
}
async function fixture(t) {
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  const api = new NodeApiClient('http://127.0.0.1:9', 1000, {});
  api.ensureAuth = async () => { api.cookie = 'synthetic-cookie'; };
  const streams = [];
  t.after(async () => {
    for (const {abort, iterator, pending} of streams) { abort.abort(); await pending.catch(() => {}); await iterator.return(); }
    globalThis.WebSocket = previous;
  });
  api.events.follow('bad'); api.events.follow('healthy');
  const open = async () => {
    const abort = new AbortController();
    const iterator = api.events.mux({}, abort.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    streams.push({abort, iterator, pending});
    await tick();
    const socket = Socket.instances.at(-1); socket.open();
    return {abort, iterator, pending, socket};
  };
  return {api, open, ...await open()};
}
const failure = (socket, error) => socket.frame({type: 'error', streamId: socket.follows('bad').at(-1).streamId, error});
const event = (socket, id = 'healthy') => socket.frame({type: 'item', streamId: socket.follows(id).at(-1).streamId,
  value: {type: 'event', event: {type: 'turn/end', seq: 9, data: {}}}});

test('a corrupt stored session leaves healthy follow and approval streams alive', async t => {
  const f = await fixture(t);
  failure(f.socket, {code: 'gateway/internal', message: 'stored session "bad" is corrupt: SessionFormatError: synthetic'});
  const error = await f.pending;
  assert.equal(error.value.payload.type, 'stream/error');
  assert.equal(error.value.payload.sessionId, 'bad');
  const next = f.iterator.next(); event(f.socket);
  const healthy = await next;
  assert.equal(healthy.done, false);
  assert.equal(healthy.value.payload.sessionId, 'healthy');
  assert.equal(f.socket.readyState, Socket.OPEN);
  assert.equal(f.api.cookie, 'synthetic-cookie', 'one session failure must not invalidate shared authentication');
  const approval = f.iterator.next();
  const control = f.socket.frames.find(frame => frame.endpoint === '$events');
  f.socket.frame({type: 'item', streamId: control.streamId, value: {type: 'ready', clientId: 'synthetic-client'}});
  f.socket.frame({type: 'item', streamId: control.streamId, value: {type: 'waterfall', event: 'approval/request',
    eventId: 'synthetic-event', agentId: 'healthy', request: {toolName: 'fixture', callId: 'fixture-call'}}});
  assert.equal((await approval).value.payload.type, 'approval/requested');
});

test('corrupt follows are quarantined across transport reconnect until explicitly retried', async t => {
  const f = await fixture(t);
  failure(f.socket, {code: 'gateway/internal', message: 'stored log is corrupt: synthetic'});
  await f.pending;
  const finished = f.iterator.next(); f.socket.close(); await finished;
  const second = await f.open();
  assert.equal(second.socket.follows('bad').length, 0);
  assert.equal(second.socket.follows('healthy').length, 1);
  f.api.events.follow('bad');
  assert.equal(second.socket.follows('bad').length, 1, 'explicit follow after repair retries the same session ID');
});

test('transient session errors retry only that session with bounded backoff', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = await fixture(t);
  failure(f.socket, {code: 'gateway/internal', message: 'synthetic temporary failure'});
  await f.pending;
  const live = f.iterator.next(); event(f.socket); await live;
  t.mock.timers.tick(1999); assert.equal(f.socket.follows('bad').length, 1);
  t.mock.timers.tick(1); assert.equal(f.socket.follows('bad').length, 2);
  const secondError = f.iterator.next(); failure(f.socket, {code: 'gateway/internal', message: 'synthetic temporary failure'}); await secondError;
  t.mock.timers.tick(3999); assert.equal(f.socket.follows('bad').length, 2);
  t.mock.timers.tick(1); assert.equal(f.socket.follows('bad').length, 3);
  assert.equal(f.socket.follows('healthy').length, 1);
  assert.equal(f.socket.frames.filter(frame => frame.endpoint === '$events').length, 1);
  assert.equal(f.socket.readyState, Socket.OPEN);
});

test('forget cancels retries and a missing session never restarts the shared transport', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = await fixture(t);
  failure(f.socket, {code: 'gateway/internal', message: 'synthetic temporary failure'}); await f.pending;
  f.api.events.forget('bad');
  t.mock.timers.tick(60000); assert.equal(f.socket.follows('bad').length, 1);
  f.api.events.follow('bad');
  const error = f.iterator.next(); failure(f.socket, {code: 'session/not-found', message: 'synthetic missing'}); await error;
  assert.equal(f.api._desiredFollows.has('bad'), false);
  const live = f.iterator.next(); event(f.socket); assert.equal((await live).done, false);
  assert.equal(f.socket.readyState, Socket.OPEN);
});

test('closing a transport cancels its pending per-session retry', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = await fixture(t);
  failure(f.socket, {code: 'gateway/internal', message: 'synthetic temporary failure'}); await f.pending;
  const done = f.iterator.next(); f.abort.abort(); await done;
  const count = f.socket.frames.length;
  t.mock.timers.tick(60000);
  assert.equal(f.socket.frames.length, count);
  assert.equal(f.socket.readyState, Socket.CLOSED);
});
