//decides which copy of the app code to start: the one bundled in the exe, or a newer one downloaded by self-update.js
//this file has no electron imports, so it can be tested on its own. boot.js is the glue

const fs = require('fs')
const os = require('os')
const path = require('path')

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const MAX_ATTEMPTS = 3 //launches in a row that may fail to load a window before a downloaded version is given up on

//where downloaded versions live, next to the unpacked program (%LOCALAPPDATA%\UltraYT\updates)
function updatesRoot(env = process.env) {
    const base = env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share')
    return path.join(base, 'UltraYT', 'updates');
}

function compareVersions(a, b) {
    const pa = String(a).split('.').map(Number)
    const pb = String(b).split('.').map(Number)

    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
    }

    return 0;
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch {
        return null;
    }
}

function writeJson(file, value) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 4))
        fs.renameSync(file + '.tmp', file)
        return true;
    } catch (err) {
        console.error('[Overlay] Failed to write', file, err)
        return false;
    }
}

function readState(root) {
    const saved = readJson(path.join(root, 'state.json'))
    const state = { attempts: {}, bad: [] }

    if (saved && typeof saved === 'object') {
        if (saved.attempts && typeof saved.attempts === 'object') state.attempts = saved.attempts;
        if (Array.isArray(saved.bad)) state.bad = saved.bad;
    }

    return state;
}

//whether dir holds a complete downloaded version (a half-written one never has its final name, but check anyway)
function isComplete(dir, version) {
    if (!fs.existsSync(path.join(dir, 'src', 'index.js'))) return false;
    return readJson(path.join(dir, 'package.json'))?.version === version;
}

//downloaded versions that are newer than the bundled one, newest first
function listVersions(root, bundledVersion) {
    let names;
    try {
        names = fs.readdirSync(root)
    } catch {
        return [];
    }

    return names
        .filter((name) => VERSION_PATTERN.test(name) && compareVersions(name, bundledVersion) > 0 && isComplete(path.join(root, name), name))
        .sort((a, b) => compareVersions(b, a));
}

//picks the newest usable downloaded version, or null to run the bundled code. counts this launch as an attempt
function chooseOverlay({ root, bundledVersion }) {
    const state = readState(root)
    let changed = false;
    let chosen = null;

    for (const version of listVersions(root, bundledVersion)) {
        if (state.bad.includes(version)) continue;

        const attempts = state.attempts[version] || 0
        if (attempts >= MAX_ATTEMPTS) {
            state.bad.push(version)
            changed = true;
            continue;
        }

        state.attempts[version] = attempts + 1
        changed = true;
        chosen = { version, dir: path.join(root, version) }
        break;
    }

    if (changed) writeJson(path.join(root, 'state.json'), state)

    return chosen;
}

//the version got as far as loading a page, so it works
function markGood(root, version) {
    const state = readState(root)
    if (!(version in state.attempts)) return;

    delete state.attempts[version]
    writeJson(path.join(root, 'state.json'), state)
}

//the version failed to start, never pick it again
function markBad(root, version) {
    const state = readState(root)
    if (!state.bad.includes(version)) state.bad.push(version)
    delete state.attempts[version]
    writeJson(path.join(root, 'state.json'), state)
}

module.exports = {
    VERSION_PATTERN,
    MAX_ATTEMPTS,
    updatesRoot,
    compareVersions,
    readState,
    chooseOverlay,
    markGood,
    markBad
}
