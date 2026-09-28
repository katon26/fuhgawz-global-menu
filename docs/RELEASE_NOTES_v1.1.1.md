# FUHGAWZ Global Menu v1.1.1

[![GNOME Shell 45-51](https://img.shields.io/badge/GNOME%20Shell-45%20%7C%2046%20%7C%2047%20%7C%2048%20%7C%2049%20%7C%2050%20%7C%2051-blue.svg)](https://extensions.gnome.org)
[![License: GPL-2.0](https://img.shields.io/badge/License-GPL--2.0-green.svg)](LICENSE)
[![Release: v1.1.1](https://img.shields.io/badge/Release-v1.1.1-brightgreen.svg)](https://github.com/katon26/fuhgawz-global-menu/releases/tag/v1.1.1)

We are pleased to announce the **v1.1.1 release of FUHGAWZ Global Menu**.

This release introduces an intelligent **idle global menu collapse and live indicator reveal state model**, **keyboard and click pinning** for the floating media card, **scrubbing and marquee stability fixes**, and expanded **Libadwaita preferences controls**.

---

## Major Highlights

### 1. Idle Global Menu Collapse & Live Indicator Reveal
When media playback or background tasks are active, the top-left global menu buttons automatically collapse to give full visual prominence to the live indicator chip:
* **Zone Hover Expansion**: Moving the cursor into the top-left menu area smoothly reveals the global menu items with configurable 180ms ease-out animations.
* **Slot Reservation**: Panel geometry is reserved so top bar indicators never jump, jitter, or shift during transitions.
* **Configurable State**: Toggle between idle collapse or continuous side-by-side display via preferences.

### 2. Media Popover Pinning & Keyboard Controls (`src/taskIndicatorButton.js`)
* **Click & Keyboard Pinning**: Pin the floating media card open using **F10**, **Alt+F**, or direct card interaction.
* **Suppressed Dismissal**: Prevents accidental popover closure while scrubbing tracks or browsing playback history.
* **Quick Dismissal**: Press **Escape** or toggle **F10** to unpin and cleanly close the card.

### 3. Waveform Seek Scrubbing Polish (`src/mediaFloatingCard.js`)
* **Accurate Seeking**: Fixed an issue where clicking on an unallocated waveform area incorrectly jumped playback to `0:00`.
* **Throttled Scrubbing**: Real-time seek scrubbing is throttled to 120ms with committed press/release offsets, preventing D-Bus command flooding.

### 4. Marquee Stability & Player Title Normalization
* **Marquee Label Width Pinning**: Pinned track title container width to eliminate top bar stutter and layout shifts during scrolling text.
* **Player Name Normalization**: Prioritized MPRIS `Identity` properties over raw process instance identifiers (e.g. "Firefox" instead of "instance4321").

---

## What's Changed in v1.1.1

<details>
<summary><strong>Click to expand full changelog</strong></summary>

### Features & Motion
* Idle menu collapse state model with smooth reveal on pointer zone entry.
* Floating media card keyboard pinning (`F10`, `Alt+F`, `Escape`) and click pinning.
* Live indicator reveal animation options (`slide-fade`, `fade`, `none`) with custom durations (0–400ms).
* New GSettings schema keys: `menu-hide-when-idle`, `task-indicator-reveal`, `task-indicator-reveal-ms`, `task-indicator-reduced-motion`, `indicator-hide-on-hover`, and `indicator-hide-return`.

### Bug Fixes & Refinements
* Fixed seek-to-zero bug on unallocated waveform canvas; throttled seek updates to 120ms.
* Fixed player title fallback displaying raw `instance(number)` names.
* Fixed top bar wobble during marquee title scrolling.
* Fixed pointer leave race conditions dismissing media cards during multi-level submenu navigation.
</details>

---

## Installation & Verification

### Quick Install from GitHub Release
```bash
# 1. Download the release archive
wget https://github.com/katon26/fuhgawz-global-menu/releases/download/v1.1.1/fuhgawzglbmenu@katon26.github.io.shell-extension.zip

# 2. Install using GNOME Extensions CLI
gnome-extensions install --force fuhgawzglbmenu@katon26.github.io.shell-extension.zip

# 3. Enable the extension
gnome-extensions enable fuhgawzglbmenu@katon26.github.io
```

---

**Full Changelog**: https://github.com/katon26/fuhgawz-global-menu/commits/v1.1.1
