// Page script for the normal youtube.com site (not the TV interface).
// Adds a large round fullscreen button inside the player, because the one in YouTube's own control bar is small for a finger.
// Only YouTube's own markup is used (#movie_player, .ytp-fullscreen-button, .ytp-autohide, .ytp-settings-button), nothing here depends on its scripts.
// Styles are set through element.style (YouTube's content security policy and Trusted Types do not allow markup injection).
(() => {
    'use strict';

    if (window.top !== window) return;
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
    if (window.__ultraytDesktop) return;
    window.__ultraytDesktop = { version: '0.3.1' };

    const BUTTON_ID = 'ultrayt-fullscreen';
    const CIRCLE = 104;     // the visible round button, css pixels
    const MARGIN = 22;      // transparent ring around it that also takes the tap, so a finger does not have to hit the middle
    const HIT = CIRCLE + MARGIN * 2;
    const ICON = 60;
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

    let button = null;   // the transparent square that takes the tap
    let circle = null;   // the round picture inside it
    let observed = null;
    let observers = [];

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

    function toggleFullscreen(player) {
        // YouTube's own button keeps its own behaviour (same state, same animation), so press it when it exists
        const native = player.querySelector('.ytp-fullscreen-button');
        if (native) {
            native.click();
            return;
        }

        if (isFullscreen()) document.exitFullscreen?.();
        else player.requestFullscreen?.();
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
            'touch-action': 'manipulation',
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

        // the player listens for clicks and touches to pause the video and to show its controls, the button must not trigger that
        for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'contextmenu']) {
            el.addEventListener(type, (event) => event.stopPropagation());
        }

        el.addEventListener('pointerdown', () => circle.style.setProperty('background', COLOR_PRESSED, 'important'));
        for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
            el.addEventListener(type, () => circle.style.setProperty('background', COLOR, 'important'));
        }

        el.addEventListener('click', (event) => {
            event.preventDefault();
            const player = el.parentElement;
            if (player) toggleFullscreen(player);
        });

        return el;
    }

    // the button follows the player's controls: visible together with them, hidden when they fade out
    // it also steps aside while YouTube's settings menu is open, which opens in the same corner
    function syncVisibility() {
        if (!button || !button.parentElement) return;

        const player = button.parentElement;
        const menuOpen = !!player.querySelector('.ytp-settings-button[aria-expanded="true"]');
        const hidden = player.classList.contains('ytp-autohide') || menuOpen;

        button.style.setProperty('opacity', hidden ? '0' : '1', 'important');
        button.style.setProperty('pointer-events', hidden ? 'none' : 'auto', 'important');
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

    document.addEventListener('fullscreenchange', syncState);
    document.addEventListener('yt-navigate-finish', ensure);
    setInterval(ensure, 500);
    ensure();
})();
