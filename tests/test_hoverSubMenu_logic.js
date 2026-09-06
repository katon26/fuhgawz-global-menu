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
        this._grab = null;
        this._lazyPopulate = null;
        this._isPopulated = false;

        this.actor = {
            contains: (child) => child === this.actor,
        };

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
                contains: (child) => {
                    return child === this.menu.actor || (child && child._parentActor === this.menu.actor);
                },
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

    setLazyPopulate(callback) {
        this._lazyPopulate = callback;
        this._isPopulated = false;
    }

    activate() {
        this.open();
    }

    open() {
        if (this._isDestroyed || this.isOpen) return;

        // Execute lazy populate if registered
        if (typeof this._lazyPopulate === 'function' && !this._isPopulated) {
            this._isPopulated = true;
            this._lazyPopulate(this.menu);
        }

        // Close siblings
        if (this._parentHoverSubmenu && this._parentHoverSubmenu._childSubmenus) {
            for (const sibling of this._parentHoverSubmenu._childSubmenus) {
                if (sibling !== this && sibling.isOpen) {
                    sibling.close();
                }
            }
        }

        this.chromeAdded = true;
        this.isOpen = true;
        this.menu.open();
        this._grab = {
            actor: this.menu.actor,
            dismissed: false,
            dismiss() {
                this.dismissed = true;
            }
        };
    }

    close() {
        if (this._childSubmenus) {
            for (const child of this._childSubmenus) {
                if (child.isOpen) {
                    child.close();
                }
            }
        }
        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }
        this.isOpen = false;
        this.menu.close();
    }

    _handleCapturedEvent(targetActor, eventType = 'button-press') {
        if (eventType === 'button-press') {
            // 1. Target is inside this menu
            if (this.menu.actor === targetActor || (this.menu.actor.contains && this.menu.actor.contains(targetActor))) {
                return 'propagate';
            }

            // 2. Target is inside an open child submenu
            if (this._childSubmenus) {
                for (const child of this._childSubmenus) {
                    if (child.isOpen && (child.menu.actor === targetActor || (child.menu.actor.contains && child.menu.actor.contains(targetActor)))) {
                        return 'propagate';
                    }
                }
            }

            // 3. Target is on trigger, parent menu, or ancestor trigger/menu
            let isAncestor = false;
            let p = this._parentHoverSubmenu;
            while (p) {
                if (p.actor === targetActor || (p.actor.contains && p.actor.contains(targetActor)) ||
                    (p.menu?.actor && (p.menu.actor === targetActor || (p.menu.actor.contains && p.menu.actor.contains(targetActor))))) {
                    isAncestor = true;
                    break;
                }
                p = p._parentHoverSubmenu;
            }

            if (this.actor === targetActor || (this.actor.contains && this.actor.contains(targetActor)) ||
                (this._parentMenu?.actor && (this._parentMenu.actor === targetActor || (this._parentMenu.actor.contains && this._parentMenu.actor.contains(targetActor)))) ||
                isAncestor) {
                this.close();
                return 'propagate';
            }

            // 4. Outside everything
            this.close();
            this._closeEntireMenuChain();
            return 'stop';
        }
        return 'propagate';
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

// ── Test 10: Verify Brave History & Bookmarks Alignment with Native Hamburger Menu
console.log("10. Verifying Brave History & Bookmarks alignment...");
const histItems = histMenu.items;
const openHistPage = histItems.find(i => i.label === "Open History Page");
assert(openHistPage && openHistPage.shortcut === "Ctrl+H", "History has Open History Page with Ctrl+H");

const reopenTab = recTabs.items.find(i => i.label === "Reopen Closed Tab" || i.label === "Restore Last Session");
assert(reopenTab && reopenTab.shortcut === "Ctrl+Shift+T", "Recent tabs has restore session/tab with Ctrl+Shift+T");

const yourDev = histItems.find(i => i.label === "Your Devices");
assert(yourDev && Array.isArray(yourDev.items), "History has Your Devices submenu");

const bmMenu = braveJson.menus.find(m => m.label === "Bookmarks");
assert(bmMenu, "Bookmarks menu exists");
const bmBar = bmMenu.items.find(i => i.label === "Bookmarks Bar");
assert(bmBar && bmBar.dynamic === "bookmarks-bar", "Bookmarks Bar marked with dynamic: bookmarks-bar");

// ── Test 11: Verify Captured Event Click Routing in Multi-level Hierarchy ──
console.log("11. Verifying captured event pointer click routing...");
const rootTopMenu = {
    _parent: null,
    actor: { id: "top-root-actor" },
    itemActivated: () => {},
    close: () => {},
};
const lvl2Submenu = new MockHoverSubMenu("Recent Tabs", rootTopMenu);
const lvl3Submenu = new MockHoverSubMenu("GitHub - 2 tabs", lvl2Submenu.menu);

lvl2Submenu.open();
lvl3Submenu.open();
assert(lvl2Submenu.isOpen && lvl3Submenu.isOpen, "Level 2 and 3 are open");

// 11a. Click inside lvl3 menu actor -> must propagate so item activates
const lvl3LeafActor = { id: "lvl3-leaf", _parentActor: lvl3Submenu.menu.actor };
assert(lvl3Submenu._handleCapturedEvent(lvl3LeafActor, "button-press") === "propagate", "Click inside level 3 flyout propagates");

// 11b. Click inside lvl2 menu actor -> must propagate so lvl2 items activate
const lvl2LeafActor = { id: "lvl2-leaf", _parentActor: lvl2Submenu.menu.actor };
assert(lvl2Submenu._handleCapturedEvent(lvl2LeafActor, "button-press") === "propagate", "Click inside level 2 flyout propagates");

// 11c. Click on lvl2 trigger item while lvl3 is open -> lvl3 closes, propagates to trigger
assert(lvl3Submenu._handleCapturedEvent(lvl2Submenu.actor, "button-press") === "propagate", "Click on parent trigger closes child and propagates");
assert(!lvl3Submenu.isOpen, "Level 3 closed when parent trigger clicked");

// 11d. Click completely outside all menus -> stops and closes chain
const outsideActor = { id: "desktop-outside" };
lvl3Submenu.open();
assert(lvl2Submenu._handleCapturedEvent(outsideActor, "button-press") === "stop", "Click outside stops and closes entire menu chain");
assert(!lvl2Submenu.isOpen && !lvl3Submenu.isOpen, "All submenus closed on outside click");

// ── Test 12: Verify Modal Grab Lifecycle Simulation ──────────────────────────
console.log("12. Verifying modal grab lifecycle...");
const grabTestSubmenu = new MockHoverSubMenu("Grab Test", rootTopMenu);
assert(grabTestSubmenu._grab === null, "No grab before open");

grabTestSubmenu.open();
assert(grabTestSubmenu._grab !== null && grabTestSubmenu._grab.dismissed === false, "Grab active when open");

grabTestSubmenu.close();
assert(grabTestSubmenu._grab === null, "Grab cleared on close");

grabTestSubmenu.open();
grabTestSubmenu.destroy();
assert(grabTestSubmenu._grab === null, "Grab safely cleared on destroy");

// ── Test 13: Verify Lazy Submenu Item Population ─────────────────────────────
console.log("13. Verifying lazy child submenu population...");
const lazyParent = new MockHoverSubMenu("Lazy Bookmarks", rootTopMenu);
let childItemsCreated = 0;
lazyParent.setLazyPopulate((menu) => {
    childItemsCreated += 5;
    menu.addMenuItem(new MockHoverSubMenu("Sub Folder", menu));
});

assert(childItemsCreated === 0, "No child items created on init");
assert(!lazyParent._isPopulated, "Not populated initially");

lazyParent.open();
assert(childItemsCreated === 5, "Child items created on first open");
assert(lazyParent._isPopulated, "Marked populated after open");

// Second open should not re-populate
lazyParent.close();
lazyParent.open();
assert(childItemsCreated === 5, "Child items not duplicated on subsequent open");

// ── Test 14: Verify LIFO Grab Dismissal Order in Nested Hierarchy ────────────
console.log("14. Verifying LIFO grab dismissal order in nested submenus...");
const dismissalOrder = [];
const parentLvl = new MockHoverSubMenu("Parent Level", rootTopMenu);
const childLvl = new MockHoverSubMenu("Child Level", parentLvl.menu);

parentLvl.open();
parentLvl._grab.dismiss = () => dismissalOrder.push("parent");

childLvl.open();
childLvl._grab.dismiss = () => dismissalOrder.push("child");

// Closing parent must dismiss child grab BEFORE parent grab
parentLvl.close();
assert(dismissalOrder.length === 2, `Expected 2 dismissals, got ${dismissalOrder.length}`);
assert(dismissalOrder[0] === "child" && dismissalOrder[1] === "parent", `Expected ['child', 'parent'], got ${JSON.stringify(dismissalOrder)}`);

// ── Test 15: Verify Google Chrome profile structure ──────────────────────────
console.log("15. Verifying profiles/google-chrome.json structure...");
const chromeFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), "profiles", "google-chrome.json"]));
const [okChrome, bytesChrome] = chromeFile.load_contents(null);
assert(okChrome && bytesChrome, "Loaded google-chrome.json");
const chromeJson = JSON.parse(new TextDecoder("utf-8").decode(bytesChrome));
const chromeBmMenu = chromeJson.menus.find(m => m.label === "Bookmarks");
assert(chromeBmMenu, "Bookmarks menu exists in google-chrome.json");
const chromeBmBar = chromeBmMenu.items.find(i => i.label === "Bookmarks Bar");
assert(chromeBmBar && chromeBmBar.dynamic === "bookmarks-bar", "Bookmarks Bar marked with dynamic: bookmarks-bar in google-chrome.json");

// ── Test 16: Verify GNOME Calculator profile structure ───────────────────────
console.log("16. Verifying profiles/org.gnome.Calculator.json structure...");
const calcFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), "profiles", "org.gnome.Calculator.json"]));
const [okCalc, bytesCalc] = calcFile.load_contents(null);
assert(okCalc && bytesCalc, "Loaded org.gnome.Calculator.json");
const calcJson = JSON.parse(new TextDecoder("utf-8").decode(bytesCalc));
assert(calcJson.id === "org.gnome.Calculator", "Calculator id is org.gnome.Calculator");
assert(calcJson.menus.some(m => m.label === "Mode"), "Calculator has Mode menu");
assert(calcJson.menus.some(m => m.label === "Edit"), "Calculator has Edit menu");
assert(calcJson.menus.some(m => m.label === "Help"), "Calculator has Help menu");

// ── Test 17: Verify LibreOffice profile structure ───────────────────────────
console.log("17. Verifying profiles/org.libreoffice.LibreOffice.json structure...");
const loFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), "profiles", "org.libreoffice.LibreOffice.json"]));
const [okLO, bytesLO] = loFile.load_contents(null);
assert(okLO && bytesLO, "Loaded org.libreoffice.LibreOffice.json");
const loJson = JSON.parse(new TextDecoder("utf-8").decode(bytesLO));
assert(loJson.id === "org.libreoffice.LibreOffice", "LibreOffice id matches");
assert(loJson.menus.length === 8, "LibreOffice has 8 document menus");
const loMenuLabels = loJson.menus.map(m => m.label);
for (const req of ["File", "Edit", "View", "Insert", "Format", "Tools", "Window", "Help"]) {
    assert(loMenuLabels.includes(req), `LibreOffice has ${req} menu`);
}

// ── Test 18: Verify ONLYOFFICE profile structure ────────────────────────────
console.log("18. Verifying profiles/onlyoffice-desktopeditors.json structure...");
const ooFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), "profiles", "onlyoffice-desktopeditors.json"]));
const [okOO, bytesOO] = ooFile.load_contents(null);
assert(okOO && bytesOO, "Loaded onlyoffice-desktopeditors.json");
const ooJson = JSON.parse(new TextDecoder("utf-8").decode(bytesOO));
assert(ooJson.id === "onlyoffice-desktopeditors", "ONLYOFFICE id matches");
const ooMenuLabels = ooJson.menus.map(m => m.label);
for (const req of ["File", "Edit", "View", "Insert", "Help"]) {
    assert(ooMenuLabels.includes(req), `ONLYOFFICE has ${req} menu`);
}

// ── Test 19: Verify captured event propagation on self-actor click ──────────
console.log("19. Verifying captured event propagation on flyout background click...");
const flyoutBackgroundActor = lvl3Submenu.menu.actor;
assert(lvl3Submenu._handleCapturedEvent(flyoutBackgroundActor, "button-press") === "propagate", "Click on flyout container itself propagates");

// ── Test 20: Verify DeclarativeMenuButton non-empty initialization ─────────
console.log("20. Verifying DeclarativeMenuButton initializes non-empty...");
class MockDeclarativeMenu {
    constructor(items) {
        this.rawItems = items;
        this.items = [];
        // Must build eagerly on init so isEmpty() is false for GNOME Shell PopupMenu.open()
        this._buildItems(this.rawItems);
    }
    _buildItems(items) {
        for (const item of items) {
            this.items.push(item);
        }
    }
    isEmpty() {
        return this.items.length === 0;
    }
}
const mockDeclMenu = new MockDeclarativeMenu(calcJson.menus[0].items);
assert(!mockDeclMenu.isEmpty(), "DeclarativeMenu is not empty on init (PopupMenu.open() will not abort)");

// ── Test 21: Verify topMenu.actor.contains grab delegation for hover submenus ──
console.log("21. Verifying topMenu.actor.contains grab delegation for hover submenus...");
const realMockTopMenu = {
    _parent: null,
    actor: {
        id: "real-mock-top-menu-actor",
        contains(child) {
            return child === this || child?._parentActor === this;
        },
    },
};

class DelegatingHoverSubMenu extends MockHoverSubMenu {
    _registerWithTopMenu() {
        let top = this._parentMenu;
        if (top && typeof top._getTopMenu === "function") {
            top = top._getTopMenu();
        } else {
            while (top && top._parent) {
                top = top._parent;
            }
        }
        if (top?.actor && typeof top.actor.contains === "function") {
            if (!top.actor._origContains) {
                top.actor._origContains = top.actor.contains.bind(top.actor);
                top.actor._hoverSubmenuActors = new Set();
                top.actor.contains = function(descendant) {
                    if (!descendant) return false;
                    if (top.actor._origContains(descendant)) return true;
                    for (const subActor of top.actor._hoverSubmenuActors) {
                        if (subActor && (subActor === descendant || (typeof subActor.contains === "function" && subActor.contains(descendant)))) {
                            return true;
                        }
                    }
                    return false;
                };
            }
            if (top.actor._hoverSubmenuActors && this.menu?.actor) {
                top.actor._hoverSubmenuActors.add(this.menu.actor);
            }
        }
    }

    _unregisterFromTopMenu() {
        let top = this._parentMenu;
        if (top && typeof top._getTopMenu === "function") {
            top = top._getTopMenu();
        } else {
            while (top && top._parent) {
                top = top._parent;
            }
        }
        if (top?.actor?._hoverSubmenuActors && this.menu?.actor) {
            top.actor._hoverSubmenuActors.delete(this.menu.actor);
        }
    }

    open() {
        super.open();
        this._registerWithTopMenu();
    }

    close() {
        this._unregisterFromTopMenu();
        super.close();
    }

    destroy() {
        this._unregisterFromTopMenu();
        this._isDestroyed = true;
        this.close();
    }
}

const delLvl2 = new DelegatingHoverSubMenu("Lvl2", realMockTopMenu);
const delLvl3 = new DelegatingHoverSubMenu("Lvl3", delLvl2.menu);

const directTopChild = { id: "top-child", _parentActor: realMockTopMenu.actor };
const lvl2Child = { id: "lvl2-child", _parentActor: delLvl2.menu.actor };
const lvl3Child = { id: "lvl3-child", _parentActor: delLvl3.menu.actor };
const desktopOutsideActor = { id: "desktop-outside" };

// Before opening submenus, topMenu only contains its direct children
assert(realMockTopMenu.actor.contains(directTopChild), "Top menu contains direct child initially");
assert(!realMockTopMenu.actor.contains(lvl2Child), "Top menu does NOT contain lvl2 child before open");
assert(!realMockTopMenu.actor.contains(lvl3Child), "Top menu does NOT contain lvl3 child before open");
assert(!realMockTopMenu.actor.contains(desktopOutsideActor), "Top menu does NOT contain desktop outside actor");

// Open Level 2
delLvl2.open();
assert(realMockTopMenu.actor.contains(lvl2Child), "Top menu contains lvl2 child when lvl2 is open (preventing premature grab close)");
assert(!realMockTopMenu.actor.contains(lvl3Child), "Top menu does not contain lvl3 child before lvl3 is open");

// Open Level 3
delLvl3.open();
assert(realMockTopMenu.actor.contains(lvl3Child), "Top menu contains lvl3 child when lvl3 is open");
assert(realMockTopMenu.actor.contains(lvl2Child), "Top menu continues to contain lvl2 child");
assert(!realMockTopMenu.actor.contains(desktopOutsideActor), "Top menu does NOT contain desktop outside actor");

// Close Level 3
delLvl3.close();
assert(!realMockTopMenu.actor.contains(lvl3Child), "Top menu no longer contains lvl3 child after lvl3 close");
assert(realMockTopMenu.actor.contains(lvl2Child), "Top menu still contains lvl2 child while lvl2 is open");

// Close Level 2
delLvl2.close();
assert(!realMockTopMenu.actor.contains(lvl2Child), "Top menu no longer contains lvl2 child after lvl2 close");
assert(realMockTopMenu.actor.contains(directTopChild), "Top menu still contains its own direct child");

console.log("All Multi-level Submenu and Hover tests passed successfully!");
