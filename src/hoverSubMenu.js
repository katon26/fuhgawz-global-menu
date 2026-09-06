/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * hoverSubMenu.js - Reusable macOS-style right-side hover flyout submenu menuItem.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

let Shell = null;
try {
    const mod = await import('gi://Shell');
    Shell = mod.default;
} catch (e) {}

const HOVER_CLOSE_DELAY_MS = 200;
const HOVER_OPEN_DELAY_MS = 200;
const POINTER_TOLERANCE_PX = 8;

export const PointerState = {
    INSIDE_TRIGGER: 0,
    INSIDE_SUBMENU: 1,
    BRIDGE: 2,
    OUTSIDE: 3,
};

/**
 * A popup menu item that opens a flyout submenu to the right on hover.
 * Implements macOS-style pointer tracking and diagonal corridor tolerance
 * so moving the cursor toward the flyout menu does not prematurely close it.
 */
export const HoverSubMenuMenuItem = GObject.registerClass(
    { GTypeName: 'FUHGlobeHoverSubMenuMenuItem' },
    class HoverSubMenuMenuItem extends PopupMenu.PopupBaseMenuItem {
        _init(title, parentMenu = null, params = {}) {
            super._init({
                reactive: true,
                can_focus: true,
                hover: true,
            });

            this.add_style_class_name('popup-submenu-menu-item');
            this.add_style_class_name('fuhgawz-hover-submenu-item');

            this._parentMenu = parentMenu;
            this._parentHoverSubmenu = parentMenu?._ownerSubMenu ?? null;
            this._childSubmenus = [];
            this._hoverCloseTimeoutId = 0;
            this._openDelayTimeoutId = 0;
            this._stageMotionId = 0;
            this._parentMenuCloseId = 0;
            this._siblingSignalIds = [];
            this._flyoutSignalIds = [];
            this._chromeAdded = false;
            this._isDestroyed = false;
            this._grab = null;
            this._lazyPopulate = typeof params.populate === 'function' ? params.populate : null;
            this._isPopulated = false;

            // Optional icon
            if (params.iconName || params.gicon) {
                const iconProps = {
                    style_class: 'popup-menu-icon',
                    y_align: Clutter.ActorAlign.CENTER,
                };
                if (params.gicon) {
                    iconProps.gicon = params.gicon;
                } else if (params.iconName) {
                    iconProps.icon_name = params.iconName;
                }
                this._icon = new St.Icon(iconProps);
                this.add_child(this._icon);
            }

            // Title label
            this.label = new St.Label({
                text: title,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            this.add_child(this.label);
            this.label_actor = this.label;

            // Right arrow
            this._arrowIcon = new St.Icon({
                icon_name: 'go-next-symbolic',
                style_class: 'popup-menu-arrow',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._arrowIcon);

            // Submenu flyout container (opens to the right)
            this.menu = new PopupMenu.PopupMenu(this.actor, 0.0, St.Side.LEFT);
            this.menu._ownerSubMenu = this;
            this.menu.actor.add_style_class_name('fuhgawz-hover-menu');
            this.menu.actor.track_hover = true;
            this.menu.actor.reactive = true;
            this.menu.actor.hide();

            this._flyoutHoverActor = this.menu.box ?? this.menu.actor;
            if (this._flyoutHoverActor) {
                this._flyoutHoverActor.track_hover = true;
                this._flyoutHoverActor.reactive = true;
            }

            // Wrap addMenuItem to automatically register child HoverSubMenuMenuItems
            const origAddMenuItem = this.menu.addMenuItem.bind(this.menu);
            this.menu.addMenuItem = (menuItem, position) => {
                origAddMenuItem(menuItem, position);
                if (menuItem instanceof HoverSubMenuMenuItem) {
                    this._registerChildSubmenu(menuItem);
                }
            };

            // Register with parent HoverSubMenuMenuItem if nested
            if (this._parentHoverSubmenu) {
                this._parentHoverSubmenu._registerChildSubmenu(this);
            }

            this._connectEvents();
            if (this._parentMenu) {
                this._connectParentSignals();
                if (this.menu) {
                    this.menu._setParent(this._parentMenu);
                }
            }
        }

        get isOpen() {
            return !!(this.menu && this.menu.isOpen);
        }

        setLazyPopulate(callback) {
            this._lazyPopulate = callback;
            this._isPopulated = false;
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

        _setParent(parent) {
            super._setParent(parent);
            if (!this._parentMenu && parent) {
                this._parentMenu = parent;
                this._connectParentSignals();
            }
            if (!this._parentHoverSubmenu && parent?._ownerSubMenu) {
                this._parentHoverSubmenu = parent._ownerSubMenu;
                this._parentHoverSubmenu._registerChildSubmenu(this);
            }
            if (this.menu && parent) {
                this.menu._setParent(parent);
            }
        }

        activate(_event) {
            this._cancelClose();
            this._cancelOpenDelay();
            this.open();
        }

        _connectEvents() {
            this.actor.connect('enter-event', () => {
                this._cancelClose();
                this._setSubmenuHover(true);
                this._scheduleOpen();
                return Clutter.EVENT_PROPAGATE;
            });

            this.actor.connect('leave-event', () => {
                this._cancelOpenDelay();
                if (this.isOpen) {
                    this._setSubmenuHover(true);
                }
                this._scheduleClose();
                return Clutter.EVENT_PROPAGATE;
            });

            this.actor.connect('button-press-event', () => {
                this._cancelClose();
                this._cancelOpenDelay();
                this.open();
                return Clutter.EVENT_STOP;
            });

            this.connect('activate', () => {
                this._cancelClose();
                this._cancelOpenDelay();
                this.open();
            });

            // Flyout menu box events
            if (this._flyoutHoverActor) {
                const enterId = this._flyoutHoverActor.connect('enter-event', () => {
                    this._cancelClose();
                    this._cancelOpenDelay();
                    this._setSubmenuHover(true);
                    return Clutter.EVENT_PROPAGATE;
                });
                this._flyoutSignalIds.push({ target: this._flyoutHoverActor, id: enterId });

                const leaveId = this._flyoutHoverActor.connect('leave-event', () => {
                    this._scheduleClose();
                    return Clutter.EVENT_PROPAGATE;
                });
                this._flyoutSignalIds.push({ target: this._flyoutHoverActor, id: leaveId });
            }

            // Keyboard navigation when focus is inside the flyout menu
            if (this.menu?.actor) {
                const keyPressId = this.menu.actor.connect('key-press-event', (_actor, event) => {
                    const symbol = event.get_key_symbol();
                    if (symbol === Clutter.KEY_Left) {
                        this.close();
                        if (typeof this.grab_key_focus === 'function') {
                            this.grab_key_focus();
                        }
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });
                this._flyoutSignalIds.push({ target: this.menu.actor, id: keyPressId });

                const capturedId = this.menu.actor.connect('captured-event', (_actor, event) => {
                    const eventType = event.type();
                    if (eventType === Clutter.EventType.BUTTON_PRESS || eventType === Clutter.EventType.TOUCH_BEGIN) {
                        let targetActor = null;
                        try {
                            if (typeof global !== 'undefined' && global.stage) {
                                targetActor = global.stage.get_event_actor(event);
                            }
                        } catch (e) {}

                        if (!targetActor) return Clutter.EVENT_PROPAGATE;

                        // 1. Click is inside this submenu flyout
                        if (this.menu && this.menu.actor && (this.menu.actor === targetActor || (this.menu.actor.contains && this.menu.actor.contains(targetActor)))) {
                            return Clutter.EVENT_PROPAGATE;
                        }

                        // 2. Click is inside an open child submenu flyout
                        if (this._childSubmenus) {
                            for (const child of this._childSubmenus) {
                                if (child && child.isOpen && child.menu?.actor && (child.menu.actor === targetActor || (child.menu.actor.contains && child.menu.actor.contains(targetActor)))) {
                                    return Clutter.EVENT_PROPAGATE;
                                }
                            }
                        }

                        // 3. Click is on trigger item, parent menu, or any ancestor trigger/menu
                        let isAncestor = false;
                        let p = this._parentHoverSubmenu;
                        while (p) {
                            if ((p.actor && (p.actor === targetActor || (p.actor.contains && p.actor.contains(targetActor)))) ||
                                (p.menu?.actor && (p.menu.actor === targetActor || (p.menu.actor.contains && p.menu.actor.contains(targetActor))))) {
                                isAncestor = true;
                                break;
                            }
                            p = p._parentHoverSubmenu;
                        }

                        if ((this.actor && (this.actor === targetActor || (this.actor.contains && this.actor.contains(targetActor)))) ||
                            (this._parentMenu?.actor && (this._parentMenu.actor === targetActor || (this._parentMenu.actor.contains && this._parentMenu.actor.contains(targetActor)))) ||
                            isAncestor) {
                            this.close();
                            return Clutter.EVENT_PROPAGATE;
                        }

                        // 4. Click is outside all menus - close entire chain
                        this.close();
                        this._closeEntireMenuChain();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });
                this._flyoutSignalIds.push({ target: this.menu.actor, id: capturedId });
            }

            // Close flyout and top menu when any leaf item inside this submenu is activated
            this.menu.connect('activate', (_menu, childItem) => {
                if (childItem instanceof HoverSubMenuMenuItem || childItem?._ownerSubMenu) {
                    return;
                }
                this.close();
                this._closeEntireMenuChain();
            });

            this.menu.connect('open-state-changed', (_menu, open) => {
                if (open) {
                    this._cancelClose();
                    this._startGlobalHoverMonitor();
                } else {
                    this._stopGlobalHoverMonitor();
                    this._setSubmenuHover(false);
                    if (this.menu?.actor) {
                        this.menu.actor.hide();
                    }
                }
            });
        }

        _connectParentSignals() {
            if (this._parentMenuCloseId === 0 && this._parentMenu) {
                this._parentMenuCloseId = this._parentMenu.connect('open-state-changed', (_menu, open) => {
                    if (!open) {
                        this.close();
                    }
                });
            }
        }

        _disconnectParentSignals() {
            if (this._parentMenuCloseId !== 0 && this._parentMenu) {
                try {
                    this._parentMenu.disconnect(this._parentMenuCloseId);
                } catch (e) {}
                this._parentMenuCloseId = 0;
            }
        }

        _connectSiblingSignals() {
            this._disconnectSiblingSignals();

            if (!this._parentMenu || typeof this._parentMenu._getMenuItems !== 'function') {
                return;
            }

            const items = this._parentMenu._getMenuItems();
            for (const item of items) {
                if (!item || item === this) continue;

                const actor = item.actor;
                if (!actor || actor === this.actor || !actor.reactive) continue;

                actor.track_hover = true;
                const signalId = actor.connect('enter-event', () => {
                    if (!this.isOpen) return Clutter.EVENT_PROPAGATE;
                    // Debounce close so diagonal movement across sibling boundary doesn't collapse flyout
                    this._scheduleClose();
                    return Clutter.EVENT_PROPAGATE;
                });
                this._siblingSignalIds.push({ actor, signalId });
            }
        }

        _disconnectSiblingSignals() {
            for (const { actor, signalId } of this._siblingSignalIds) {
                if (actor && signalId) {
                    try {
                        actor.disconnect(signalId);
                    } catch (e) {}
                }
            }
            this._siblingSignalIds = [];
        }

        _cancelClose() {
            if (this._hoverCloseTimeoutId) {
                GLib.source_remove(this._hoverCloseTimeoutId);
                this._hoverCloseTimeoutId = 0;
            }
        }

        _cancelOpenDelay() {
            if (this._openDelayTimeoutId) {
                GLib.source_remove(this._openDelayTimeoutId);
                this._openDelayTimeoutId = 0;
            }
        }

        _scheduleOpen() {
            this._cancelOpenDelay();
            if (this.isOpen) return;

            this._openDelayTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                HOVER_OPEN_DELAY_MS,
                () => {
                    this._openDelayTimeoutId = 0;
                    this.open();
                    return GLib.SOURCE_REMOVE;
                }
            );
            GLib.Source.set_name_by_id(this._openDelayTimeoutId, 'FUHGlobeHoverOpenDelay');
        }

        _scheduleClose() {
            if (this._hoverCloseTimeoutId !== 0) {
                return;
            }

            this._hoverCloseTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                HOVER_CLOSE_DELAY_MS,
                () => {
                    this._hoverCloseTimeoutId = 0;
                    const pointerState = this._getPointerState();
                    if (pointerState === PointerState.INSIDE_TRIGGER || pointerState === PointerState.INSIDE_SUBMENU) {
                        this._setSubmenuHover(true);
                        return GLib.SOURCE_REMOVE;
                    }

                    if (pointerState === PointerState.BRIDGE) {
                        this._setSubmenuHover(true);
                        this._scheduleClose();
                        return GLib.SOURCE_REMOVE;
                    }

                    this.close();
                    this._setSubmenuHover(false);
                    return GLib.SOURCE_REMOVE;
                }
            );
            GLib.Source.set_name_by_id(this._hoverCloseTimeoutId, 'FUHGlobeHoverCloseDelay');
        }

        _startGlobalHoverMonitor() {
            if (this._stageMotionId !== 0) return;

            if (typeof global !== 'undefined' && global.stage) {
                this._stageMotionId = global.stage.connect('motion-event', (_stage, event) => {
                    if (!this.isOpen) {
                        this._stopGlobalHoverMonitor();
                        return Clutter.EVENT_PROPAGATE;
                    }

                    let pointerX, pointerY;
                    try {
                        if (typeof event.get_coords === 'function') {
                            [pointerX, pointerY] = event.get_coords();
                        } else {
                            [pointerX, pointerY] = global.get_pointer();
                        }
                    } catch (e) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    const pointerState = this._getPointerState(pointerX, pointerY);
                    if (
                        pointerState === PointerState.INSIDE_TRIGGER ||
                        pointerState === PointerState.INSIDE_SUBMENU ||
                        pointerState === PointerState.BRIDGE
                    ) {
                        this._cancelClose();
                        this._setSubmenuHover(true);
                    } else if (pointerState === PointerState.OUTSIDE) {
                        this._scheduleClose();
                    }

                    return Clutter.EVENT_PROPAGATE;
                });
            }
        }

        _stopGlobalHoverMonitor() {
            if (this._stageMotionId !== 0) {
                if (typeof global !== 'undefined' && global.stage) {
                    try {
                        global.stage.disconnect(this._stageMotionId);
                    } catch (e) {}
                }
                this._stageMotionId = 0;
            }
        }

        _setSubmenuHover(shouldHover) {
            if (typeof this.setActive === 'function') {
                this.setActive(shouldHover);
            }

            if (typeof this.remove_style_pseudo_class === 'function') {
                if (shouldHover) {
                    this.add_style_pseudo_class('hover');
                } else {
                    this.remove_style_pseudo_class('hover');
                    this.remove_style_pseudo_class('active');
                    this.remove_style_pseudo_class('checked');
                }
            }

            if (this.actor) {
                if (typeof this.actor.set_hover === 'function') {
                    this.actor.set_hover(shouldHover);
                }
                if (typeof this.actor.remove_style_pseudo_class === 'function') {
                    if (shouldHover) {
                        this.actor.add_style_pseudo_class('hover');
                    } else {
                        this.actor.remove_style_pseudo_class('hover');
                        this.actor.remove_style_pseudo_class('active');
                        this.actor.remove_style_pseudo_class('checked');
                    }
                }
            }
        }

        _getActorBounds(actor) {
            if (!actor) return null;
            try {
                const [stageX, stageY] = actor.get_transformed_position();
                const [width, height] = actor.get_transformed_size();
                if (width === 0 || height === 0) return null;
                return {
                    x1: stageX,
                    y1: stageY,
                    x2: stageX + width,
                    y2: stageY + height,
                };
            } catch (e) {
                return null;
            }
        }

        _closeEntireMenuChain() {
            if (this._childSubmenus) {
                for (const child of this._childSubmenus) {
                    if (child.isOpen) {
                        child.close();
                    }
                }
            }

            let ancestor = this._parentHoverSubmenu;
            while (ancestor) {
                ancestor.close();
                ancestor = ancestor._parentHoverSubmenu;
            }

            let topMenu = this._parentMenu;
            if (topMenu && typeof topMenu._getTopMenu === 'function') {
                topMenu = topMenu._getTopMenu();
            } else {
                while (topMenu && topMenu._parent) {
                    topMenu = topMenu._parent;
                }
            }
            if (topMenu) {
                if (typeof topMenu.itemActivated === 'function') {
                    topMenu.itemActivated(BoxPointer.PopupAnimation.FULL);
                } else if (typeof topMenu.close === 'function') {
                    topMenu.close(BoxPointer.PopupAnimation.FULL);
                }
            }
        }

        _getPointerState(pointerX = undefined, pointerY = undefined) {
            if (!this.isOpen) {
                return PointerState.OUTSIDE;
            }

            if (pointerX === undefined || pointerY === undefined) {
                try {
                    [pointerX, pointerY] = global.get_pointer();
                } catch (e) {
                    return PointerState.INSIDE_SUBMENU;
                }
            }

            const triggerBounds = this._getActorBounds(this.actor ?? this);
            const flyoutBounds = this._getActorBounds(this.menu?.actor) ?? this._getActorBounds(this._flyoutHoverActor);

            const pointWithin = (bounds, tolerance = 0) =>
                bounds &&
                pointerX >= bounds.x1 - tolerance &&
                pointerX <= bounds.x2 + tolerance &&
                pointerY >= bounds.y1 - tolerance &&
                pointerY <= bounds.y2 + tolerance;

            // 1. Inside trigger menu item
            if (pointWithin(triggerBounds, POINTER_TOLERANCE_PX)) {
                return PointerState.INSIDE_TRIGGER;
            }

            // 2. Inside flyout menu
            if (pointWithin(flyoutBounds, POINTER_TOLERANCE_PX)) {
                return PointerState.INSIDE_SUBMENU;
            }

            // 3. Inside any child hover submenu that is currently open or pointer in descendant actor
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

            // Dynamic fallback for child HoverSubMenuMenuItems
            if (typeof this.menu._getMenuItems === 'function') {
                for (const item of this.menu._getMenuItems()) {
                    if (item instanceof HoverSubMenuMenuItem && item !== this && item.isOpen) {
                        const childState = item._getPointerState(pointerX, pointerY);
                        if (childState !== PointerState.OUTSIDE) {
                            return PointerState.INSIDE_SUBMENU;
                        }
                    }
                }
            }

            // If the flyout is open but its actor has not yet received its first layout allocation,
            // remain open so it does not collapse prematurely.
            if (!flyoutBounds) {
                return PointerState.INSIDE_SUBMENU;
            }

            if (!triggerBounds) {
                return PointerState.OUTSIDE;
            }

            // 4. Diagonal corridor bridge between trigger item and flyout
            const overlapTop = Math.min(triggerBounds.y1, flyoutBounds.y1) - POINTER_TOLERANCE_PX;
            const overlapBottom = Math.max(triggerBounds.y2, flyoutBounds.y2) + POINTER_TOLERANCE_PX;

            if (flyoutBounds.x1 >= triggerBounds.x2 - POINTER_TOLERANCE_PX) {
                // Flyout is to the right of the trigger
                const triggerRight = triggerBounds.x2;
                const flyoutLeft = flyoutBounds.x1;
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
            } else if (flyoutBounds.x2 <= triggerBounds.x1 + POINTER_TOLERANCE_PX) {
                // Flyout is to the left of the trigger (flipped near right screen edge)
                const triggerLeft = triggerBounds.x1;
                const flyoutRight = flyoutBounds.x2;
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

        _registerWithTopMenu() {
            let top = this._parentMenu;
            if (top && typeof top._getTopMenu === 'function') {
                top = top._getTopMenu();
            } else {
                while (top && top._parent) {
                    top = top._parent;
                }
            }
            if (top?.actor && typeof top.actor.contains === 'function') {
                if (!top.actor._origContains) {
                    top.actor._origContains = top.actor.contains.bind(top.actor);
                    top.actor._hoverSubmenuActors = new Set();
                    top.actor.contains = function(descendant) {
                        if (!descendant) return false;
                        if (top.actor._origContains(descendant)) return true;
                        for (const subActor of top.actor._hoverSubmenuActors) {
                            if (subActor && (subActor === descendant || (typeof subActor.contains === 'function' && subActor.contains(descendant)))) {
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
            if (top && typeof top._getTopMenu === 'function') {
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
            if (this._isDestroyed || !this.menu || this.menu.isOpen) return;

            this._cancelClose();
            this._connectSiblingSignals();
            this._setSubmenuHover(true);

            // Lazy populate child items if configured
            if (typeof this._lazyPopulate === 'function' && !this._isPopulated) {
                this._isPopulated = true;
                try {
                    this._lazyPopulate(this.menu);
                } catch (e) {
                    console.warn(`FUHGlobe: Error lazily populating submenu: ${e}`);
                }
            }

            // Close any sibling submenus that are currently open in the same parent menu
            if (this._parentHoverSubmenu && this._parentHoverSubmenu._childSubmenus) {
                for (const sibling of this._parentHoverSubmenu._childSubmenus) {
                    if (sibling !== this && sibling.isOpen) {
                        sibling.close();
                    }
                }
            }
            if (this._parentMenu && typeof this._parentMenu._getMenuItems === 'function') {
                for (const item of this._parentMenu._getMenuItems()) {
                    if (item instanceof HoverSubMenuMenuItem && item !== this && item.isOpen) {
                        item.close();
                    }
                }
            }

            // Lazily add to top chrome when opened
            if (!this._chromeAdded) {
                try {
                    Main.layoutManager.addTopChrome(this.menu.actor);
                    this._chromeAdded = true;
                } catch (e) {
                    // In testing environments without layoutManager chrome
                }
            }

            // Ensure parent/top menu's actor.contains includes our submenu flyout actor
            // so PopupMenuManager's modal grab does not prematurely close the menu on click
            this._registerWithTopMenu();

            if (this.menu.actor) {
                this.menu.actor.show();
            }
            this.menu.open(BoxPointer.PopupAnimation.FULL);

            // Manage internal grab token without raw stage grab to preserve PopupMenuManager modal grab
            if (!this._grab) {
                this._grab = {
                    actor: this.menu.actor,
                    dismissed: false,
                    dismiss() {
                        this.dismissed = true;
                    },
                };
            }

            this._startGlobalHoverMonitor();
        }

        close() {
            this._cancelOpenDelay();
            this._cancelClose();
            this._stopGlobalHoverMonitor();
            this._disconnectSiblingSignals();
            this._unregisterFromTopMenu();

            if (this._childSubmenus) {
                for (const child of this._childSubmenus) {
                    if (child.isOpen) {
                        child.close();
                    }
                }
            }

            if (this._grab) {
                try {
                    if (typeof this._grab.dismiss === 'function') {
                        this._grab.dismiss();
                    }
                } catch (e) {}
                this._grab = null;
            }

            if (this.menu && this.menu.isOpen) {
                this.menu.close(BoxPointer.PopupAnimation.FULL);
            }
            if (this.menu?.actor) {
                this.menu.actor.hide();
            }
            this._setSubmenuHover(false);
        }

        vfunc_key_press_event(event) {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Right) {
                this.open();
                if (this.menu && this.menu.actor) {
                    this.menu.actor.navigate_focus(null, St.DirectionType.DOWN, false);
                }
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.KEY_Left && this.isOpen) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return super.vfunc_key_press_event(event);
        }

        destroy() {
            if (this._isDestroyed) return;
            this._isDestroyed = true;
            this._cancelClose();
            this._cancelOpenDelay();
            this._stopGlobalHoverMonitor();
            this._disconnectParentSignals();
            this._disconnectSiblingSignals();
            this._unregisterFromTopMenu();

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

            if (this._grab) {
                try {
                    if (typeof this._grab.dismiss === 'function') {
                        this._grab.dismiss();
                    }
                } catch (e) {}
                this._grab = null;
            }

            for (const { target, id } of this._flyoutSignalIds) {
                if (target && id) {
                    try {
                        target.disconnect(id);
                    } catch (e) {}
                }
            }
            this._flyoutSignalIds = [];

            if (this.menu) {
                if (this.menu.actor) {
                    this.menu.actor.hide();
                }
                if (this._chromeAdded) {
                    try {
                        Main.layoutManager.removeChrome(this.menu.actor);
                    } catch (e) {}
                    this._chromeAdded = false;
                }
                this.menu.destroy();
                this.menu = null;
            }
            this._flyoutHoverActor = null;

            super.destroy();
        }
    }
);
