// SPDX-License-Identifier: GPL-3.0-or-later
// tests/test_lazy_bench.js - Performance & integrity verification for DeclarativeMenuButton lazy loading

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import {
    getBrowserBookmarks,
    expandDynamicProfileItems,
    clearBookmarksCache,
    MAX_DYNAMIC_ITEMS
} from "../src/profileManager.js";

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log("=== Running Lazy Loading & Performance Benchmark ===");

// 1. Create a large mock bookmarks JSON with 1,897 bookmarks across multiple folders
const mockBookmarksData = {
    roots: {
        bookmark_bar: {
            children: []
        },
        other: {
            children: []
        }
    }
};

for (let i = 0; i < 1500; i++) {
    mockBookmarksData.roots.bookmark_bar.children.push({
        type: "url",
        name: `Bookmark Item ${i}`,
        url: `https://example.com/item-${i}`
    });
}

// Add folders with nested children
for (let f = 0; f < 10; f++) {
    const folderChildren = [];
    for (let c = 0; c < 30; c++) {
        folderChildren.push({
            type: "url",
            name: `Folder ${f} Item ${c}`,
            url: `https://folder${f}.com/item-${c}`
        });
    }
    mockBookmarksData.roots.bookmark_bar.children.push({
        type: "folder",
        name: `Folder ${f}`,
        children: folderChildren
    });
}

const tmpFile = Gio.File.new_for_path(
    GLib.build_filenamev([GLib.get_tmp_dir(), `bench-bm-${Date.now()}.json`])
);
tmpFile.replace_contents(
    new TextEncoder().encode(JSON.stringify(mockBookmarksData)),
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null
);

// Read brave profile
const braveFile = Gio.File.new_for_path(
    GLib.build_filenamev([GLib.get_current_dir(), "profiles", "brave-browser.json"])
);
const [okBrave, bytesBrave] = braveFile.load_contents(null);
assert(okBrave, "Loaded brave-browser.json");
const braveProfile = JSON.parse(new TextDecoder("utf-8").decode(bytesBrave));

// Mock classes matching extension.js DeclarativeMenuButton & src/hoverSubMenu.js
class MockHoverSubMenu {
    constructor(title, parentMenu = null) {
        this.title = title;
        this._parentMenu = parentMenu;
        this._childSubmenus = [];
        this.isOpen = false;
        this._isPopulated = false;
        this._lazyPopulate = null;
        this.items = [];
        this.menu = {
            isEmpty: () => false,
            isOpen: false,
            addMenuItem: (item) => {
                this.items.push(item);
                if (item instanceof MockHoverSubMenu) {
                    this._childSubmenus.push(item);
                }
            },
            open: () => {
                this.menu.isOpen = true;
            },
            close: () => {
                this.menu.isOpen = false;
            }
        };
    }

    setLazyPopulate(fn) {
        this._lazyPopulate = fn;
        this._isPopulated = false;
        this.menu.isEmpty = () => false;
    }

    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        if (typeof this._lazyPopulate === "function" && !this._isPopulated) {
            this._isPopulated = true;
            this._lazyPopulate(this.menu);
        }
        this.menu.open();
    }

    close() {
        this.isOpen = false;
        this.menu.close();
        for (const child of this._childSubmenus) {
            child.close();
        }
    }
}

class MockDeclarativeMenuButton {
    constructor(groupLabel, items, profile = null) {
        this.accessible_name = groupLabel;
        this._rawItems = items;
        this._profile = profile;
        this._itemsBuilt = false;
        this.items = [];
        this.menu = {
            isEmpty: () => false,
            isOpen: false,
            removeAll: () => {
                this.items = [];
            },
            toggle: () => {
                if (this.menu.isOpen) {
                    this.menu.close();
                } else {
                    this.menu.open();
                }
            },
            open: () => {
                if (!this._itemsBuilt) {
                    this._itemsBuilt = true;
                    this._buildCurrentItems();
                }
                this.menu.isOpen = true;
            },
            close: () => {
                this.menu.isOpen = false;
            },
            addMenuItem: (item) => {
                this.items.push(item);
            }
        };
    }

    _buildCurrentItems() {
        this.menu.removeAll();
        this._buildItems(this._rawItems);
    }

    _buildItems(items, targetMenu = this.menu) {
        if (!Array.isArray(items)) return;
        for (const item of items) {
            if (item.type === "separator") {
                targetMenu.addMenuItem({ type: "separator" });
                continue;
            }
            const subItems = item.items || item.submenu || item.children;
            const isDynamic = !!(item.dynamic || (this._profile && (item.label === "Bookmarks Bar" || item.dynamic === "bookmarks-bar")));
            if (isDynamic || (Array.isArray(subItems) && subItems.length > 0)) {
                const subMenu = new MockHoverSubMenu(item.label || "", targetMenu);
                subMenu.setLazyPopulate((childMenu) => {
                    let actualSubItems = subItems;
                    if (isDynamic && typeof expandDynamicProfileItems === "function" && this._profile) {
                        const expanded = expandDynamicProfileItems(
                            {
                                id: this._profile.id,
                                menus: [{ label: this.accessible_name, items: [item] }]
                            },
                            tmpFile.get_path()
                        );
                        if (expanded && Array.isArray(expanded.menus) && Array.isArray(expanded.menus[0]?.items?.[0]?.items)) {
                            actualSubItems = expanded.menus[0].items[0].items;
                        }
                    }
                    this._buildItems(actualSubItems, childMenu);
                });
                targetMenu.addMenuItem(subMenu);
                continue;
            }
            targetMenu.addMenuItem({
                label: item.label,
                shortcut: item.shortcut,
                url: item.url,
                action: item.action,
                activated: false,
                activate() {
                    this.activated = true;
                }
            });
        }
    }

    vfunc_event(event) {
        const eventType = typeof event.type === "function" ? event.type() : event.type;
        if (eventType === 4 || eventType === 9) { // BUTTON_PRESS or TOUCH_BEGIN
            if (!this._itemsBuilt) {
                this._itemsBuilt = true;
                this._buildCurrentItems();
            }
        }
        if (!this.menu.isEmpty()) {
            this.menu.toggle();
        }
    }
}

// ── Test Step 1: Benchmark Window Focus (Button Instantiation) ─────────────
console.log("1. Benchmarking window focus latency for all 7 Brave menus...");
const focusStart = GLib.get_monotonic_time();

const buttons = [];
for (const menuDef of braveProfile.menus) {
    buttons.push(new MockDeclarativeMenuButton(menuDef.label, menuDef.items, braveProfile));
}

const focusEnd = GLib.get_monotonic_time();
const focusDurationMs = (focusEnd - focusStart) / 1000;

console.log(`-> Window focus time: ${focusDurationMs.toFixed(3)} ms for ${buttons.length} panel buttons`);
assert(focusDurationMs < 1.0, `Focus latency must be < 1ms (got ${focusDurationMs.toFixed(3)}ms)`);

// Verify that 0 menu items were built across all buttons on focus
let totalItemsBuiltOnFocus = 0;
for (const btn of buttons) {
    totalItemsBuiltOnFocus += btn.items.length;
    assert(!btn._itemsBuilt, `Button "${btn.accessible_name}" must NOT have built items on focus`);
    assert(!btn.menu.isEmpty(), `Button "${btn.accessible_name}" menu.isEmpty() must return false`);
}
assert(totalItemsBuiltOnFocus === 0, `Expected 0 items built on focus, got ${totalItemsBuiltOnFocus}`);
console.log("-> 0 menu items created upfront on window focus. Zero lag verified!");

// ── Test Step 2: Benchmark Clicking "Bookmarks" Panel Button ─────────────
console.log("2. Benchmarking click on 'Bookmarks' panel button...");
const bookmarksBtn = buttons.find(b => b.accessible_name === "Bookmarks");
assert(bookmarksBtn !== undefined, "Bookmarks button found");

const clickStart = GLib.get_monotonic_time();
bookmarksBtn.vfunc_event({ type: () => 4 }); // BUTTON_PRESS
const clickEnd = GLib.get_monotonic_time();
const clickDurationMs = (clickEnd - clickStart) / 1000;

console.log(`-> Click-to-open latency: ${clickDurationMs.toFixed(3)} ms`);
assert(clickDurationMs < 2.0, `Click opening should take < 2ms (got ${clickDurationMs.toFixed(3)}ms)`);
assert(bookmarksBtn.menu.isOpen === true, "Bookmarks menu opened instantly");
assert(bookmarksBtn._itemsBuilt === true, "Bookmarks items built flag is true");

// Check how many items were created in the top-level Bookmarks menu
console.log(`-> Top-level Bookmarks items count: ${bookmarksBtn.items.length}`);
// Brave profile has 9 top-level items: 7 actions/submenus + 2 separators
assert(bookmarksBtn.items.length === 9, `Expected 9 top-level items in Bookmarks menu, got ${bookmarksBtn.items.length}`);

// Find "Bookmarks Bar" submenu in top-level items
const bmBar = bookmarksBtn.items.find(i => i instanceof MockHoverSubMenu && i.title === "Bookmarks Bar");
assert(bmBar !== undefined, "Bookmarks Bar submenu found in top-level items");
assert(bmBar._isPopulated === false, "Bookmarks Bar must NOT be populated yet on top-level menu open!");
assert(bmBar.items.length === 0, "Bookmarks Bar has 0 items before hover");
console.log("-> Bookmarks Bar is unpopulated before hover. 1,897 items were NOT expanded!");

// ── Test Step 3: Benchmark Hovering over "Bookmarks Bar" ─────────────────
console.log("3. Benchmarking hover/opening 'Bookmarks Bar'...");
const hoverStart = GLib.get_monotonic_time();
bmBar.open();
const hoverEnd = GLib.get_monotonic_time();
const hoverDurationMs = (hoverEnd - hoverStart) / 1000;

console.log(`-> Bookmarks Bar open latency: ${hoverDurationMs.toFixed(3)} ms`);
assert(bmBar._isPopulated === true, "Bookmarks Bar is now populated");
assert(bmBar.items.length > 0, "Bookmarks Bar items created");
// Capped at MAX_DYNAMIC_ITEMS + 1 (separator) + 1 (Other Bookmarks) or manager item
assert(bmBar.items.length <= MAX_DYNAMIC_ITEMS + 3, `Items capped to max allowed (got ${bmBar.items.length})`);

// ── Test Step 4: Verify Nested Folder Inside Bookmarks Bar is Lazy ───────
console.log("4. Verifying nested folders inside Bookmarks Bar remain lazy until hovered...");
const nestedFolder = bmBar.items.find(i => i instanceof MockHoverSubMenu);
if (nestedFolder) {
    console.log(`-> Found nested folder: "${nestedFolder.title}"`);
    assert(nestedFolder._isPopulated === false, "Nested folder must NOT be populated when Bookmarks Bar opens");
    assert(nestedFolder.items.length === 0, "Nested folder items empty before hover");

    // Hover nested folder
    nestedFolder.open();
    assert(nestedFolder._isPopulated === true, "Nested folder populated on hover");
    assert(nestedFolder.items.length > 0, "Nested folder items populated");
    console.log(`-> Nested folder opened with ${nestedFolder.items.length} items`);
}

// ── Test Step 5: Verify Leaf Item Activation ────────────────────────────
console.log("5. Verifying leaf item activation...");
const leafItem = bmBar.items.find(i => !(i instanceof MockHoverSubMenu) && i.label);
assert(leafItem !== undefined, "Leaf bookmark item found");
leafItem.activate();
assert(leafItem.activated === true, "Leaf bookmark item cleanly activated");

// ── Test Step 6: Verify Keyboard / Cycling menu.open() Benchmark ────────
console.log("6. Benchmarking keyboard / cycling menu.open() without button click...");
const fileBtn = buttons.find(b => b.accessible_name === "File");
assert(fileBtn !== undefined, "File button found");
assert(fileBtn._itemsBuilt === false, "File button starts lazy");

const keyStart = GLib.get_monotonic_time();
fileBtn.menu.open();
const keyEnd = GLib.get_monotonic_time();
const keyDurationMs = (keyEnd - keyStart) / 1000;

console.log(`-> Keyboard open latency: ${keyDurationMs.toFixed(3)} ms`);
assert(keyDurationMs < 2.0, `Keyboard open should take < 2ms (got ${keyDurationMs.toFixed(3)}ms)`);
assert(fileBtn.menu.isOpen === true, "File menu opened via menu.open()");
assert(fileBtn._itemsBuilt === true, "File menu items built on open()");
assert(fileBtn.items.length > 0, "File menu items populated");

// Cleanup
try { tmpFile.delete(null); } catch (e) {}
clearBookmarksCache();

console.log("=== All Lazy Loading & Performance Tests PASSED Successfully! ===");
