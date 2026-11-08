import {OFFICE} from './OfficeMenuArt.js';
import {officeMenuLayout} from './officeMenuLayout.js';
import {officeColonelPose, officeFlagFrame, officePhoneFrame} from './officeMenuTiming.js';

/**
 * Animated START screen, hosted by HUDScene while GameScene is still READY.
 * Keeping it in the existing HUD avoids a second START click, new scene keys,
 * and changes to the EventBus, 60 Hz simulation or the QA start proxy.
 */
export class OfficeMenuLayer {
    constructor(scene) {
        this.scene = scene;
        this.elapsedMs = 0;
        this.objects = [];
        this.layout = officeMenuLayout({
            width: scene.scale.width,
            height: scene.scale.height,
            touch: scene.layout.touch,
        });
        this.create();
        this.update(0);
    }

    own(gameObject) {
        this.objects.push(gameObject);
        return gameObject;
    }

    tile(key, {top, height}, depth) {
        if (height <= 0) return null;
        const {width, tileScale} = this.layout;
        return this.own(this.scene.add.tileSprite(width / 2, top + height / 2, width, height, key)
            .setTileScale(tileScale, tileScale)
            .setDepth(depth));
    }

    image(key, position, depth, originY = 0.5) {
        return this.own(this.scene.add.image(position.x, position.y, key)
            .setOrigin(0.5, originY)
            .setScale(position.scale)
            .setDepth(depth));
    }

    sprite(key, position, depth, frame = 0, originY = 0.5) {
        return this.own(this.scene.add.sprite(position.x, position.y, key, frame)
            .setOrigin(0.5, originY)
            .setScale(position.scale)
            .setDepth(depth));
    }

    create() {
        const {scene, layout: l} = this;
        // Full-width tileable background. The source 32x104 strip has exactly
        // three 32x32 tiles at y=0, 36 and 72, with transparent spacers between
        // them. These PNGs are cropped to solid pixels at build time.
        this.tile(OFFICE.floor, l.floor, -18);
        this.tile(OFFICE.wallTop, l.wallTop, -17);
        this.tile(OFFICE.wallBottom, l.wallBottom, -16);

        this.own(scene.add.rectangle(0, 0, l.width, l.headerHeight, 0x14231d)
            .setOrigin(0, 0).setDepth(-14));
        this.own(scene.add.rectangle(l.width / 2, l.headerHeight - 2, l.width, 4, 0xb88a3a)
            .setDepth(-13));

        if (!l.touch) {
            this.image(OFFICE.rug, l.rug, -12);
            this.flags = l.flags.map((position) => this.sprite(OFFICE.flag, position, -8));
            this.image(OFFICE.globe, l.globe, 4, 1);
        } else {
            this.flags = [];
        }

        // The portrait is deliberately fixed for now. The future Day 100 flag
        // can select OFFICE.mutantPortrait without altering the composition.
        this.image(OFFICE.portrait, l.portrait, -7);
        this.image(OFFICE.desk, l.desk, 3, 1);
        if (!l.touch) this.image(OFFICE.bust, l.bust, 5, 1).setFlipX(true);

        // The entire 51x50 phone cell is required: its handset jumps clear of
        // the body in frames 2-6. Cropping it to 16x16 would remove the joke.
        this.phone = this.sprite(OFFICE.phone, l.phone, 6, 0, 1);
        this.colonel = this.sprite(OFFICE.colonel, l.colonel, 8, 0, 1);
    }

    update(deltaMs = 0) {
        // Menu time is purely visual. Tab restore must not fast-forward a patrol
        // by minutes or affect the deterministic simulation clock.
        this.elapsedMs += Math.min(250, Math.max(0, deltaMs));
        const t = this.elapsedMs;
        this.phone.setFrame(officePhoneFrame(t));
        this.flags.forEach((flag, i) => flag.setFrame(officeFlagFrame(t, i * 290)));

        const action = officeColonelPose(t, this.layout.touch);
        this.colonel.setFrame(action.frame)
            .setPosition(Math.round(this.layout.colonel.x + action.xOffset), this.layout.colonel.y)
            .setVisible(action.visible)
            .setFlipX(!action.flipX);
    }

    destroy() {
        this.objects.forEach((object) => object.destroy());
        this.objects.length = 0;
        this.flags = [];
        this.phone = null;
        this.colonel = null;
    }
}
