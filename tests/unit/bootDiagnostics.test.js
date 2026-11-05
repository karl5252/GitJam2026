import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {attachBootDiagnostics, watchBoot} from '../helpers/bootDiagnostics.js';

/** Enough of a Playwright page for the watcher: on/off and evaluate. */
class FakePage extends EventEmitter {
    evaluate = async () => ({readyState: 'complete'});
    mainFrame = () => this.frame;
    frame = {url: () => 'http://x/?testMode'};
    off(name, handler) {
        return this.removeListener(name, handler);
    }
}

const EVENTS = ['console', 'pageerror', 'request', 'requestfinished', 'requestfailed', 'response', 'domcontentloaded', 'load', 'framenavigated', 'crash', 'close'];
const request = (url, failure) => ({url: () => url, failure: () => failure});

test('stop removes every listener it added', () => {
    const page = new FakePage();
    const watch = watchBoot(page);
    for (const name of EVENTS) assert.equal(page.listenerCount(name), 1, name);
    watch.stop();
    for (const name of EVENTS) assert.equal(page.listenerCount(name), 0, name);
});

test('it records errors and milestones, and ignores ordinary console output', () => {
    const page = new FakePage();
    const watch = watchBoot(page);
    page.emit('console', {type: () => 'log', text: () => 'noise'});
    page.emit('console', {type: () => 'error', text: () => 'broken'});
    page.emit('pageerror', new Error('thrown'));
    page.emit('domcontentloaded');
    page.emit('load');
    page.emit('response', {status: () => 200, url: () => 'ok'});
    page.emit('response', {status: () => 404, url: () => 'missing.js'});
    page.emit('crash');
    const types = watch.report().events.map((e) => e.type);
    assert.deepEqual(types, ['console.error', 'pageerror', 'domcontentloaded', 'load', 'http-error', 'crash']);
    watch.stop();
});

test('it tells finished, failed and still-pending requests apart', () => {
    const page = new FakePage();
    const watch = watchBoot(page);
    const done = request('done.js');
    const failed = request('failed.js', {errorText: 'net::ERR_FAILED'});
    page.emit('request', done);
    page.emit('request', failed);
    page.emit('request', request('stuck.js'));
    page.emit('requestfinished', done);
    page.emit('requestfailed', failed);
    const report = watch.report();
    assert.deepEqual(report.pendingRequests, ['stuck.js']);
    assert.match(report.events[0].detail, /failed\.js net::ERR_FAILED/);
    watch.stop();
});

test('only main-frame navigation is noted', () => {
    const page = new FakePage();
    const watch = watchBoot(page);
    page.emit('framenavigated', {url: () => 'other'});
    page.emit('framenavigated', page.frame);
    assert.deepEqual(watch.report().events.map((e) => e.detail), ['http://x/?testMode']);
    watch.stop();
});

test('recording is bounded in count and text length', () => {
    const page = new FakePage();
    const watch = watchBoot(page);
    for (let i = 0; i < 500; i++) page.emit('pageerror', new Error('x'.repeat(1000)));
    const report = watch.report();
    assert.equal(report.events.length, 200);
    assert.equal(report.droppedEvents, 300);
    assert.equal(report.events[0].detail.length, 200);
    watch.stop();
});

test('reports are detached from later events', () => {
    const page = new FakePage();
    const watch = watchBoot(page);
    page.emit('load');
    const report = watch.report();
    page.emit('crash');
    assert.equal(report.events.length, 1);
    watch.stop();
});

test('a failed boot attaches the timeline, the snapshot and the original error', async () => {
    const page = new FakePage();
    const watch = watchBoot(page);
    page.emit('load');
    const attached = [];
    await attachBootDiagnostics({
        page,
        watch,
        error: new Error('data-scene never appeared\nmore detail'),
        testInfo: {attach: async (name, options) => attached.push({name, options})},
    });
    watch.stop();
    assert.equal(attached[0].name, 'boot-diagnostics.json');
    const body = JSON.parse(attached[0].options.body);
    assert.equal(body.error, 'data-scene never appeared');
    assert.equal(body.events[0].type, 'load');
    assert.deepEqual(body.page, {readyState: 'complete'});
});

test('terminal colour codes are stripped from recorded text', async () => {
    const page = new FakePage();
    const watch = watchBoot(page);
    let body = null;
    await attachBootDiagnostics({page, watch, error: new Error('\u001b[2mexpect\u001b[22m failed'), testInfo: {attach: async (_, o) => { body = JSON.parse(o.body); }}});
    watch.stop();
    assert.equal(body.error, 'expect failed');
});

test('a page that cannot be inspected is reported, not fatal', async () => {
    const page = new FakePage();
    page.evaluate = async () => { throw new Error('Target closed'); };
    const watch = watchBoot(page);
    let body = null;
    await attachBootDiagnostics({page, watch, error: new Error('x'), testInfo: {attach: async (_, o) => { body = JSON.parse(o.body); }}});
    watch.stop();
    assert.deepEqual(body.page, {unavailable: 'Target closed'});
});

test('a hanging page cannot stall the failure path', async () => {
    const page = new FakePage();
    page.evaluate = () => new Promise(() => {});
    const watch = watchBoot(page);
    let body = null;
    const started = Date.now();
    await attachBootDiagnostics({page, watch, error: new Error('x'), testInfo: {attach: async (_, o) => { body = JSON.parse(o.body); }}});
    watch.stop();
    assert.ok(Date.now() - started < 3000);
    assert.deepEqual(body.page, {unavailable: 'snapshot timed out'});
});

test('a broken attachment never throws, so the original failure survives', async () => {
    const page = new FakePage();
    const watch = watchBoot(page);
    await assert.doesNotReject(attachBootDiagnostics({
        page, watch, error: new Error('x'), testInfo: {attach: async () => { throw new Error('disk full'); }},
    }));
    await assert.doesNotReject(attachBootDiagnostics({page, watch, error: new Error('x')})); // no test running
    watch.stop();
});
