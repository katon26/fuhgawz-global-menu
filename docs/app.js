/* Hallmark · Cobalt microinteractions — reveal-once, hero type-in, copy, ⌘K palette.
 * All motion gates behind prefers-reduced-motion; reduced-motion ships static + visible.
 */
(() => {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 1 · Reveal once ─────────────────────────────────────────────────── */
  const revealEls = document.querySelectorAll('[data-reveal]');
  const setIn = (el) => el.classList.add('is-in');
  if (reduced || !('IntersectionObserver' in window)) {
    revealEls.forEach(setIn);
  } else {
    revealEls.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        setIn(el);
      }
    });
    document.documentElement.classList.add('js-reveal');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIn(entry.target);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.05, rootMargin: '0px 0px 80px 0px' }
    );
    revealEls.forEach((el) => {
      if (!el.classList.contains('is-in')) io.observe(el);
    });
  }

  /* ── 2 · Hero type-in — one line, once, then static ─────────────────── */
  const typeLine = document.querySelector('.type-line');
  if (typeLine) {
    const text = typeLine.dataset.type || '';
    if (!reduced && text) {
      let i = 0;
      const step = () => {
        typeLine.textContent = text.slice(0, ++i);
        if (i < text.length) window.setTimeout(step, 24 + Math.random() * 42);
      };
      window.setTimeout(step, 450);
    } else {
      typeLine.textContent = text;
    }
  }
  /* the caret keeps blinking via CSS; reduced-motion kills the animation */

  /* ── 3 · Copy buttons ────────────────────────────────────────────────── */
  const copyToClipboard = async (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
    } finally {
      textArea.remove();
    }
  };

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const payload = btn.dataset.copy;
      const original = btn.textContent;
      try {
        await copyToClipboard(payload);
        btn.dataset.state = 'copied';
        btn.textContent = 'copied';
        window.setTimeout(() => {
          btn.dataset.state = '';
          btn.textContent = original;
        }, 1600);
      } catch (_) {
        /* clipboard unavailable — leave the button as-is */
      }
    });
  });

  /* Cross-component coordination refs */
  let openEgoPopover = null;
  let closeEgoPopover = null;
  let closeMockupMenu = null;

  /* ── 4 · ⌘K command palette ─────────────────────────────────────────── */
  const palette = document.getElementById('palette');
  const trigger = document.getElementById('cmd-trigger');
  if (palette && trigger) {
    const input = document.getElementById('palette-input');
  const list = document.getElementById('palette-list');
  const empty = document.getElementById('palette-empty');
  const visibleItems = () =>
    [...list.querySelectorAll('.palette__item')].filter((item) => !item.hidden);

  const scrollToTarget = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  const filter = (query) => {
    const q = query.trim().toLowerCase();
    let matches = 0;
    list.querySelectorAll('.palette__item').forEach((item) => {
      const match = item.textContent.toLowerCase().includes(q);
      item.hidden = !match;
      if (match) matches += 1;
    });
    empty.hidden = matches !== 0;
    select(matches === 0 ? null : 0);
  };

  const select = (index) => {
    const items = visibleItems();
    list.querySelectorAll('.palette__item').forEach((item) => item.setAttribute('aria-selected', 'false'));
    items.forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
    const current = items[index];
    if (current) current.scrollIntoView({ block: 'nearest' });
  };

  const run = (item) => {
    const action = item.dataset.action;
    if (action === 'goto') scrollToTarget(item.dataset.target);
    else if (action === 'copy') {
      const span = item.querySelector('span');
      const originalText = span ? span.textContent : '';
      copyToClipboard(item.dataset.copy)
        .then(() => {
          if (span) span.textContent = 'Copied — run it anywhere';
        })
        .catch(() => {});
      window.setTimeout(() => {
        if (span) span.textContent = originalText;
        close();
      }, 900);
      return;
    } else if (action === 'link') {
      window.open(item.dataset.href, '_blank', 'noopener');
    } else if (action === 'custom' && item.dataset.custom === 'ego-status') {
      close();
      const egoBtn = document.getElementById('ego-trigger');
      if (egoBtn) {
        scrollToTarget('hero');
        window.setTimeout(() => {
          egoBtn.focus();
          if (typeof openEgoPopover === 'function') {
            openEgoPopover();
          } else {
            egoBtn.click();
          }
        }, 200);
      }
      return;
    }
    close();
  };

  const open = () => {
    palette.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      palette.classList.add('is-open');
      filter('');
      input.focus();
    });
  };

  const close = () => {
    palette.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
    window.setTimeout(() => { palette.hidden = true; }, 200);
  };

  trigger.addEventListener('click', () => (palette.hidden ? open() : close()));

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      palette.hidden ? open() : close();
    } else if (event.key === 'Escape' && !palette.hidden) {
      close();
    }
  });

  input.addEventListener('input', () => filter(input.value));

  input.addEventListener('keydown', (event) => {
    const items = visibleItems();
    if (items.length === 0) return;
    const current = items.findIndex((item) => item.getAttribute('aria-selected') === 'true');
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      select((current + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      select((current - 1 + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = items[current] || items[0];
      if (chosen) run(chosen);
    }
  });

  list.addEventListener('click', (event) => {
    const item = event.target.closest('.palette__item');
    if (item) run(item);
  });

    palette.addEventListener('click', (event) => {
      if (event.target === palette || event.target.classList.contains('palette__backdrop')) {
        close();
      }
    });
  }

  /* ── 5 · Mockup Top Bar Menu Interaction ─────────────────────────────── */
  const menuData = {
    file: [
      { label: 'New Text File', kbd: 'Ctrl+N' },
      { label: 'New Window', kbd: 'Ctrl+Shift+N' },
      { sep: true },
      { label: 'Open File...', kbd: 'Ctrl+O' },
      { sep: true },
      { label: 'Save', kbd: 'Ctrl+S' },
      { label: 'Save As...', kbd: 'Ctrl+Shift+S' },
      { sep: true },
      { label: 'Close Editor', kbd: 'Ctrl+W' },
      { label: 'Close Window', kbd: 'Ctrl+Shift+W' },
    ],
    edit: [
      { label: 'Undo', kbd: 'Ctrl+Z' },
      { label: 'Redo', kbd: 'Ctrl+Y' },
      { sep: true },
      { label: 'Cut', kbd: 'Ctrl+X' },
      { label: 'Copy', kbd: 'Ctrl+C' },
      { label: 'Paste', kbd: 'Ctrl+V' },
      { sep: true },
      { label: 'Find', kbd: 'Ctrl+F' },
      { label: 'Replace', kbd: 'Ctrl+H' },
    ],
    selection: [
      { label: 'Select All', kbd: 'Ctrl+A' },
      { label: 'Expand Selection', kbd: 'Shift+Alt+Right' },
      { label: 'Shrink Selection', kbd: 'Shift+Alt+Left' },
      { sep: true },
      { label: 'Add Cursor Above', kbd: 'Ctrl+Alt+Up' },
      { label: 'Add Cursor Below', kbd: 'Ctrl+Alt+Down' },
    ],
    view: [
      { label: 'Command Palette...', kbd: 'Ctrl+Shift+P' },
      { label: 'Explorer', kbd: 'Ctrl+Shift+E' },
      { label: 'Search', kbd: 'Ctrl+Shift+F' },
      { label: 'Source Control', kbd: 'Ctrl+Shift+G' },
      { sep: true },
      { label: 'Terminal', kbd: 'Ctrl+`' },
      { sep: true },
      { label: 'Zoom In', kbd: 'Ctrl+=' },
      { label: 'Zoom Out', kbd: 'Ctrl+-' },
    ],
    go: [
      { label: 'Go to File...', kbd: 'Ctrl+P' },
      { label: 'Go to Symbol...', kbd: 'Ctrl+Shift+O' },
      { label: 'Go to Line...', kbd: 'Ctrl+G' },
    ],
    terminal: [
      { label: 'New Terminal', kbd: 'Ctrl+Shift+`' },
      { label: 'Split Terminal', kbd: 'Ctrl+Shift+5' },
      { label: 'Run Task...', kbd: 'Ctrl+Shift+B' },
    ],
    help: [
      { label: 'Welcome', kbd: '' },
      { label: 'Documentation', kbd: 'F1' },
      { label: 'Keyboard Shortcuts', kbd: 'Ctrl+K Ctrl+S' },
      { sep: true },
      { label: 'About Global Menu', kbd: '' },
    ],
  };

  const gmenuItems = document.querySelectorAll('.gmenu-item');
  const popoverMenu = document.getElementById('mockup-file-menu');
  const desktopWorkspace = document.querySelector('.desktop-workspace');

  if (gmenuItems.length && popoverMenu && desktopWorkspace) {
    const updateMenuState = (activeBtn) => {
      gmenuItems.forEach((b) => {
        const isActive = b === activeBtn;
        b.classList.toggle('is-active', isActive);
        b.setAttribute('aria-expanded', String(isActive));
      });
    };

    const closeMenu = () => {
      popoverMenu.hidden = true;
      gmenuItems.forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-expanded', 'false');
      });
    };
    closeMockupMenu = closeMenu;

    const openMenu = (key, btn) => {
      if (typeof closeEgoPopover === 'function') {
        closeEgoPopover();
      }
      updateMenuState(btn);
      popoverMenu.hidden = false;
      renderMenu(key, btn);
    };

    const renderMenu = (key, anchorEl) => {
      const items = menuData[key] || menuData.file;
      popoverMenu.innerHTML = '';
      items.forEach((item) => {
        if (item.sep) {
          const div = document.createElement('div');
          div.className = 'popover-divider';
          div.setAttribute('role', 'separator');
          popoverMenu.appendChild(div);
        } else {
          const div = document.createElement('div');
          div.className = 'popover-item';
          div.setAttribute('role', 'menuitem');
          div.setAttribute('tabindex', '0');
          const span = document.createElement('span');
          span.textContent = item.label;
          div.appendChild(span);
          if (item.kbd) {
            const kbd = document.createElement('kbd');
            kbd.textContent = item.kbd;
            div.appendChild(kbd);
          }
          // Interactive visual feedback on menu item click
          div.addEventListener('click', (e) => {
            e.stopPropagation();
            div.style.background = 'rgba(255, 255, 255, 0.22)';
            window.setTimeout(() => {
              div.style.background = '';
              closeMenu();
            }, 140);
          });
          div.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              div.click();
            }
          });
          popoverMenu.appendChild(div);
        }
      });

      if (anchorEl) {
        const anchorRect = anchorEl.getBoundingClientRect();
        const workspaceRect = desktopWorkspace.getBoundingClientRect();
        const offsetLeft = anchorRect.left - workspaceRect.left;
        const popoverWidth = popoverMenu.offsetWidth || 216;
        const maxLeft = Math.max(8, desktopWorkspace.clientWidth - popoverWidth - 8);
        const safeLeft = Math.max(8, Math.min(maxLeft, offsetLeft));
        popoverMenu.style.left = `${safeLeft}px`;
      }
    };

    // Position immediately on initial load for the active 'File' menu
    const initialActive = document.querySelector('.gmenu-item.is-active') || gmenuItems[0];
    if (initialActive) {
      renderMenu(initialActive.dataset.menu || 'file', initialActive);
      updateMenuState(initialActive);
    }

    // Reposition on window resize
    window.addEventListener('resize', () => {
      if (!popoverMenu.hidden) {
        const active = document.querySelector('.gmenu-item.is-active');
        if (active) renderMenu(active.dataset.menu || 'file', active);
      }
    });

    // Dismiss on click outside
    document.addEventListener('click', (e) => {
      if (!popoverMenu.hidden && !popoverMenu.contains(e.target) && !e.target.closest('.gnome-global-menu')) {
        closeMenu();
      }
    });

    // Dismiss on Escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !popoverMenu.hidden) {
        closeMenu();
      }
    });

    gmenuItems.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menuKey = btn.dataset.menu || 'file';
        const isCurrentlyActive = btn.classList.contains('is-active') && !popoverMenu.hidden;

        if (isCurrentlyActive) {
          closeMenu();
        } else {
          openMenu(menuKey, btn);
        }
      });

      // Authentic desktop global menu behavior: hovering switches active menu while open
      btn.addEventListener('mouseenter', () => {
        if (!popoverMenu.hidden && !btn.classList.contains('is-active')) {
          const menuKey = btn.dataset.menu || 'file';
          openMenu(menuKey, btn);
        }
      });
    });
  }

  /* ── 6 · GNOME Extensions Pending Popover ─────────────────────────────── */
  const egoTrigger = document.getElementById('ego-trigger');
  const egoPopover = document.getElementById('ego-popover');
  const egoClose = document.getElementById('ego-close');

  if (egoTrigger && egoPopover) {
    const positionEgoPopover = () => {
      if (egoPopover.hidden) return;
      const triggerRect = egoTrigger.getBoundingClientRect();
      const popoverWidth = egoPopover.offsetWidth || 352;
      const alignRight = triggerRect.left + popoverWidth > window.innerWidth - 16;
      if (alignRight) {
        egoPopover.style.left = 'auto';
        egoPopover.style.right = '0';
        egoPopover.classList.add('is-aligned-right');
      } else {
        egoPopover.style.left = '0';
        egoPopover.style.right = 'auto';
        egoPopover.classList.remove('is-aligned-right');
      }
    };

    openEgoPopover = () => {
      if (typeof closeMockupMenu === 'function') {
        closeMockupMenu();
      }
      egoPopover.hidden = false;
      egoTrigger.setAttribute('aria-expanded', 'true');
      positionEgoPopover();
    };

    closeEgoPopover = () => {
      egoPopover.hidden = true;
      egoTrigger.setAttribute('aria-expanded', 'false');
      egoPopover.classList.remove('is-aligned-right');
    };

    egoTrigger.addEventListener('click', () => {
      if (egoPopover.hidden) {
        openEgoPopover();
      } else {
        closeEgoPopover();
      }
    });

    if (egoClose) {
      egoClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeEgoPopover();
        egoTrigger.focus();
      });
    }

    const egoAction = egoPopover.querySelector('.ego-popover__action');
    if (egoAction) {
      egoAction.addEventListener('click', () => {
        closeEgoPopover();
      });
    }

    document.addEventListener('click', (e) => {
      if (!egoPopover.hidden && !egoPopover.contains(e.target) && !egoTrigger.contains(e.target)) {
        closeEgoPopover();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !egoPopover.hidden) {
        closeEgoPopover();
        egoTrigger.focus();
      }
    });

    window.addEventListener('resize', () => {
      positionEgoPopover();
    });
  }
})();
