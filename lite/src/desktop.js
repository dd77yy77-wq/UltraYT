// Page script for the normal youtube.com site (not the TV interface).
// Adds a large round fullscreen button inside the player, because the one in YouTube's own control bar is small for a finger.
// Only YouTube's own markup is used (#movie_player, .ytp-fullscreen-button, .ytp-autohide, .ytp-settings-button), nothing here depends on its scripts.
// Styles are set through element.style (YouTube's content security policy and Trusted Types do not allow markup injection).
//
// The taps are handled here, in the first (capture) listeners on the window, by the position of the finger and not by the element
// that was hit: this script runs before the page does, so YouTube's own touch and mouse handlers (which pause the video, seek on a
// double tap, cancel clicks, hide the controls in the middle of a tap) can neither take the tap nor break it.
(() => {
    'use strict';

    if (window.top !== window) return;
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
    if (window.__ultraytDesktop) return;

    const config = {
        activityMs: 4000,     // how long the button stays after the last touch in the player, even if YouTube hides its controls already
        fallbackMs: 800,      // when fullscreen did not change this long after a press, ask the browser for it directly
        passMs: 500           // after a touch that was not for the button, taps keep going through to the player for this long
    };
    window.__ultraytDesktop = { version: '0.3.2', config };

    const BUTTON_ID = 'ultrayt-fullscreen';
    const CIRCLE = 104;     // the visible round button, css pixels
    const MARGIN = 22;      // transparent ring around it that also takes the tap, so a finger does not have to hit the middle
    const HIT = CIRCLE + MARGIN * 2;
    const ICON = 60;
    const SLACK = 30;       // how far a finger may slide off the button between touching it and lifting
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // distance of the visible circle from the bottom edge of the player: just above the control bar in the window,
    // higher in fullscreen where the control bar and the things above it are bigger
    const BOTTOM_NORMAL = 88;
    const BOTTOM_FULLSCREEN = 176;
    const SIDE = 20;

    const COLOR = 'rgba(0, 0, 0, 0.62)';
    const COLOR_PRESSED = 'rgba(70, 70, 70, 0.9)';

    const russian = /^ru\b/i.test(navigator.language || '');
    const labels = {
        enter: russian ? 'Во весь экран' : 'Full screen',
        exit: russian ? 'Выйти из полноэкранного режима' : 'Exit full screen'
    };

    // four corners going out / going in
    const paths = {
        enter: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'],
        exit: ['M9 4v5H4', 'M20 9h-5V4', 'M15 20v-5h5', 'M4 15h5v5']
    };

    let button = null;       // the transparent square that takes the tap
    let circle = null;       // the round picture inside it
    let shown = false;       // whether the button is visible and takes taps right now
    let activeUntil = 0;     // time until which the button stays after the last touch in the player
    let press = null;        // the finger that went down on the button: { id }
    let lastClaim = -Infinity; // when the button last took a press, the mouse events and the click that follow it are the button's too
    let passUntil = 0;       // until then the button does not become the target of the tap that just woke it up
    let swallowTouch = false;
    let observed = null;
    let observers = [];

    const now = () => performance.now();

    function applyStyle(el, rules) {
        for (const [name, value] of Object.entries(rules)) el.style.setProperty(name, value, 'important');
    }

    function drawIcon(state) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', String(ICON));
        svg.setAttribute('height', String(ICON));
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', '#fff');
        svg.setAttribute('stroke-width', '2.4');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.pointerEvents = 'none';

        for (const d of paths[state]) {
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', d);
            svg.appendChild(path);
        }

        return svg;
    }

    function isFullscreen() {
        return !!document.fullscreenElement;
    }

    function request(player, enter) {
        try {
            const result = enter ? player.requestFullscreen?.() : document.exitFullscreen?.();
            result?.catch?.(() => {});
        } catch {}
    }

    function toggleFullscreen(player) {
        const wasFullscreen = isFullscreen();

        // YouTube's own button keeps its own behaviour (same state, same animation), so press it when it exists
        const native = player.querySelector('.ytp-fullscreen-button');
        if (native) native.click();
        else request(player, !wasFullscreen);

        // YouTube's button is not always willing (an advertisement, a menu in the way), then do what it should have done
        setTimeout(() => {
            if (isFullscreen() === wasFullscreen) request(player, !wasFullscreen);
        }, config.fallbackMs);
    }

    function createButton() {
        const el = document.createElement('button');
        el.id = BUTTON_ID;
        el.type = 'button';
        applyStyle(el, {
            position: 'absolute',
            right: (SIDE - MARGIN) + 'px',
            bottom: (BOTTOM_NORMAL - MARGIN) + 'px',
            width: HIT + 'px',
            height: HIT + 'px',
            'min-width': HIT + 'px',
            padding: '0',
            margin: '0',
            border: '0',
            'border-radius': '0',
            background: 'transparent',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'z-index': '2147483000',
            cursor: 'pointer',
            outline: 'none',
            'touch-action': 'none',
            'user-select': 'none',
            '-webkit-user-select': 'none',
            '-webkit-tap-highlight-color': 'transparent',
            transition: 'opacity 0.25s'
        });

        circle = document.createElement('span');
        applyStyle(circle, {
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            width: CIRCLE + 'px',
            height: CIRCLE + 'px',
            'border-radius': '50%',
            border: '2px solid rgba(255, 255, 255, 0.35)',
            'box-sizing': 'border-box',
            background: COLOR,
            'pointer-events': 'none',
            transition: 'background 0.15s'
        });
        el.appendChild(circle);

        // the keyboard (Enter or Space on the focused button) is the only click that reaches the button itself, taps are handled below
        el.addEventListener('click', (event) => {
            if (event.detail !== 0) return;
            event.preventDefault();
            if (el.parentElement) toggleFullscreen(el.parentElement);
        });

        return el;
    }

    function paintPressed(pressed) {
        circle?.style.setProperty('background', pressed ? COLOR_PRESSED : COLOR, 'important');
    }

    // the button follows the player's controls and stays a little longer after a touch, so it is there when the finger arrives
    // it steps aside while YouTube's settings menu is open, which opens in the same corner
    function syncVisibility() {
        if (!button || !button.parentElement) return;

        const player = button.parentElement;
        const menuOpen = !!player.querySelector('.ytp-settings-button[aria-expanded="true"]');
        const controlsShown = !player.classList.contains('ytp-autohide');
        shown = !menuOpen && (controlsShown || press !== null || now() < activeUntil);

        // a tap that woke the button up belongs to the player (the click comes after the touch and must not land on the new button)
        const takesTaps = shown && now() >= passUntil;

        button.style.setProperty('opacity', shown ? '1' : '0', 'important');
        button.style.setProperty('pointer-events', takesTaps ? 'auto' : 'none', 'important');
    }

    function syncState() {
        if (!button) return;

        const fullscreen = isFullscreen();
        const state = fullscreen ? 'exit' : 'enter';

        button.style.setProperty('bottom', ((fullscreen ? BOTTOM_FULLSCREEN : BOTTOM_NORMAL) - MARGIN) + 'px', 'important');

        if (button.dataset.state === state) return;

        button.dataset.state = state;
        button.setAttribute('aria-label', labels[state]);
        button.title = labels[state];
        circle.replaceChildren(drawIcon(state));
    }

    function watchPlayer(player) {
        if (observed === player) return;

        for (const observer of observers) observer.disconnect();
        observed = player;

        const onClass = new MutationObserver(syncVisibility);
        onClass.observe(player, { attributes: true, attributeFilter: ['class'] });

        const onMenu = new MutationObserver(syncVisibility);
        onMenu.observe(player, { attributes: true, attributeFilter: ['aria-expanded'], subtree: true });

        observers = [onClass, onMenu];
    }

    // YouTube is a single page application: the player is created and replaced without a page load, so look again from time to time
    function ensure() {
        const player = document.getElementById('movie_player');
        if (!player) return;

        if (!button) button = createButton();
        if (button.parentElement !== player) player.appendChild(button);

        watchPlayer(player);
        syncState();
        syncVisibility();
    }

    // ---- taps ----

    function inside(x, y, slack = 0) {
        if (!shown || !button || !button.isConnected) return false;

        const box = button.getBoundingClientRect();
        return x >= box.left - slack && x <= box.right + slack && y >= box.top - slack && y <= box.bottom + slack;
    }

    // any touch in the player keeps the button around for a while
    function noteActivity(event) {
        if (observed && event.target instanceof Node && observed.contains(event.target)) {
            activeUntil = now() + config.activityMs;
            syncVisibility();
        }
    }

    function take(event) {
        event.stopImmediatePropagation();
        if (event.cancelable) event.preventDefault();
    }

    function onPointerDown(event) {
        const primary = event.isPrimary && (event.pointerType !== 'mouse' || event.button === 0);

        if (primary && inside(event.clientX, event.clientY)) {
            press = { id: event.pointerId };
            lastClaim = now();
            paintPressed(true);
            take(event);
            return;
        }

        passUntil = now() + config.passMs;
        noteActivity(event);
    }

    function onPointerUp(event) {
        if (!press || press.id !== event.pointerId) {
            passUntil = now() + config.passMs;
            return;
        }

        const hit = inside(event.clientX, event.clientY, SLACK);
        press = null;
        lastClaim = now();
        paintPressed(false);
        take(event);

        activeUntil = now() + config.activityMs;
        if (hit && button.parentElement) toggleFullscreen(button.parentElement);
        syncVisibility();
    }

    function onPointerCancel(event) {
        if (!press || press.id !== event.pointerId) return;

        press = null;
        paintPressed(false);
        syncVisibility();
    }

    // what the browser makes of a tap afterwards (mouse events, click, menu on a long press) belongs to the button as well
    function onFollowUp(event) {
        const recent = press !== null || now() - lastClaim < 1000 || event.type === 'contextmenu'; // a menu never opens over the button
        if (recent && inside(event.clientX, event.clientY, SLACK)) take(event);
    }

    function onTouchStart(event) {
        const touch = event.changedTouches[0];

        if (touch && inside(touch.clientX, touch.clientY) && !(press === null && now() < passUntil)) {
            swallowTouch = true;
            event.stopImmediatePropagation();
            return;
        }

        noteActivity(event);
    }

    function onTouchGoing(event) {
        if (!swallowTouch) return;

        event.stopImmediatePropagation();
        if (event.type !== 'touchmove' && event.touches.length === 0) swallowTouch = false;
    }

    const capture = { capture: true };

    window.addEventListener('pointerdown', onPointerDown, capture);
    window.addEventListener('pointerup', onPointerUp, capture);
    window.addEventListener('pointercancel', onPointerCancel, capture);
    window.addEventListener('pointermove', noteActivity, capture);
    window.addEventListener('mousemove', noteActivity, capture);

    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) {
        window.addEventListener(type, onFollowUp, capture);
    }

    window.addEventListener('touchstart', onTouchStart, capture);
    for (const type of ['touchmove', 'touchend', 'touchcancel']) {
        window.addEventListener(type, onTouchGoing, capture);
    }

    document.addEventListener('fullscreenchange', syncState);
    document.addEventListener('yt-navigate-finish', ensure);
    setInterval(ensure, 500);
    setInterval(syncVisibility, 250);
    ensure();
})();
