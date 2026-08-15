/* Hallmark · Cobalt microinteractions — reveal-once, hero type-in, copy, ⌘K palette.
 * All motion gates behind prefers-reduced-motion; reduced-motion ships static + visible.
 */
(() => {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 1 · Reveal once ─────────────────────────────────────────────────── */
  const revealEls = document.querySelectorAll('[data-reveal]');
  if (reduced || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealEls.forEach((el) => io.observe(el));
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
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const payload = btn.dataset.copy;
      const original = btn.textContent;
      try {
        await navigator.clipboard.writeText(payload);
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

  /* ── 4 · ⌘K command palette ─────────────────────────────────────────── */
  const palette = document.getElementById('palette');
  const trigger = document.getElementById('cmd-trigger');
  if (!palette || !trigger) return;

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
      navigator.clipboard
        .writeText(item.dataset.copy)
        .then(() => { item.querySelector('span').textContent = 'Copied — run it anywhere'; })
        .catch(() => {});
      window.setTimeout(close, 900);
      return;
    } else if (action === 'link') {
      window.open(item.dataset.href, '_blank', 'noopener');
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
})();
