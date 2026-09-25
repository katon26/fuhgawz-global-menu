// SPDX-License-Identifier: GPL-3.0-or-later
// DOM interaction tests for Media Floating Popover Card and coordination

if (typeof require === 'undefined') {
  console.log('Skipping test_media_card_dom.js (requires Node.js environment)');
} else {
  runTests();
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function runTests() {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');

  const appJsCode = fs.readFileSync(path.join(__dirname, '../docs/app.js'), 'utf8');

  // Set up mock DOM elements
  const listeners = {};
  const elements = {};

  function createElement(tag, id = '') {
    const el = {
      tagName: tag.toUpperCase(),
      id,
      hidden: false,
      dataset: {},
      style: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        toggle(c, force) {
          if (force !== undefined) {
            if (force) this._classes.add(c);
            else this._classes.delete(c);
            return force;
          }
          if (this._classes.has(c)) {
            this._classes.delete(c);
            return false;
          }
          this._classes.add(c);
          return true;
        },
        contains(c) { return this._classes.has(c); }
      },
      children: [],
      appendChild(child) {
        this.children.push(child);
        child.parentElement = this;
        return child;
      },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; },
      getBoundingClientRect() { return { left: 50, top: 20, width: 280, height: 160 }; },
      focus() { this.focused = true; },
      contains(target) {
        if (target === this) return true;
        return this.children.some(c => c.contains ? c.contains(target) : c === target);
      },
      listeners: {},
      addEventListener(evt, cb) {
        this.listeners[evt] = this.listeners[evt] || [];
        this.listeners[evt].push(cb);
      },
      click() {
        (this.listeners['click'] || []).forEach(cb => cb({ stopPropagation() {}, target: this }));
      }
    };
    if (id) elements[id] = el;
    return el;
  }

  // Create Mock DOM
  const mockDoc = {
    documentElement: { classList: { add() {} } },
    createElement: (tag) => createElement(tag),
    querySelectorAll: (sel) => {
      if (sel === '[data-reveal]') return [];
      if (sel === '[data-copy]') return [];
      if (sel === '.gmenu-item') return [mockGmenuItem];
      if (sel === '.headerbar-tab') return [];
      if (sel === '.mockup-media-card .recent-item') return mockRecentButtons;
      if (sel === '.wave-bar') return mockWaveBars;
      return [];
    },
    querySelector: (sel) => {
      if (sel === '.type-line') return null;
      if (sel === '.desktop-workspace') return mockDesktopWorkspace;
      if (sel === '.live-pill__text-inner') return mockPillTextInner;
      if (sel === '.mockup-media-card__waveform') return mockWaveform;
      if (sel === '.gmenu-item.is-active') return mockGmenuItem;
      return null;
    },
    getElementById: (id) => elements[id] || null,
    addEventListener: (event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    }
  };

  const mockDesktopWorkspace = createElement('div', 'desktop-workspace');
  mockDesktopWorkspace.clientWidth = 600;

  const mockLivePill = createElement('div', 'gnome-live-pill');
  const mockPillTextInner = createElement('span');
  mockPillTextInner.textContent = 'Music · Gravity Chasm - Conan';

  const mockMediaCard = createElement('div', 'mockup-media-card');
  mockMediaCard.hidden = true;

  const mockTrackTitle = createElement('div', 'mockup-track-title');
  mockTrackTitle.textContent = 'Gravity Chasm';

  const mockTrackArtist = createElement('div', 'mockup-track-artist');
  mockTrackArtist.textContent = 'Conan · Blood Eagle';

  const mockMediaPlayBtn = createElement('button', 'media-play-btn');
  const mockPauseIcon = createElement('span');
  mockPauseIcon.className = 'media-pause-icon';
  mockPauseIcon.style.display = 'inline';
  const mockPlayIcon = createElement('span');
  mockPlayIcon.className = 'media-play-icon';
  mockPlayIcon.style.display = 'none';
  mockMediaPlayBtn.querySelector = (sel) => {
    if (sel === '.media-pause-icon') return mockPauseIcon;
    if (sel === '.media-play-icon') return mockPlayIcon;
    return null;
  };

  const mockMediaPrevBtn = createElement('button', 'media-prev-btn');
  const mockMediaNextBtn = createElement('button', 'media-next-btn');

  const mockWaveBars = [createElement('span'), createElement('span'), createElement('span'), createElement('span')];
  const mockWaveform = createElement('div');
  mockWaveform.className = 'mockup-media-card__waveform';
  mockWaveform.querySelectorAll = () => mockWaveBars;

  const mockRecentBtn1 = createElement('button');
  mockRecentBtn1.dataset.title = 'Hawk as Weapon';
  mockRecentBtn1.dataset.artist = 'Conan';

  const mockRecentBtn2 = createElement('button');
  mockRecentBtn2.dataset.title = 'Levitation Hoax';
  mockRecentBtn2.dataset.artist = 'Conan';

  const mockRecentButtons = [mockRecentBtn1, mockRecentBtn2];

  const mockGmenuItem = createElement('button');
  mockGmenuItem.dataset.menu = 'file';

  const mockPopoverMenu = createElement('div', 'mockup-file-menu');
  mockPopoverMenu.hidden = true;

  const mockEgoTrigger = createElement('button', 'ego-trigger');
  const mockEgoPopover = createElement('div', 'ego-popover');
  mockEgoPopover.hidden = true;
  mockEgoPopover.querySelector = () => null;

  const mockWindow = {
    innerWidth: 1200,
    innerHeight: 800,
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => fn()
  };

  const context = vm.createContext({
    window: mockWindow,
    document: mockDoc,
    navigator: {},
    IntersectionObserver: class { observe() {} unobserve() {} },
    requestAnimationFrame: fn => fn(),
    setTimeout: mockWindow.setTimeout,
    clearTimeout: mockWindow.clearTimeout,
    console
  });

  vm.runInContext(appJsCode, context);
  console.log('PASS: app.js evaluated cleanly in media DOM environment');

  // Test 1: Hover on live-pill opens mediaCard
  assert(mockMediaCard.hidden === true, 'Initial media card should be hidden');
  mockLivePill.listeners['mouseenter'][0]();
  assert(mockMediaCard.hidden === false, 'Hover on live pill should open media card');
  assert(mockLivePill['aria-expanded'] === 'true', 'Live pill should have aria-expanded="true"');
  console.log('PASS: Hovering live pill opens media card');

  // Test 2: Play / Pause toggle
  mockMediaPlayBtn.click();
  assert(mockPauseIcon.style.display === 'none', 'Pause icon should be hidden when paused');
  assert(mockPlayIcon.style.display === 'inline', 'Play icon should be visible when paused');
  assert(mockLivePill.classList.contains('live-pill--paused') === true, 'Live pill should have live-pill--paused class');
  console.log('PASS: Play / pause button toggles playback state and icons');

  // Test 3: Next track button updates title and ticker
  mockMediaNextBtn.click();
  assert(mockTrackTitle.textContent === 'Hawk as Weapon', `Track title should update, got ${mockTrackTitle.textContent}`);
  assert(mockPillTextInner.textContent.includes('Hawk as Weapon'), 'Live pill ticker text should update');
  assert(mockLivePill['aria-label'].includes('Hawk as Weapon'), 'Live pill aria-label should update with track title');
  console.log('PASS: Next track button updates track title, ticker text, and pill aria-label');

  // Test 4: Clicking recent item sets track
  mockRecentBtn2.click();
  assert(mockTrackTitle.textContent === 'Levitation Hoax', `Track title should be Levitation Hoax, got ${mockTrackTitle.textContent}`);
  assert(mockLivePill['aria-label'].includes('Levitation Hoax'), 'Live pill aria-label should update for recent track');
  console.log('PASS: Clicking recent track sets active track');

  // Test 4b: Waveform keyboard seeking
  const waveKeydown = mockWaveform.listeners['keydown'] || [];
  if (waveKeydown.length > 0) {
    waveKeydown[0]({ key: 'ArrowRight', preventDefault() {} });
    assert(mockWaveform['aria-valuenow'] === '55', `Waveform should step forward, got ${mockWaveform['aria-valuenow']}`);
    waveKeydown[0]({ key: 'Home', preventDefault() {} });
    assert(mockWaveform['aria-valuenow'] === '0', `Waveform should jump to start on Home, got ${mockWaveform['aria-valuenow']}`);
    waveKeydown[0]({ key: 'End', preventDefault() {} });
    assert(mockWaveform['aria-valuenow'] === '100', `Waveform should jump to end on End, got ${mockWaveform['aria-valuenow']}`);
    console.log('PASS: Waveform slider responds to keyboard navigation (Arrow keys, Home, End)');
  }

  // Test 5: Opening Global Menu closes media card
  mockGmenuItem.click();
  assert(mockMediaCard.hidden === true, 'Opening global menu should dismiss floating media card');
  console.log('PASS: Opening global menu dismisses floating media card');

  // Test 6: Re-opening media card closes global menu
  mockLivePill.listeners['mouseenter'][0]();
  assert(mockMediaCard.hidden === false, 'Media card is open');
  assert(mockPopoverMenu.hidden === true, 'Global menu popover should be closed when media card opens');
  console.log('PASS: Opening media card dismisses global menu popover');

  // Test 7: Escape key dismisses media card
  (listeners['keydown'] || []).forEach(cb => cb({ key: 'Escape' }));
  assert(mockMediaCard.hidden === true, 'Escape key should close media card');
  console.log('PASS: Escape key dismisses floating media card');

  console.log('\nAll DOM interaction tests passed successfully!');
}
