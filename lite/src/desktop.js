// Page script for the normal youtube.com site (not the TV interface).
// Adds a large round fullscreen button inside the player, because the one in YouTube's own control bar is small for a finger.
// Only YouTube's own markup is used (#movie_player, .ytp-fullscreen-button, .ytp-autohide), nothing here depends on its scripts.
// Styles are set through element.style (YouTube's content security policy and Trusted Types do not allow markup injection).
(() => {
    'use strict';

    if (window.top !== window) return;
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
    if (window.__ultraytDesktop) return;
    window.__ultraytDesktop = { version: '0.3.0' };

    const BUTTON_ID = 'ultrayt-fullscreen';
    const SIZE = 76;      // css pixels
    const SVG_NS = 'http://www.w3.org/2000/svg';

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

    let button = null;
    let observed = null;
    let observer = null;

    function applyStyle(el, rules) {
        for (const [name, value] of Object.entries(rules)) el.style.setProperty(name, value, 'important');
    }

    function drawIcon(state) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '46');
        svg.setAttribute('height', '46');
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
            right: '20px',
            bottom: '88px',
            width: SIZE + 'px',
            height: SIZE + 'px',
            'min-width': SIZE + 'px',
            padding: '0',
            margin: '0',
            border: '2px solid rgba(255, 255, 255, 0.35)',
            'border-radius': '50%',
            background: 'rgba(0, 0, 0, 0.62)',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'z-index': '2000',
            cursor: 'pointer',
            outline: 'none',
            'touch-action': 'manipulation',
            '-webkit-tap-highlight-color': 'transparent',
            transition: 'opacity 0.25s, background 0.15s'
        });

        // the player listens for clicks and touches to pause the video and to show its controls, the button must not trigger that
        for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'contextmenu']) {
            el.addEventListener(type, (event) => event.stopPropagation());
        }

        el.addEventListener('pointerdown', () => el.style.setProperty('background', 'rgba(60, 60, 60, 0.85)', 'important'));
        for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
            el.addEventListener(type, () => el.style.setProperty('background', 'rgba(0, 0, 0, 0.62)', 'important'));
        }

        el.addEventListener('click', (event) => {
            event.preventDefault();
            const player = el.parentElement;
            if (player) toggleFullscreen(player);
        });

        return el;
    }

    // the button follows the player's controls: visible together with them, hidden when they fade out
    function syncVisibility() {
        if (!button || !button.parentElement) return;

        const hidden = button.parentElement.classList.contains('ytp-autohide');
        button.style.setProperty('opacity', hidden ? '0' : '1', 'important');
        button.style.setProperty('pointer-events', hidden ? 'none' : 'auto', 'important');
    }

    function syncIcon() {
        if (!button) return;

        const state = isFullscreen() ? 'exit' : 'enter';
        if (button.dataset.state === state) return;

        button.dataset.state = state;
        button.setAttribute('aria-label', labels[state]);
        button.title = labels[state];
        button.replaceChildren(drawIcon(state));
    }

    function watchPlayer(player) {
        if (observed === player) return;

        observer?.disconnect();
        observed = player;
        observer = new MutationObserver(syncVisibility);
        observer.observe(player, { attributes: true, attributeFilter: ['class'] });
    }

    // YouTube is a single page application: the player is created and replaced without a page load, so look again from time to time
    function ensure() {
        const player = document.getElementById('movie_player');
        if (!player) return;

        if (!button) button = createButton();
        if (button.parentElement !== player) player.appendChild(button);

        watchPlayer(player);
        syncIcon();
        syncVisibility();
    }

    document.addEventListener('fullscreenchange', syncIcon);
    document.addEventListener('yt-navigate-finish', ensure);
    setInterval(ensure, 500);
    ensure();
})();
