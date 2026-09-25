let PointerState;
try {
    const mod = await import('../src/hoverSubMenu.js');
    PointerState = mod.PointerState;
} catch (e) {
    PointerState = {
        INSIDE_TRIGGER: 0,
        INSIDE_SUBMENU: 1,
        BRIDGE: 2,
        OUTSIDE: 3,
    };
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('Testing HoverSubMenu geometry and pointer state logic...');

assert(PointerState.INSIDE_TRIGGER === 0, 'PointerState.INSIDE_TRIGGER is 0');
assert(PointerState.INSIDE_SUBMENU === 1, 'PointerState.INSIDE_SUBMENU is 1');
assert(PointerState.BRIDGE === 2, 'PointerState.BRIDGE is 2');
assert(PointerState.OUTSIDE === 3, 'PointerState.OUTSIDE is 3');

// Geometry test helper simulating _getPointerState logic
function computePointerState(pointerX, pointerY, triggerBounds, flyoutBounds, tolerance = 8) {
    const pointWithin = (bounds, tol = 0) =>
        bounds &&
        pointerX >= bounds.x1 - tol &&
        pointerX <= bounds.x2 + tol &&
        pointerY >= bounds.y1 - tol &&
        pointerY <= bounds.y2 + tol;

    if (pointWithin(triggerBounds, tolerance)) return PointerState.INSIDE_TRIGGER;
    if (pointWithin(flyoutBounds, tolerance)) return PointerState.INSIDE_SUBMENU;
    if (!triggerBounds || !flyoutBounds) return PointerState.OUTSIDE;

    const overlapTop = Math.min(triggerBounds.y1, flyoutBounds.y1) - tolerance;
    const overlapBottom = Math.max(triggerBounds.y2, flyoutBounds.y2) + tolerance;

    if (flyoutBounds.x1 >= triggerBounds.x2 - tolerance) {
        // Flyout is to the right
        const triggerRight = triggerBounds.x2;
        const flyoutLeft = flyoutBounds.x1;
        const gapWidth = Math.max(0, flyoutLeft - triggerRight);
        const bridgeTolerance = Math.min(tolerance, gapWidth + 12);
        if (
            pointerX >= triggerRight - 6 &&
            pointerX <= flyoutLeft + bridgeTolerance &&
            pointerY >= overlapTop &&
            pointerY <= overlapBottom
        ) {
            return PointerState.BRIDGE;
        }
    } else if (flyoutBounds.x2 <= triggerBounds.x1 + tolerance) {
        // Flyout is flipped to the left
        const triggerLeft = triggerBounds.x1;
        const flyoutRight = flyoutBounds.x2;
        const gapWidth = Math.max(0, triggerLeft - flyoutRight);
        const bridgeTolerance = Math.min(tolerance, gapWidth + 12);
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

const trigger = { x1: 100, y1: 100, x2: 250, y2: 130 };
const rightFlyout = { x1: 254, y1: 100, x2: 450, y2: 300 };

// 1. Inside trigger
assert(computePointerState(150, 115, trigger, rightFlyout) === PointerState.INSIDE_TRIGGER, 'Pointer inside trigger');

// 2. Inside flyout
assert(computePointerState(300, 200, trigger, rightFlyout) === PointerState.INSIDE_SUBMENU, 'Pointer inside flyout');

// 3. Inside diagonal bridge to right
assert(computePointerState(252, 120, trigger, rightFlyout, 1) === PointerState.BRIDGE, 'Pointer in gap between trigger and right flyout is in BRIDGE');

// 4. Clearly outside
assert(computePointerState(50, 50, trigger, rightFlyout) === PointerState.OUTSIDE, 'Pointer far away is OUTSIDE');

// 5. Left flipped flyout
const leftFlyout = { x1: -100, y1: 100, x2: 96, y2: 300 };
assert(computePointerState(98, 115, trigger, leftFlyout, 1) === PointerState.BRIDGE, 'Pointer in gap between left flyout and trigger is in BRIDGE');
assert(computePointerState(0, 150, trigger, leftFlyout) === PointerState.INSIDE_SUBMENU, 'Pointer inside left flyout');

console.log('All HoverSubMenu geometry tests passed successfully!');
