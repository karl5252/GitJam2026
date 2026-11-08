import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OfficeMenuLayer} from '../../src/scenes/OfficeMenuLayer.js';
import {OFFICE} from '../../src/scenes/OfficeMenuArt.js';

const texturePath = new URL('../../public/assets/sprites/menu-office/', import.meta.url);
const pngSize = (filename) => {
    const bytes = readFileSync(new URL(filename, texturePath));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

const createGameObject = (type, args) => ({
    type, args, destroyed: false, visible: true, frame: 0,
    setDepth(depth) {this.depth = depth; return this;},
    setTileScale(x, y) {this.tileScale = [x, y]; return this;},
    setOrigin(x, y) {this.origin = [x, y]; return this;},
    setScale(scale) {this.scale = scale; return this;},
    setFrame(frame) {this.frame = frame; return this;},
    setPosition(x, y) {this.position = [x, y]; return this;},
    setVisible(visible) {this.visible = visible; return this;},
    setFlipX(flipX) {this.flipX = flipX; return this;},
    destroy() {this.destroyed = true;},
});

const testScene = (touch = false) => {
    const objects = [];
    const make = (type) => (...args) => {
        const object = createGameObject(type, args);
        objects.push(object);
        return object;
    };
    return {
        scale: {width: 1280, height: 720}, layout: {touch},
        add: {
            tileSprite: make('tileSprite'),
            rectangle: make('rectangle'),
            image: make('image'),
            sprite: make('sprite'),
        },
        objects,
    };
};

test('menu uses the complete artwork frames, not assumed 16x16 thumbnails', () => {
    assert.deepEqual(pngSize('phone-sheet.png'), [408, 50]);
    assert.deepEqual(pngSize('flag-sheet.png'), [32, 192]);
    assert.deepEqual(pngSize('el-colonel-menu-sheet.png'), [448, 224]);
    assert.deepEqual(pngSize('wall-top.png'), [32, 32]);
    assert.deepEqual(pngSize('wall-bottom.png'), [32, 32]);
    assert.deepEqual(pngSize('floor-parquet.png'), [32, 32]);
});

test('desktop creates all office props, runs the phone and salutes the portrait', () => {
    const scene = testScene();
    const menu = new OfficeMenuLayer(scene);
    assert.equal(menu.flags.length, 2);
    const keys = scene.objects.filter((o) => ['image', 'sprite'].includes(o.type)).map((o) => o.args[2]);
    for (const key of [OFFICE.rug, OFFICE.flag, OFFICE.globe, OFFICE.bust, OFFICE.portrait, OFFICE.desk, OFFICE.phone, OFFICE.colonel]) {
        assert.ok(keys.includes(key), `missing ${key}`);
    }
    assert.ok(!keys.includes(OFFICE.mutantPortrait), 'portrait switching is deliberately deferred');
    assert.equal(menu.phone.args[3], 0); // initial frame, before ringing
    for (let i = 0; i < 18; i++) menu.update(250); // 4500 ms, salute hold
    assert.equal(menu.colonel.frame, 17);
    for (let i = 0; i < 7; i++) menu.update(250); // 6250 ms, ring
    assert.equal(menu.phone.frame, 2);
    menu.update(250); // 6500 ms, salute
    menu.update(250); // 6750 ms, march right
    assert.ok([7, 8, 9, 10].includes(menu.colonel.frame));
    assert.equal(menu.colonel.flipX, true);
    menu.destroy();
    assert.ok(scene.objects.every((o) => o.destroyed));
});

test('mobile only loads compact props and starts with El Colonel offstage', () => {
    const scene = testScene(true);
    const menu = new OfficeMenuLayer(scene);
    assert.equal(menu.flags.length, 0);
    assert.equal(menu.colonel.visible, false);
    const keys = scene.objects.filter((o) => o.type === 'image').map((o) => o.args[2]);
    assert.ok(keys.includes(OFFICE.desk));
    assert.ok(keys.includes(OFFICE.portrait));
    assert.ok(!keys.includes(OFFICE.rug));
    assert.ok(!keys.includes(OFFICE.globe));
    assert.ok(!keys.includes(OFFICE.bust));
    for (let i = 0; i < 16; i++) menu.update(200);
    assert.equal(menu.colonel.visible, true);
    assert.ok([7, 8, 9, 10].includes(menu.colonel.frame));
    assert.equal(menu.colonel.flipX, true);
    menu.destroy();
});
