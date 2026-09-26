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
  let openMediaCard = null;
  let closeMediaCard = null;

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
    } else if (action === 'custom' && item.dataset.custom === 'theme') {
      close();
      if (typeof cycleTheme === 'function') {
        cycleTheme();
      }
      return;
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
      if (typeof closeMediaCard === 'function') {
        closeMediaCard();
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

  /* ── 5b · Dynamic Live Media Indicator & Floating Popover Card ── */
  const livePill = document.getElementById('gnome-live-pill');
  const mediaCard = document.getElementById('mockup-media-card');
  const trackTitle = document.getElementById('mockup-track-title');
  const trackArtist = document.getElementById('mockup-track-artist');
  const mediaPlayBtn = document.getElementById('media-play-btn');
  const mediaPrevBtn = document.getElementById('media-prev-btn');
  const mediaNextBtn = document.getElementById('media-next-btn');
  const mediaWaveform = document.querySelector('.mockup-media-card__waveform');
  const recentButtons = document.querySelectorAll('.mockup-media-card .recent-item');
  const livePillTextInner = document.querySelector('.live-pill__text-inner');

  if (livePill && mediaCard && desktopWorkspace) {
    let mediaGraceTimer = null;
    let isPlaying = true;
    const trackQueue = [
      { title: 'Gravity Chasm', artist: 'Conan · Blood Eagle' },
      { title: 'Hawk as Weapon', artist: 'Conan · Blood Eagle' },
      { title: 'Levitation Hoax', artist: 'Conan · Monnos' },
      { title: 'Foehammer', artist: 'Conan · Blood Eagle' },
    ];
    let currentTrackIdx = 0;

    const cancelGraceTimer = () => {
      if (mediaGraceTimer) {
        clearTimeout(mediaGraceTimer);
        mediaGraceTimer = null;
      }
    };

    const positionMediaCard = () => {
      if (mediaCard.hidden) return;
      const pillRect = livePill.getBoundingClientRect();
      const workspaceRect = desktopWorkspace.getBoundingClientRect();
      const offsetLeft = pillRect.left - workspaceRect.left;
      const cardWidth = mediaCard.offsetWidth || 280;
      const maxLeft = Math.max(6, desktopWorkspace.clientWidth - cardWidth - 6);
      const safeLeft = Math.max(6, Math.min(maxLeft, offsetLeft - 10));
      mediaCard.style.left = `${safeLeft}px`;
    };

    const setWaveformProgress = (ratio) => {
      if (!mediaWaveform) return;
      const bars = mediaWaveform.querySelectorAll('.wave-bar');
      const total = bars.length;
      const activeIdx = Math.min(total - 1, Math.max(0, Math.floor(ratio * total)));
      bars.forEach((bar, idx) => {
        bar.classList.toggle('is-played', idx <= activeIdx);
        bar.classList.toggle('is-active', idx === activeIdx);
      });
      const percent = Math.round(ratio * 100);
      mediaWaveform.setAttribute('aria-valuenow', String(percent));
    };

    const setTrack = (title, artist) => {
      if (trackTitle) {
        trackTitle.textContent = title;
        trackTitle.title = title;
      }
      if (trackArtist) {
        trackArtist.textContent = artist;
        trackArtist.title = artist;
      }
      const shortArtist = artist.includes('·') ? artist.split('·')[0].trim() : artist;
      const displayLabel = `Music · ${title}${shortArtist ? ` - ${shortArtist}` : ''}`;
      if (livePillTextInner) {
        livePillTextInner.textContent = displayLabel;
      }
      if (livePill) {
        livePill.setAttribute('aria-label', `Media playback indicator: ${displayLabel}`);
        livePill.setAttribute('title', `Live media playback: ${displayLabel} (hover or click to open controls)`);
      }
      setWaveformProgress(0.5);
    };

    const openCard = () => {
      cancelGraceTimer();
      if (typeof closeMockupMenu === 'function') {
        closeMockupMenu();
      }
      if (typeof closeEgoPopover === 'function') {
        closeEgoPopover();
      }
      mediaCard.hidden = false;
      livePill.setAttribute('aria-expanded', 'true');
      livePill.classList.add('is-active');
      positionMediaCard();
    };
    openMediaCard = openCard;

    const closeCard = () => {
      cancelGraceTimer();
      mediaCard.hidden = true;
      livePill.setAttribute('aria-expanded', 'false');
      livePill.classList.remove('is-active');
    };
    closeMediaCard = closeCard;

    const scheduleCloseCard = () => {
      cancelGraceTimer();
      mediaGraceTimer = setTimeout(closeCard, 240);
    };

    // Hover interactions with grace period
    livePill.addEventListener('mouseenter', () => {
      openCard();
    });

    livePill.addEventListener('mouseleave', () => {
      scheduleCloseCard();
    });

    mediaCard.addEventListener('mouseenter', () => {
      cancelGraceTimer();
    });

    mediaCard.addEventListener('mouseleave', () => {
      scheduleCloseCard();
    });

    // Click / touch toggle
    livePill.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelGraceTimer();
      if (mediaCard.hidden) {
        openCard();
      } else {
        closeCard();
      }
    });

    // Keyboard navigation on live pill
    livePill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (mediaCard.hidden) {
          openCard();
        } else {
          closeCard();
        }
      }
    });

    // Transport controls: Play / Pause
    if (mediaPlayBtn) {
      const pauseIcon = mediaPlayBtn.querySelector('.media-pause-icon');
      const playIcon = mediaPlayBtn.querySelector('.media-play-icon');

      const setPlaybackState = (playing) => {
        isPlaying = playing;
        if (pauseIcon) pauseIcon.style.display = playing ? 'inline' : 'none';
        if (playIcon) playIcon.style.display = playing ? 'none' : 'inline';
        const label = playing ? 'Pause playback' : 'Resume playback';
        mediaPlayBtn.setAttribute('aria-label', label);
        mediaPlayBtn.setAttribute('title', label);
        livePill.classList.toggle('live-pill--paused', !playing);
      };

      mediaPlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setPlaybackState(!isPlaying);
      });
    }

    // Previous & Next controls
    if (mediaPrevBtn) {
      mediaPrevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentTrackIdx = (currentTrackIdx - 1 + trackQueue.length) % trackQueue.length;
        const current = trackQueue[currentTrackIdx];
        setTrack(current.title, current.artist);
      });
    }

    if (mediaNextBtn) {
      mediaNextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentTrackIdx = (currentTrackIdx + 1) % trackQueue.length;
        const current = trackQueue[currentTrackIdx];
        setTrack(current.title, current.artist);
      });
    }

    // Recently played items
    recentButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const title = btn.dataset.title || btn.querySelector('.recent-item__title')?.textContent || 'Unknown';
        const rawArtist = btn.dataset.artist || btn.querySelector('.recent-item__artist')?.textContent || '';
        const artist = rawArtist ? (rawArtist.includes('·') ? rawArtist : `${rawArtist} · Conan`) : 'Conan · Blood Eagle';
        setTrack(title, artist);
        btn.style.background = 'rgba(255, 255, 255, 0.16)';
        setTimeout(() => { btn.style.background = ''; }, 180);
      });
    });

    // Waveform scrubbing & keyboard seeking
    if (mediaWaveform) {
      let currentProgress = 0.5;
      const updateProgress = (ratio) => {
        currentProgress = Math.max(0, Math.min(1, ratio));
        setWaveformProgress(currentProgress);
      };

      mediaWaveform.addEventListener('click', (e) => {
        e.stopPropagation();
        const bar = e.target.closest('.wave-bar');
        const bars = [...mediaWaveform.querySelectorAll('.wave-bar')];
        if (bar && bars.length) {
          const index = bars.indexOf(bar);
          updateProgress((index + 1) / bars.length);
        } else {
          const rect = mediaWaveform.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / (rect.width || 1);
          updateProgress(ratio);
        }
      });

      mediaWaveform.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          updateProgress(currentProgress + 0.05);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          updateProgress(currentProgress - 0.05);
        } else if (e.key === 'Home') {
          e.preventDefault();
          updateProgress(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          updateProgress(1);
        }
      });
    }

    // Dismiss on click outside
    document.addEventListener('click', (e) => {
      if (!mediaCard.hidden && !mediaCard.contains(e.target) && !livePill.contains(e.target)) {
        closeCard();
      }
    });

    // Dismiss on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !mediaCard.hidden) {
        closeCard();
        livePill.focus();
      }
    });

    // Reposition on resize
    window.addEventListener('resize', () => {
      if (!mediaCard.hidden) {
        positionMediaCard();
      }
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
      if (typeof closeMediaCard === 'function') {
        closeMediaCard();
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

  /* ── 7 · Install Card Tabs (Release vs Source) ────────────────────────── */
  const headerbarTabs = document.querySelectorAll('.headerbar-tab');
  const installCode = document.getElementById('install-code');
  const installCopyBtn = document.getElementById('install-copy-btn');

  const installSnippets = {
    release: {
      code: '<span class="tok-accent">$</span> curl -sLO https://github.com/katon26/fuhgawz-global-menu/releases/latest/download/fuhgawzglbmenu@katon26.github.io.shell-extension.zip\n<span class="tok-accent">$</span> gnome-extensions install --force fuhgawzglbmenu@katon26.github.io.shell-extension.zip\n<span class="tok-accent">$</span> gnome-extensions enable fuhgawzglbmenu@katon26.github.io',
      copy: 'curl -sLO https://github.com/katon26/fuhgawz-global-menu/releases/latest/download/fuhgawzglbmenu@katon26.github.io.shell-extension.zip\ngnome-extensions install --force fuhgawzglbmenu@katon26.github.io.shell-extension.zip\ngnome-extensions enable fuhgawzglbmenu@katon26.github.io'
    },
    source: {
      code: '<span class="tok-accent">$</span> git clone https://github.com/katon26/fuhgawz-global-menu\n<span class="tok-accent">$</span> cd fuhgawz-global-menu\n<span class="tok-accent">$</span> ./install.sh\n<span class="tok-accent">$</span> gnome-extensions enable fuhgawzglbmenu@katon26.github.io',
      copy: 'git clone https://github.com/katon26/fuhgawz-global-menu\ncd fuhgawz-global-menu\n./install.sh\ngnome-extensions enable fuhgawzglbmenu@katon26.github.io'
    }
  };

  if (headerbarTabs.length && installCode && installCopyBtn) {
    const activateTab = (tab) => {
      headerbarTabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
        t.setAttribute('tabindex', active ? '0' : '-1');
      });
      const target = tab.dataset.target || 'release';
      const snippet = installSnippets[target] || installSnippets.release;
      installCode.innerHTML = `<code>${snippet.code}</code>`;
      installCopyBtn.dataset.copy = snippet.copy;
    };

    headerbarTabs.forEach((tab, index) => {
      tab.setAttribute('tabindex', tab.classList.contains('is-active') ? '0' : '-1');
      tab.addEventListener('click', () => {
        activateTab(tab);
      });

      tab.addEventListener('keydown', (e) => {
        let nextIndex = index;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          nextIndex = (index + 1) % headerbarTabs.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          nextIndex = (index - 1 + headerbarTabs.length) % headerbarTabs.length;
        } else if (e.key === 'Home') {
          e.preventDefault();
          nextIndex = 0;
        } else if (e.key === 'End') {
          e.preventDefault();
          nextIndex = headerbarTabs.length - 1;
        } else {
          return;
        }
        const nextTab = headerbarTabs[nextIndex];
        if (nextTab) {
          nextTab.focus();
          activateTab(nextTab);
        }
      });
    });
  }

  /* ── 8 · Theme — system · light · dark ───────────────────────────────── */
  const THEME_KEY = 'fuhgawz-theme';
  const THEME_FACES = {
    system: { label: 'Theme: system. Switch to light', title: 'System theme' },
    light: { label: 'Theme: light. Switch to dark', title: 'Light theme' },
    dark: { label: 'Theme: dark. Switch to system', title: 'Dark theme' },
  };
  const THEME_COLORS = { light: '#f8fafd', dark: '#191d24' };

  const themeToggle = document.getElementById('theme-toggle');
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  const schemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme(preference, persist) {
    const root = document.documentElement;
    const resolved = preference === 'system'
      ? (schemeQuery.matches ? 'dark' : 'light')
      : preference;

    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    if (persist) {
      try { localStorage.setItem(THEME_KEY, preference); } catch (_) { /* storage blocked */ }
    }

    if (themeToggle) {
      themeToggle.dataset.themeValue = preference;
      themeToggle.setAttribute('aria-label', THEME_FACES[preference].label);
      themeToggle.title = THEME_FACES[preference].title;
    }
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', THEME_COLORS[resolved]);
    }
  }

  function cycleTheme() {
    const order = ['system', 'light', 'dark'];
    const current = document.documentElement.dataset.themePreference || 'system';
    applyTheme(order[(order.indexOf(current) + 1) % order.length], true);
  }

  if (themeToggle) {
    /* the head bootstrap already picked the theme; this only syncs the control */
    applyTheme(document.documentElement.dataset.themePreference || 'system', false);
    themeToggle.addEventListener('click', cycleTheme);

    const followSystem = () => {
      if ((document.documentElement.dataset.themePreference || 'system') === 'system') {
        applyTheme('system', false);
      }
    };
    if (schemeQuery.addEventListener) {
      schemeQuery.addEventListener('change', followSystem);
    } else if (schemeQuery.addListener) {
      schemeQuery.addListener(followSystem);
    }
  }
})();
