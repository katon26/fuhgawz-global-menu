// SPDX-License-Identifier: GPL-3.0-or-later
// tests/test_hoverSubMenu_logic.js - Unit tests for multi-level hover submenu logic and profile structures in GJS.

import GLib from "gi://GLib";
import Gio from "gi://Gio";

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log("Testing Multi-level Submenu and Hover logic...");

const PointerState = {
    INSIDE_TRIGGER: 0,
    INSIDE_SUBMENU: 1,
    BRIDGE: 2,
    OUTSIDE: 3,
};

const POINTER_TOLERANCE_PX = 8;

// Simulated HoverSubMenuMenuItem node matching src/hoverSubMenu.js
class MockHoverSubMenu {
    constructor(title, parentMenu = null) {
        this.title = title;
        this._parentMenu = parentMenu;
        this._parentHoverSubmenu = parentMenu?._ownerSubMenu ?? null;
        this._childSubmenus = [];
        this.isOpen = false;
        this.actorHidden = true; // Hidden by default on init!
        this.chromeAdded = false; // Not added to top chrome on init!
        this._isDestroyed = false;

        this.menu = {
            _ownerSubMenu: this,
            _parent: parentMenu,
            _getTopMenu: () => {
                let m = this._parentMenu;
                while (m && m._parent) {
                    m = m._parent;
                }
                return m || this.menu;
            },
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
            },
            _activateItem: (childItem) => {
                // Mimic menu activate signal handler in src/hoverSubMenu.js
                if (childItem instanceof MockHoverSubMenu || childItem?._ownerSubMenu) {
                    return;
                }
                this.close();
                this._closeEntireMenuChain();
            }
        };

        if (this._parentHoverSubmenu) {
            this._parentHoverSubmenu._registerChildSubmenu(this);
        }

        // Mock actor bounds for coordinate hit-testing (default: flyout opens to right)
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

    activate() {
        this.open();
    }

    open() {
        if (this._isDestroyed || this.isOpen) return;

        // Close siblings
        if (this._parentHoverSubmenu && this._parentHoverSubmenu._childSubmenus) {
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
        if (topMenu && typeof topMenu._getTopMenu === "function") {
            topMenu = topMenu._getTopMenu();
        } else {
            while (topMenu && topMenu._parent) {
                topMenu = topMenu._parent;
            }
        }
        if (topMenu) {
            if (typeof topMenu.itemActivated === "function") {
                topMenu.itemActivated();
            } else if (typeof topMenu.close === "function") {
                topMenu.close();
            }
        }
    }

    destroy() {
        if (this._isDestroyed) return;
        this._isDestroyed = true;

        if (this._parentHoverSubmenu) {
            this._parentHoverSubmenu._unregisterChildSubmenu(this);
            this._parentHoverSubmenu = null;
        }

        if (this._childSubmenus) {
            for (const child of this._childSubmenus.slice()) {
                if (child && !child._isDestroyed) {
                    child.destroy();
                }
            }
            this._childSubmenus = [];
        }

        this.close();
        this.chromeAdded = false;
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

        if (!this.triggerBounds || !this.flyoutBounds) {
            return PointerState.OUTSIDE;
        }

        // 4. Diagonal corridor bridge
        const overlapTop = Math.min(this.triggerBounds.y1, this.flyoutBounds.y1) - POINTER_TOLERANCE_PX;
        const overlapBottom = Math.max(this.triggerBounds.y2, this.flyoutBounds.y2) + POINTER_TOLERANCE_PX;

        if (this.flyoutBounds.x1 >= this.triggerBounds.x2 - POINTER_TOLERANCE_PX) {
            // Flyout is to the right of the trigger
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
        } else if (this.flyoutBounds.x2 <= this.triggerBounds.x1 + POINTER_TOLERANCE_PX) {
            // Flyout is to the left of the trigger (flipped near right screen edge)
            const triggerLeft = this.triggerBounds.x1;
            const flyoutRight = this.flyoutBounds.x2;
            const gapWidth = Math.max(0, triggerLeft - flyoutRight);
            const bridgeTolerance = Math.min(POINTER_TOLERANCE_PX, gapWidth + 12);

            if (
                pointerX >= flyoutRight - bridgeTolerance &&
                pointerX <= triggerLeft + 6 &&
                pointerY >= overlapTop &&
                pointerY <= overlapBottom
            ) {
                return PointerState.BRIDGE;
            }
        }

        return PointerState.OUTSIDE;
    }
}

// ── Test 1: Ghost Popup Prevention ──────────────────────────────────────────
console.log("1. Verifying Ghost Popup prevention...");
const topMenu = { isOpen: true, close: () => { topMenu.isOpen = false; } };
const level1 = new MockHoverSubMenu("History", topMenu);

assert(level1.actorHidden === true, "Level 1 actor is hidden on init");
assert(level1.chromeAdded === false, "Level 1 is NOT added to top chrome on init");
assert(level1.isOpen === false, "Level 1 is closed on init");

level1.open();
assert(level1.actorHidden === false, "Level 1 actor shown when opened");
assert(level1.chromeAdded === true, "Level 1 added to chrome when opened");
assert(level1.isOpen === true, "Level 1 is open");

level1.close();
assert(level1.actorHidden === true, "Level 1 actor hidden when closed");
assert(level1.isOpen === false, "Level 1 is closed");

// ── Test 2: Multi-Level Submenu Hierarchy ───────────────────────────────────
console.log("2. Verifying 3-Level Submenu Hierarchy...");
const level2 = new MockHoverSubMenu("Recent Tabs", level1.menu);
level1.menu.addMenuItem(level2);

const level3 = new MockHoverSubMenu("GitHub - 2 tabs", level2.menu);
level2.menu.addMenuItem(level3);

assert(level1._childSubmenus.length === 1, "Level 1 has 1 child");
assert(level1._childSubmenus[0] === level2, "Level 1 child is Level 2");
assert(level2._parentHoverSubmenu === level1, "Level 2 parent is Level 1");

assert(level2._childSubmenus.length === 1, "Level 2 has 1 child");
assert(level2._childSubmenus[0] === level3, "Level 2 child is Level 3");
assert(level3._parentHoverSubmenu === level2, "Level 3 parent is Level 2");

// ── Test 3: Multi-Level Pointer Tracking (Right-side Flyout) ────────────────
console.log("3. Verifying Multi-Level Pointer State (Flyouts opening to right)...");
level1.open();
level2.open();
level3.open();

// Configure bounds for distinct right-opening positions
level2.triggerBounds = { x1: 110, y1: 10, x2: 240, y2: 35 };
level2.flyoutBounds = { x1: 255, y1: 10, x2: 400, y2: 120 };

level3.triggerBounds = { x1: 260, y1: 15, x2: 390, y2: 40 };
level3.flyoutBounds = { x1: 420, y1: 15, x2: 550, y2: 100 };

// Pointer inside Level 3 flyout (e.g., x=450, y=50)
assert(level3._getPointerState(450, 50) === PointerState.INSIDE_SUBMENU, "Level 3 sees pointer inside");
assert(level2._getPointerState(450, 50) === PointerState.INSIDE_SUBMENU, "Level 2 delegates to Level 3: returns INSIDE_SUBMENU");
assert(level1._getPointerState(450, 50) === PointerState.INSIDE_SUBMENU, "Level 1 delegates through Level 2 to Level 3: returns INSIDE_SUBMENU");

// Pointer in bridge between Level 2 and Level 3 (e.g. x=405, y=25)
assert(level3._getPointerState(405, 25) === PointerState.BRIDGE, "Level 3 detects bridge");
assert(level2._getPointerState(405, 25) === PointerState.INSIDE_SUBMENU, "Level 2 stays open during Level 3 bridge");
assert(level1._getPointerState(405, 25) === PointerState.INSIDE_SUBMENU, "Level 1 stays open during Level 3 bridge");

// Pointer outside all menus (e.g., x=900, y=900)
assert(level3._getPointerState(900, 900) === PointerState.OUTSIDE, "Level 3 sees outside");
assert(level2._getPointerState(900, 900) === PointerState.OUTSIDE, "Level 2 sees outside");
assert(level1._getPointerState(900, 900) === PointerState.OUTSIDE, "Level 1 sees outside");

// ── Test 3b: Pointer Tracking (Left-flipped Flyout near Screen Edge) ────────
console.log("3b. Verifying Pointer State when flyout flips to the left...");
const flippedSub = new MockHoverSubMenu("Flipped Near Edge", topMenu);
topMenu.isOpen = true;
flippedSub.open();
flippedSub.triggerBounds = { x1: 1800, y1: 100, x2: 1900, y2: 130 };
flippedSub.flyoutBounds  = { x1: 1600, y1: 100, x2: 1770, y2: 300 }; // To the left!

assert(flippedSub._getPointerState(1700, 150) === PointerState.INSIDE_SUBMENU, "Pointer inside left flyout");
assert(flippedSub._getPointerState(1785, 115) === PointerState.BRIDGE, "Pointer inside left diagonal bridge");
assert(flippedSub._getPointerState(1850, 115) === PointerState.INSIDE_TRIGGER, "Pointer inside trigger item");
assert(flippedSub._getPointerState(1000, 1000) === PointerState.OUTSIDE, "Pointer outside");
flippedSub.close();

// ── Test 4: Chain Closing on Leaf Activation ────────────────────────────────
console.log("4. Verifying Chain Closing on Leaf Activation...");
level1.open();
level2.open();
level3.open();
assert(level1.isOpen && level2.isOpen && level3.isOpen && topMenu.isOpen, "All levels currently open");
level3._closeEntireMenuChain();
assert(!level3.isOpen, "Level 3 closed");
assert(!level2.isOpen, "Level 2 closed");
assert(!level1.isOpen, "Level 1 closed");
assert(!topMenu.isOpen, "Top menu closed");

// ── Test 4b: Leaf activation vs Submenu activation ──────────────────────────
console.log("4b. Verifying Leaf activation vs Submenu item activation...");
topMenu.isOpen = true;
level1.open();
level2.open();

// Activating a child submenu item (e.g. clicking level2) must NOT close the chain
level1.menu._activateItem(level2);
assert(level1.isOpen, "Level 1 remains open after activating child submenu");
assert(level2.isOpen, "Level 2 remains open after activating child submenu");

// Activating a real leaf item closes the chain
level2.menu._activateItem({ label: "Restore 2 tabs" });
assert(!level2.isOpen, "Level 2 closed on leaf activation");
assert(!level1.isOpen, "Level 1 closed on leaf activation");
assert(!topMenu.isOpen, "Top menu closed on leaf activation");

// ── Test 5: Sibling Submenu Exclusivity ──────────────────────────────────────
console.log("5. Verifying Sibling Submenu Exclusivity...");
level1.open();
const siblingA = new MockHoverSubMenu("Sibling A", level1.menu);
const siblingB = new MockHoverSubMenu("Sibling B", level1.menu);
level1.menu.addMenuItem(siblingA);
level1.menu.addMenuItem(siblingB);

siblingA.open();
assert(siblingA.isOpen, "Sibling A opened");
assert(!siblingB.isOpen, "Sibling B closed");

siblingB.open();
assert(siblingB.isOpen, "Sibling B opened");
assert(!siblingA.isOpen, "Sibling A was automatically closed by sibling B opening");

// ── Test 6: Destroy Re-entrancy & Cleanup ────────────────────────────────────
console.log("6. Verifying Destroy Re-entrancy & Children Cleanup...");
const parentMenuToDestroy = new MockHoverSubMenu("ParentDestroy", topMenu);
const childToDestroy = new MockHoverSubMenu("ChildDestroy", parentMenuToDestroy.menu);
parentMenuToDestroy.menu.addMenuItem(childToDestroy);

parentMenuToDestroy.open();
childToDestroy.open();
assert(parentMenuToDestroy.isOpen && childToDestroy.isOpen, "Both are open before destroy");

// Call destroy once
parentMenuToDestroy.destroy();
assert(parentMenuToDestroy._isDestroyed, "Parent marked destroyed");
assert(childToDestroy._isDestroyed, "Child automatically destroyed by parent");
assert(!parentMenuToDestroy.isOpen, "Parent menu closed");
assert(!childToDestroy.isOpen, "Child menu closed");

// Calling destroy second time must be a safe no-op
parentMenuToDestroy.destroy();
childToDestroy.destroy();
assert(parentMenuToDestroy._isDestroyed, "Parent still marked destroyed without throwing");

// ── Test 7: Verify profiles/brave-browser.json 3-level nesting & deduplication
console.log("7. Verifying profiles/brave-browser.json structure...");
const braveFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), "profiles", "brave-browser.json"]));
const [okBrave, bytesBrave] = braveFile.load_contents(null);
assert(okBrave && bytesBrave, "Loaded brave-browser.json");
const braveJson = JSON.parse(new TextDecoder("utf-8").decode(bytesBrave));

const histMenu = braveJson.menus.find(m => m.label === "History");
assert(histMenu, "History menu exists");
const recTabs = histMenu.items.find(i => i.label === "Recent Tabs");
assert(recTabs && Array.isArray(recTabs.items), "Recent Tabs exists with items");
const ghTabs = recTabs.items.find(i => i.label && i.label.includes("GitHub"));
assert(ghTabs && Array.isArray(ghTabs.items), "GitHub - 2 tabs exists with nested items (Level 3)");
assert(ghTabs.items.length >= 3, "Level 3 has multiple items");

const helpMenu = braveJson.menus.find(m => m.label === "Help");
assert(helpMenu, "Help menu exists");
const dupAbout = helpMenu.items.find(i => i.label && i.label.toLowerCase().includes("about"));
assert(!dupAbout, "Help menu does NOT contain duplicate About item");

const appAbout = braveJson.app_menu.items.find(i => i.label && i.label.toLowerCase().includes("about"));
assert(appAbout, "App menu contains About Brave item");

// ── Test 8: Verify profiles/antigravity.json ─────────────────────────────────
console.log("8. Verifying profiles/antigravity.json structure...");
const agFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), "profiles", "antigravity.json"]));
const [okAg, bytesAg] = agFile.load_contents(null);
assert(okAg && bytesAg, "Loaded antigravity.json");
const agJson = JSON.parse(new TextDecoder("utf-8").decode(bytesAg));
assert(agJson.id === "antigravity", "Antigravity profile ID is antigravity");
assert(agJson.app_menu && agJson.app_menu.label === "Antigravity", "Antigravity app_menu is present");
assert(agJson.menus.length >= 6, "Antigravity has full menubar (File, Edit, Selection, View, Go, Terminal, Help)");

// ── Test 9: Verify profiles/dev.zed.Zed.json ──────────────────────────────────
console.log("9. Verifying profiles/dev.zed.Zed.json structure...");
const zedFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), "profiles", "dev.zed.Zed.json"]));
const [okZed, bytesZed] = zedFile.load_contents(null);
assert(okZed && bytesZed, "Loaded dev.zed.Zed.json");
const zedJson = JSON.parse(new TextDecoder("utf-8").decode(bytesZed));
assert(zedJson.match.app_id.includes("dev.zed.Zed"), "dev.zed.Zed is included in match.app_id");

console.log("All Multi-level Submenu and Hover tests passed successfully!");
