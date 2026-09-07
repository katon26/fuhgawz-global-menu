// Test suite for Button Pooling, Zero-Churn Window Transitions, and Safe DING Filtering

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log("Testing Button Pooling and Safe DING Filtering logic...");

// 1. Safe DING detection logic tests
console.log("1. Verifying Safe DING detection logic...");

const Meta = {
    WindowType: {
        NORMAL: 0,
        DESKTOP: 1,
        DOCK: 2
    }
};

function isDesktopOverlayWindow(win) {
    if (!win) return false;

    // 1. Mutter / Meta window type DESKTOP
    try {
        if (typeof win.get_window_type === 'function') {
            if (win.get_window_type() === Meta.WindowType.DESKTOP) {
                return true;
            }
        }
    } catch (e) {}

    // 2. Desktop Icons NG (DING) WM class / App ID exact or known variants
    const wmClass = (win.get_wm_class ? (win.get_wm_class() || '') : '').toLowerCase();
    const wmInstance = (win.get_wm_class_instance ? (win.get_wm_class_instance() || '') : '').toLowerCase();
    const appId = (win.gtk_application_id || '').toLowerCase();

    const dingClasses = ['ding', 'desktop-icons', 'com.rastersoft.ding', 'org.gnome.shell.extensions.ding'];
    if (dingClasses.includes(wmClass) || dingClasses.includes(wmInstance) || dingClasses.includes(appId)) {
        return true;
    }

    // 3. Exact title checks for DING
    const titleLower = (win.get_title ? (win.get_title() || '') : '').toLowerCase().trim();
    if (titleLower === 'desktop icons ng' || titleLower === 'ding' || titleLower === 'desktop_icons_ng') {
        return true;
    }

    return false;
}

// Test DING wallpaper window types & classes
const dingDesktopWin = {
    get_window_type: () => Meta.WindowType.DESKTOP,
    get_title: () => '',
    get_wm_class: () => '',
};
assert(isDesktopOverlayWindow(dingDesktopWin) === true, "Desktop window type identified as overlay");

const dingClassWin = {
    get_window_type: () => Meta.WindowType.NORMAL,
    get_title: () => 'Desktop',
    get_wm_class: () => 'ding',
};
assert(isDesktopOverlayWindow(dingClassWin) === true, "DING WM class identified as overlay");

const dingAppIdWin = {
    get_window_type: () => Meta.WindowType.NORMAL,
    get_title: () => '',
    gtk_application_id: 'org.gnome.shell.extensions.ding',
};
assert(isDesktopOverlayWindow(dingAppIdWin) === true, "DING App ID identified as overlay");

const dingTitleWin = {
    get_window_type: () => Meta.WindowType.NORMAL,
    get_title: () => 'Desktop Icons NG',
};
assert(isDesktopOverlayWindow(dingTitleWin) === true, "Exact DING title identified as overlay");

// Test that browser tabs with 'ding' substrings are NOT falsely filtered
const braveTabWithBindings = {
    get_window_type: () => Meta.WindowType.NORMAL,
    get_title: () => "remorses/gpuix: Node.js & React bindings for Zed's GPUI - Brave",
    get_wm_class: () => 'Brave-browser',
    get_wm_class_instance: () => 'brave-browser',
    gtk_application_id: 'brave-browser.desktop',
};
assert(isDesktopOverlayWindow(braveTabWithBindings) === false, "Brave tab with 'bindings' is NOT filtered");

const buildingTab = {
    get_window_type: () => Meta.WindowType.NORMAL,
    get_title: () => "Building GNOME Extensions Guide - Brave",
    get_wm_class: () => 'brave-browser',
};
assert(isDesktopOverlayWindow(buildingTab) === false, "Tab with 'Building' is NOT filtered");

const landingPageTab = {
    get_window_type: () => Meta.WindowType.NORMAL,
    get_title: () => "Product Landing Page - Brave",
    get_wm_class: () => 'brave-browser',
};
assert(isDesktopOverlayWindow(landingPageTab) === false, "Tab with 'Landing' is NOT filtered");

// Test fullscreen window without bus name is NOT filtered
const fullscreenBrave = {
    get_window_type: () => Meta.WindowType.NORMAL,
    get_title: () => "Full Screen Video - Brave",
    get_wm_class: () => 'Brave-browser',
    gtk_unique_bus_name: null,
    gtk_application_id: null,
};
assert(isDesktopOverlayWindow(fullscreenBrave) === false, "Fullscreen window without bus/app is NOT filtered");

// 2. Button Pool allocation and reuse tests
console.log("2. Verifying Button Pool allocation and reuse...");

class MockPooledMenuButton {
    constructor(index) {
        this.index = index;
        this.destroyed = false;
        this.visible = false;
        this.mode = null;
        this.label = '';
        this.items = null;
    }

    setDeclarative(label, items) {
        this.mode = 'declarative';
        this.label = label;
        this.items = items;
        this.visible = true;
    }

    reset() {
        this.mode = null;
        this.label = '';
        this.items = null;
        this.visible = false;
    }

    destroy() {
        this.destroyed = true;
    }
}

class MockMenuPoolManager {
    constructor() {
        this._POOL_SIZE = 10;
        this._buttonPool = [];
        for (let i = 0; i < this._POOL_SIZE; i++) {
            this._buttonPool.push(new MockPooledMenuButton(i));
        }
        this._activeSlotIndex = 0;
        this._overflowButtons = [];
        this._currentWindow = null;
    }

    acquireSlot() {
        if (this._activeSlotIndex < this._buttonPool.length) {
            return this._buttonPool[this._activeSlotIndex++];
        }
        const overflow = new MockPooledMenuButton(this._activeSlotIndex++);
        this._overflowButtons.push(overflow);
        return overflow;
    }

    finalizeSlots() {
        for (let i = this._activeSlotIndex; i < this._buttonPool.length; i++) {
            this._buttonPool[i].reset();
        }
        const activeOverflowCount = Math.max(0, this._activeSlotIndex - this._buttonPool.length);
        while (this._overflowButtons.length > activeOverflowCount) {
            const btn = this._overflowButtons.pop();
            btn.destroy();
        }
    }

    resetSlots() {
        this._activeSlotIndex = 0;
        for (const slot of this._buttonPool) {
            slot.reset();
        }
        for (const btn of this._overflowButtons) {
            btn.destroy();
        }
        this._overflowButtons = [];
    }
}

const poolManager = new MockMenuPoolManager();
assert(poolManager._buttonPool.length === 10, "Pool initialized with 10 slots");
assert(poolManager._buttonPool.every(b => !b.visible), "All slots initially hidden");

// Simulate App 1 with 5 menus (File, Edit, View, History, Help)
poolManager._activeSlotIndex = 0;
const app1Menus = ['File', 'Edit', 'View', 'History', 'Help'];
for (const m of app1Menus) {
    const slot = poolManager.acquireSlot();
    slot.setDeclarative(m, [{ label: 'Item 1' }]);
}
poolManager.finalizeSlots();

assert(poolManager._buttonPool.slice(0, 5).every(b => b.visible), "First 5 slots are visible");
assert(poolManager._buttonPool.slice(5).every(b => !b.visible), "Slots 5..9 remain hidden");
assert(poolManager._buttonPool[0].label === 'File', "Slot 0 is File");
assert(poolManager._buttonPool[4].label === 'Help', "Slot 4 is Help");

// Capture actor references
const slot0Ref = poolManager._buttonPool[0];
const slot1Ref = poolManager._buttonPool[1];

// Simulate switching to App 2 with 3 menus (File, Edit, Help)
poolManager._activeSlotIndex = 0;
const app2Menus = ['File', 'Edit', 'Help'];
for (const m of app2Menus) {
    const slot = poolManager.acquireSlot();
    slot.setDeclarative(m, [{ label: 'Item A' }]);
}
poolManager.finalizeSlots();

assert(poolManager._buttonPool[0] === slot0Ref, "Slot 0 reused without destruction");
assert(poolManager._buttonPool[1] === slot1Ref, "Slot 1 reused without destruction");
assert(slot0Ref.destroyed === false, "Slot 0 was NOT destroyed");
assert(poolManager._buttonPool.slice(0, 3).every(b => b.visible), "First 3 slots visible");
assert(poolManager._buttonPool.slice(3).every(b => !b.visible), "Slots 3..9 hidden (zero actor churn)");

// 3. Overflow handling when app has > 10 menus
console.log("3. Verifying overflow handling (> 10 menus)...");
poolManager._activeSlotIndex = 0;
for (let i = 0; i < 12; i++) {
    const slot = poolManager.acquireSlot();
    slot.setDeclarative(`Menu-${i}`, []);
}
assert(poolManager._overflowButtons.length === 2, "2 overflow buttons created");
poolManager.finalizeSlots();
assert(poolManager._overflowButtons.every(b => b.visible), "Overflow buttons visible");

// Switch back to 4-menu app: overflow buttons cleanly destroyed
poolManager._activeSlotIndex = 0;
for (let i = 0; i < 4; i++) {
    const slot = poolManager.acquireSlot();
    slot.setDeclarative(`Menu-${i}`, []);
}
poolManager.finalizeSlots();
assert(poolManager._overflowButtons.length === 0, "Overflow buttons cleaned up");
assert(poolManager._buttonPool.every(b => !b.destroyed), "Pre-allocated pool untouched");

console.log("All Button Pooling and Safe DING Filtering tests passed successfully!");
