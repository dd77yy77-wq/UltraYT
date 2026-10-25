// UltraYT Lite: runs in every page before its own scripts.
// Gamepad support: YouTube TV (leanback) expects gamepad buttons as key events whose keyCode is 32768 + the button index
// (starboard key codes), so this script polls the Gamepad API and emits those key events.
(function () {
    'use strict';

    if (window.top !== window) return;                       // only the page itself, not frames (ads, sign-in frames)
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return; // only YouTube
    if (window.__ultraytLite) return;
    window.__ultraytLite = { version: '0.3.1' };

    var BUTTON_OFFSET = 32768;
    var AXIS_THRESHOLD = 0.5;
    var REPEAT_DELAY = 500;
    var REPEAT_INTERVAL = 100;

    // axes are read as virtual buttons past the real ones: 17/18 left stick up/down, 19/20 left/right,
    // 21/22 right stick up/down, 23/24 left/right (same numbers as in the Electron version)
    var AXIS_BUTTONS = [[19, 20], [17, 18], [23, 24], [21, 22]];

    var pads = {};
    var repeatTimer = null;

    function emit(type, code) {
        var event = new Event(type);
        event.keyCode = code;
        document.dispatchEvent(event);
    }

    function buttonDown(code) {
        if (document.hasFocus()) emit('keydown', code);
    }

    function buttonUp(code) {
        emit('keyup', code); // always sent, so a key cannot stay pressed when the window loses focus
    }

    function stopRepeat() {
        clearTimeout(repeatTimer);
        clearInterval(repeatTimer);
    }

    function startRepeat(code) {
        stopRepeat();
        repeatTimer = setInterval(function () { buttonDown(code); }, REPEAT_INTERVAL);
    }

    function press(code) {
        buttonDown(code);
        stopRepeat();
        repeatTimer = setTimeout(function () { startRepeat(code); }, REPEAT_DELAY);
    }

    function release(code) {
        buttonUp(code);
        stopRepeat();
    }

    function releaseAll(state) {
        Object.keys(state.buttons).forEach(function (code) {
            if (state.buttons[code]) release(Number(code));
        });
        Object.keys(state.axes).forEach(function (axis) {
            if (state.axes[axis]) release(state.axes[axis]);
        });
    }

    function handle(gamepad) {
        var state = pads[gamepad.index];
        if (!state) state = pads[gamepad.index] = { buttons: {}, axes: {} };

        var i;
        for (i = 0; i < gamepad.buttons.length; i++) {
            var code = BUTTON_OFFSET + i;
            var pressed = gamepad.buttons[i].pressed;

            if (pressed && !state.buttons[code]) {
                state.buttons[code] = true;
                press(code);
            } else if (!pressed && state.buttons[code]) {
                state.buttons[code] = false;
                release(code);
            }
        }

        for (i = 0; i < AXIS_BUTTONS.length && i < gamepad.axes.length; i++) {
            var value = gamepad.axes[i];
            var axisCode = null;

            if (value < -AXIS_THRESHOLD) axisCode = BUTTON_OFFSET + AXIS_BUTTONS[i][0];
            else if (value > AXIS_THRESHOLD) axisCode = BUTTON_OFFSET + AXIS_BUTTONS[i][1];

            var held = state.axes[i];
            if (axisCode === held || (!axisCode && !held)) continue;

            if (held) release(held);
            state.axes[i] = axisCode;
            if (axisCode) press(axisCode);
        }
    }

    function poll() {
        var list = navigator.getGamepads ? navigator.getGamepads() : [];

        Object.keys(pads).forEach(function (index) {
            if (!list[index] && pads[index]) { // disconnected
                releaseAll(pads[index]);
                delete pads[index];
            }
        });

        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].connected) handle(list[i]);
        }

        requestAnimationFrame(poll);
    }

    requestAnimationFrame(poll);
})();
