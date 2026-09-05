// SPDX-License-Identifier: GPL-3.0-or-later
// tests/test_hoverSubMenu_logic.js - Unit tests for multi-level hover submenu logic and profile structures in GJS.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('Testing Multi-level Submenu and Hover logic...');

const PointerState = {
    INSIDE_TRIGGER: 0,
    INSIDE_SUBMENU: 1,
    BRIDGE: 2,
    OUTSIDE: 3,
};

const POINTER_TOLERANCE_PX = 8;

// Simulated HoverSubMenuMenuItem node to test multi-level pointer state and hierarchy
class MockHoverSubMenu {
    constructor(title, parentMenu = null) {
        this.title = title;
        this._parentMenu = parentMenu;
        this._parentHoverSubmenu = parentMenu?._ownerSubMenu ?? null;
        this._childSubmenus = [];
        this.isOpen = false;
        this.actorHidden = true; // Verified: Hidden by default on init!
        this.chromeAdded = false; // Verified: Not added to top chrome on init!

        this.menu = {
            _ownerSubMenu: this,
            _parent: parentMenu,
            actor: {
                visible: false,
                hide: () => { this.actorHidden = true; this.menu.actor.visible = false; },
                show: () => { this.actorHidden = false; this.menu.actor.visible = true; },
            },
            close: () => {
                this.isOpen = false;
                this.menu.actor.hide();
            },
            open: () => {
                this.isOpen = true;
                this.menu.actor.show();
            },
            addMenuItem: (item) => {
                if (item instanceof MockHoverSubMenu) {
                    this._registerChildSubmenu(item);
                }
            }
        };

        if (this._parentHoverSubmenu) {
            this._parentHoverSubmenu._registerChildSubmenu(this);
        }

        // Mock actor bounds for coordinate hit-testing
        this.triggerBounds = { x1: 0, y1: 0, x2: 100, y2: 30 };
        this.flyoutBounds = { x1: 105, y1: 0, x2: 250, y2: 150 };
    }

    _registerChildSubmenu(child) {
        if (!this._childSubmenus.includes(child)) {
            this._childSubmenus.push(child);
            child._parentHoverSubmenu = this;
        }
    }

    _unregisterChildSubmenu(child) {
        const idx = this._childSubmenus.indexOf(child);
        if (idx >= 0) {
            this._childSubmenus.splice(idx, 1);
        }
    }

    open() {
        if (this.isOpen) return;

        // Close siblings
        if (this._parentHoverSubmenu) {
            for (const sibling of this._parentHoverSubmenu._childSubmenus) {
                if (sibling !== this && sibling.isOpen) {
                    sibling.close();
                }
            }
        }

        this.chromeAdded = true;
        this.menu.open();
    }

    close() {
        if (this._childSubmenus) {
            for (const child of this._childSubmenus) {
                if (child.isOpen) {
                    child.close();
                }
            }
        }
        this.menu.close();
    }

    _closeEntireMenuChain() {
        this.close();

        let ancestor = this._parentHoverSubmenu;
        while (ancestor) {
            ancestor.close();
            ancestor = ancestor._parentHoverSubmenu;
        }

        let topMenu = this._parentMenu;
        while (topMenu && topMenu._parent) {
            topMenu = topMenu._parent;
        }
        if (topMenu && typeof topMenu.close === 'function') {
            topMenu.close();
        }
    }

    _getPointerState(pointerX, pointerY) {
        if (!this.isOpen) {
            return PointerState.OUTSIDE;
        }

        const pointWithin = (bounds, tolerance = 0) =>
            bounds &&
            pointerX >= bounds.x1 - tolerance &&
            pointerX <= bounds.x2 + tolerance &&
            pointerY >= bounds.y1 - tolerance &&
            pointerY <= bounds.y2 + tolerance;

        // 1. Inside trigger
        if (pointWithin(this.triggerBounds, POINTER_TOLERANCE_PX)) {
            return PointerState.INSIDE_TRIGGER;
        }

        // 2. Inside flyout
        if (pointWithin(this.flyoutBounds, POINTER_TOLERANCE_PX)) {
            return PointerState.INSIDE_SUBMENU;
        }

        // 3. Inside any child hover submenu
        if (this._childSubmenus && this._childSubmenus.length > 0) {
            for (const child of this._childSubmenus) {
                if (child && child.isOpen) {
                    const childState = child._getPointerState(pointerX, pointerY);
                    if (childState !== PointerState.OUTSIDE) {
                        return PointerState.INSIDE_SUBMENU;
                    }
                }
            }
        }

        // 4. Diagonal bridge
        const overlapTop = Math.min(this.triggerBounds.y1, this.flyoutBounds.y1) - POINTER_TOLERANCE_PX;
        const overlapBottom = Math.max(this.triggerBounds.y2, this.flyoutBounds.y2) + POINTER_TOLERANCE_PX;
        const triggerRight = this.triggerBounds.x2;
        const flyoutLeft = this.flyoutBounds.x1;
        const gapWidth = Math.max(0, flyoutLeft - triggerRight);
        const bridgeTolerance = Math.min(POINTER_TOLERANCE_PX, gapWidth + 12);

        if (
            pointerX >= triggerRight - 6 &&
            pointerX <= flyoutLeft + bridgeTolerance &&
            pointerY >= overlapTop &&
            pointerY <= overlapBottom
        ) {
            return PointerState.BRIDGE;
        }

        return PointerState.OUTSIDE;
    }
}

// ── Test 1: Ghost Popup Prevention ──────────────────────────────────────────
console.log('1. Verifying Ghost Popup prevention...');
const topMenu = { isOpen: true, close: () => { topMenu.isOpen = false; } };
const level1 = new MockHoverSubMenu('History', topMenu);

assert(level1.actorHidden === true, 'Level 1 actor is hidden on init');
assert(level1.chromeAdded === false, 'Level 1 is NOT added to top chrome on init');
assert(level1.isOpen === false, 'Level 1 is closed on init');

level1.open();
assert(level1.actorHidden === false, 'Level 1 actor shown when opened');
assert(level1.chromeAdded === true, 'Level 1 added to chrome when opened');
assert(level1.isOpen === true, 'Level 1 is open');

level1.close();
assert(level1.actorHidden === true, 'Level 1 actor hidden when closed');
assert(level1.isOpen === false, 'Level 1 is closed');

// ── Test 2: Multi-Level Submenu Hierarchy ───────────────────────────────────
console.log('2. Verifying 3-Level Submenu Hierarchy...');
const level2 = new MockHoverSubMenu('Recent Tabs', level1.menu);
level1.menu.addMenuItem(level2);

const level3 = new MockHoverSubMenu('GitHub - 2 tabs', level2.menu);
level2.menu.addMenuItem(level3);

assert(level1._childSubmenus.length === 1, 'Level 1 has 1 child');
assert(level1._childSubmenus[0] === level2, 'Level 1 child is Level 2');
assert(level2._parentHoverSubmenu === level1, 'Level 2 parent is Level 1');

assert(level2._childSubmenus.length === 1, 'Level 2 has 1 child');
assert(level2._childSubmenus[0] === level3, 'Level 2 child is Level 3');
assert(level3._parentHoverSubmenu === level2, 'Level 3 parent is Level 2');

// ── Test 3: Multi-Level Pointer Tracking ────────────────────────────────────
console.log('3. Verifying Multi-Level Pointer State...');
level1.open();
level2.open();
level3.open();

// Configure bounds for distinct positions
level2.triggerBounds = { x1: 110, y1: 10, x2: 240, y2: 35 };
level2.flyoutBounds = { x1: 255, y1: 10, x2: 400, y2: 120 };

level3.triggerBounds = { x1: 260, y1: 15, x2: 390, y2: 40 };
level3.flyoutBounds = { x1: 420, y1: 15, x2: 550, y2: 100 };

// Pointer inside Level 3 flyout (e.g., x=450, y=50)
assert(level3._getPointerState(450, 50) === PointerState.INSIDE_SUBMENU, 'Level 3 sees pointer inside');
assert(level2._getPointerState(450, 50) === PointerState.INSIDE_SUBMENU, 'Level 2 delegates to Level 3: returns INSIDE_SUBMENU');
assert(level1._getPointerState(450, 50) === PointerState.INSIDE_SUBMENU, 'Level 1 delegates through Level 2 to Level 3: returns INSIDE_SUBMENU');

// Pointer in bridge between Level 2 and Level 3 (e.g. x=405, y=25)
assert(level3._getPointerState(405, 25) === PointerState.BRIDGE, 'Level 3 detects bridge');
assert(level2._getPointerState(405, 25) === PointerState.INSIDE_SUBMENU, 'Level 2 stays open during Level 3 bridge');
assert(level1._getPointerState(405, 25) === PointerState.INSIDE_SUBMENU, 'Level 1 stays open during Level 3 bridge');

// Pointer outside all menus (e.g., x=900, y=900)
assert(level3._getPointerState(900, 900) === PointerState.OUTSIDE, 'Level 3 sees outside');
assert(level2._getPointerState(900, 900) === PointerState.OUTSIDE, 'Level 2 sees outside');
assert(level1._getPointerState(900, 900) === PointerState.OUTSIDE, 'Level 1 sees outside');

// ── Test 4: Chain Closing on Leaf Activation ────────────────────────────────
console.log('4. Verifying Chain Closing on Leaf Activation...');
assert(level1.isOpen && level2.isOpen && level3.isOpen && topMenu.isOpen, 'All levels currently open');
level3._closeEntireMenuChain();
assert(!level3.isOpen, 'Level 3 closed');
assert(!level2.isOpen, 'Level 2 closed');
assert(!level1.isOpen, 'Level 1 closed');
assert(!topMenu.isOpen, 'Top menu closed');

// ── Test 5: Sibling Submenu Exclusivity ──────────────────────────────────────
console.log('5. Verifying Sibling Submenu Exclusivity...');
level1.open();
const siblingA = new MockHoverSubMenu('Sibling A', level1.menu);
const siblingB = new MockHoverSubMenu('Sibling B', level1.menu);
level1.menu.addMenuItem(siblingA);
level1.menu.addMenuItem(siblingB);

siblingA.open();
assert(siblingA.isOpen, 'Sibling A opened');
assert(!siblingB.isOpen, 'Sibling B closed');

siblingB.open();
assert(siblingB.isOpen, 'Sibling B opened');
assert(!siblingA.isOpen, 'Sibling A was automatically closed by sibling B opening');

// ── Test 6: Verify profiles/brave-browser.json 3-level nesting ───────────────
console.log('6. Verifying profiles/brave-browser.json structure...');
const braveFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), 'profiles', 'brave-browser.json']));
const [ok, bytes] = braveFile.load_contents(null);
assert(ok && bytes, 'Loaded brave-browser.json');
const braveJson = JSON.parse(new TextDecoder('utf-8').decode(bytes));
const histMenu = braveJson.menus.find(m => m.label === 'History');
assert(histMenu, 'History menu exists');
const recTabs = histMenu.items.find(i => i.label === 'Recent Tabs');
assert(recTabs && Array.isArray(recTabs.items), 'Recent Tabs exists with items');
const ghTabs = recTabs.items.find(i => i.label && i.label.includes('GitHub'));
assert(ghTabs && Array.isArray(ghTabs.items), 'GitHub - 2 tabs exists with nested items (Level 3)');
assert(ghTabs.items.length >= 3, 'Level 3 has multiple items');

console.log('All Multi-level Submenu and Hover tests passed successfully!');
