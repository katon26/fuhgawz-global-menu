// Mock minimal DOM to test app.js behavior
if (typeof require === 'undefined') {
  console.log('Skipping test_ego_popover_dom.js (requires Node.js environment)');
} else {
  runDomTests();
}

function runDomTests() {
const fs = require('fs');
const path = require('path');

const appJsCode = fs.readFileSync(path.join(__dirname, '../docs/app.js'), 'utf8');

// Set up minimal globals
let listeners = {};
const mockDoc = {
  documentElement: { classList: { add() {} } },
  querySelectorAll: () => [],
  querySelector: () => null,
  getElementById: (id) => {
    if (id === 'ego-trigger') return mockEgoTrigger;
    if (id === 'ego-popover') return mockEgoPopover;
    if (id === 'ego-close') return mockEgoClose;
    return null;
  },
  addEventListener: (event, cb) => {
    listeners[event] = listeners[event] || [];
    listeners[event].push(cb);
  }
};

const mockEgoTrigger = {
  hidden: false,
  dataset: {},
  classList: { add() {}, remove() {}, toggle() {} },
  setAttribute(attr, val) { this[attr] = val; },
  getAttribute(attr) { return this[attr]; },
  getBoundingClientRect() { return { left: 100, width: 200 }; },
  focus() { this.focused = true; },
  contains(target) { return target === this; },
  listeners: {},
  addEventListener(event, cb) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(cb);
  },
  click() {
    (this.listeners['click'] || []).forEach(cb => cb({ stopPropagation() {} }));
  }
};

const mockEgoPopover = {
  hidden: true,
  style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector(sel) {
    if (sel === '.ego-popover__action') return mockEgoAction;
    return null;
  },
  contains(target) {
    return target === this || target === mockEgoClose || target === mockEgoAction;
  }
};

const mockEgoClose = {
  listeners: {},
  addEventListener(event, cb) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(cb);
  },
  click() {
    (this.listeners['click'] || []).forEach(cb => cb({ stopPropagation() {} }));
  }
};

const mockEgoAction = {
  listeners: {},
  addEventListener(event, cb) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(cb);
  },
  click() {
    (this.listeners['click'] || []).forEach(cb => cb({ stopPropagation() {} }));
  }
};

const mockWindow = {
  innerWidth: 1200,
  innerHeight: 800,
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  setTimeout: (fn, ms) => fn(),
  requestAnimationFrame: (fn) => fn()
};

// Run app.js inside simulated scope
const vm = require('vm');
const context = vm.createContext({
  window: mockWindow,
  document: mockDoc,
  navigator: {},
  IntersectionObserver: class {
    observe() {}
    unobserve() {}
  },
  requestAnimationFrame: fn => fn(),
  console
});

try {
  vm.runInContext(appJsCode, context);
  console.log('PASS: app.js evaluated cleanly without errors');

  // Test 1: click trigger opens popover
  assert(mockEgoPopover.hidden === true, 'Initial popover should be hidden');
  mockEgoTrigger.click();
  assert(mockEgoPopover.hidden === false, 'Clicking trigger should open popover');
  assert(mockEgoTrigger['aria-expanded'] === 'true', 'Trigger should have aria-expanded="true"');
  console.log('PASS: click trigger opens popover');

  // Test 2: click trigger again closes popover
  mockEgoTrigger.click();
  assert(mockEgoPopover.hidden === true, 'Clicking trigger again should close popover');
  assert(mockEgoTrigger['aria-expanded'] === 'false', 'Trigger should have aria-expanded="false"');
  console.log('PASS: click trigger again closes popover');

  // Test 3: click close button closes popover and focuses trigger
  mockEgoTrigger.click();
  assert(mockEgoPopover.hidden === false, 'Popover open');
  mockEgoTrigger.focused = false;
  mockEgoClose.click();
  assert(mockEgoPopover.hidden === true, 'Close button should close popover');
  assert(mockEgoTrigger.focused === true, 'Close button should return focus to trigger');
  console.log('PASS: close button closes popover and restores focus');

  // Test 4: Escape key closes popover and focuses trigger
  mockEgoTrigger.click();
  assert(mockEgoPopover.hidden === false, 'Popover open');
  mockEgoTrigger.focused = false;
  (listeners['keydown'] || []).forEach(cb => cb({ key: 'Escape' }));
  assert(mockEgoPopover.hidden === true, 'Escape key should close popover');
  assert(mockEgoTrigger.focused === true, 'Escape key should restore focus to trigger');
  console.log('PASS: Escape closes popover and restores focus');

  // Test 5: click outside closes popover
  mockEgoTrigger.click();
  assert(mockEgoPopover.hidden === false, 'Popover open');
  (listeners['click'] || []).forEach(cb => cb({ target: mockDoc }));
  assert(mockEgoPopover.hidden === true, 'Click outside should close popover');
  console.log('PASS: click outside closes popover');

  // Test 6: click action link closes popover
  mockEgoTrigger.click();
  assert(mockEgoPopover.hidden === false, 'Popover open');
  mockEgoAction.click();
  assert(mockEgoPopover.hidden === true, 'Clicking action link inside should close popover');
  console.log('PASS: click action link closes popover');

  console.log('\nAll DOM interaction mock tests passed!');
} catch (err) {
  console.error('FAIL:', err);
  process.exit(1);
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}
}
