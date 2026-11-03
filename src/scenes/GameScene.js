import Phaser from 'phaser';
import {GamePhase, startGame} from '../core/gamePhase.js';
import {Grid} from '../core/grid.js';
import {addProxy, markScene, setBodyState} from '../testShadow/TestProxy.js';
import {QASurface} from '../testShadow/QASurface.js';

const GRID_COLS = 24;
const GRID_ROWS = 16;
const TILE_SIZE = 32;

const GRID_LINE_COLOR = 0x78909c;
const HIGHLIGHT_COLOR = 0xffeb3b;

/**
 * Title + Start button. Clicking Start moves the phase READY -> STARTED and
 * creates a 24x16 grid (32px cells) centred in the 1280x720 game area. Real
 * pointer input (mouse or touch) selects a cell; a pointer outside the grid
 * clears the selection.
 *
 * Pointer -> cell uses pointer.worldX/worldY with Grid.worldToCell, so
 * camera and canvas scaling are already accounted for by Phaser.
 *
 * Test Shadow usage:
 *   - addProxy('start') — the button is genuinely clicked, so it gets a
 *     click-passthrough DOM proxy. Grid cells deliberately get no proxies;
 *     tests click real canvas coordinates derived from the grid snapshot.
 *   - markScene()/setBodyState() — coarse `data-phase` on <body>.
 *   - QASurface — grid snapshot, selected cell, highlight state.
 */
export class GameScene extends Phaser.Scene {
    constructor() {
        super('game');
    }

    create() {
        const {width} = this.scale;
        this.phase = GamePhase.READY;
        this.grid = null;
        this.selectedCell = null;
        this.selectionHighlight = null;

        // Title and Start button sit in the bands above/below the grid
        // area (y 104..616) so both remain visible once the grid appears.
        this.add.text(width / 2, 52, 'PAPI Industries: The Green Shift', {
            fontFamily: 'monospace',
            fontSize: '48px',
            color: '#c8e6c9',
        }).setOrigin(0.5);

        this.startButton = this.add.rectangle(width / 2, 668, 240, 72, 0x2e7d32)
            .setStrokeStyle(3, 0xa5d6a7)
            .setInteractive({useHandCursor: true});
        this.add.text(this.startButton.x, this.startButton.y, 'START', {
            fontFamily: 'monospace',
            fontSize: '32px',
            color: '#ffffff',
        }).setOrigin(0.5);

        this.startButton.on('pointerdown', () => {
            const previous = this.phase;
            this.phase = startGame(this.phase);
            if (previous !== this.phase && this.phase === GamePhase.STARTED) {
                this.createGrid();
            }
            setBodyState({phase: this.phase});
        });

        this.input.on('pointerdown', (pointer) => this.selectAt(pointer.worldX, pointer.worldY));

        addProxy(this, this.startButton, 'start', {label: 'Start'});

        // Instantiated BEFORE markScene: the QA surface should exist by the
        // time a test sees data-scene appear.
        this.qa = new QASurface(this, () => ({
            scene: this.scene.key,
            phase: this.phase,
            width: this.scale.width,
            height: this.scale.height,
            grid: this.grid ? this.grid.snapshot() : null,
            selectedCell: this.selectedCell ? {...this.selectedCell} : null,
            highlight: this.selectionHighlight
                ? {
                    visible: this.selectionHighlight.visible,
                    x: this.selectionHighlight.x,
                    y: this.selectionHighlight.y,
                    width: this.selectionHighlight.width,
                    height: this.selectionHighlight.height,
                }
                : null,
        }));

        markScene(this, {phase: this.phase});
    }

    createGrid() {
        const {width, height} = this.scale;
        this.grid = new Grid({
            cols: GRID_COLS,
            rows: GRID_ROWS,
            tileSize: TILE_SIZE,
            originX: (width - GRID_COLS * TILE_SIZE) / 2,
            originY: (height - GRID_ROWS * TILE_SIZE) / 2,
        });

        const bounds = this.grid.footprintRect({col: 0, row: 0, width: GRID_COLS, height: GRID_ROWS});
        const lines = this.add.graphics();
        lines.lineStyle(1, GRID_LINE_COLOR, 0.6);
        lines.beginPath();
        for (let col = 0; col <= GRID_COLS; col++) {
            const x = bounds.x + col * TILE_SIZE;
            lines.moveTo(x, bounds.y);
            lines.lineTo(x, bounds.y + bounds.height);
        }
        for (let row = 0; row <= GRID_ROWS; row++) {
            const y = bounds.y + row * TILE_SIZE;
            lines.moveTo(bounds.x, y);
            lines.lineTo(bounds.x + bounds.width, y);
        }
        lines.strokePath();

        this.selectionHighlight = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, HIGHLIGHT_COLOR, 0.35)
            .setOrigin(0, 0)
            .setStrokeStyle(2, HIGHLIGHT_COLOR)
            .setVisible(false);
    }

    /** Select the cell under a world point, or clear selection outside the grid. */
    selectAt(worldX, worldY) {
        if (!this.grid) return;

        this.selectedCell = this.grid.worldToCell(worldX, worldY);

        if (this.selectedCell) {
            const {x, y} = this.grid.cellToWorld(this.selectedCell.col, this.selectedCell.row);
            this.selectionHighlight.setPosition(x, y).setVisible(true);
        } else {
            this.selectionHighlight.setVisible(false);
        }
    }
}
