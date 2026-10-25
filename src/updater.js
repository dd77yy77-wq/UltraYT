//update checks for the about page and the background check at startup
//new versions of the app code come from the feed in this project's repository (see self-update.js), they are stored and start on the next launch

const fs = require('fs')
const path = require('path')
const { updateFeedUrl } = require('./constants.js')
const overlay = require('./overlay.js')
const selfUpdate = require('./self-update.js')

const STARTUP_CHECK_DELAY = 10 * 1000

let electron;
let getWindow;
let isAutoUpdateEnabled = () => true; //the user's auto_update setting
let options = {}
let checking = null;

let state = {
    status: 'idle', //idle, checking, current, ready, error
    currentVersion: null,
    latestVersion: null,
    platform: process.platform,
    arch: process.arch,
    installationType: 'unknown'
}

function detectInstallation({
    platform = process.platform,
    exePath = process.execPath,
    isPackaged = false,
    env = process.env,
    existsSync = fs.existsSync //for tests
} = {}) {
    if (!isPackaged) return { type: 'development' };

    if (platform === 'win32') {
        const uninstaller = path.win32.join(path.win32.dirname(exePath), 'Uninstall UltraYT.exe')
        return { type: existsSync(uninstaller) ? 'installer' : 'portable' };
    } else if (platform === 'darwin') {
        return { type: 'application' };
    } else if (platform === 'linux') {
        if (env.FLATPAK_ID || existsSync('/.flatpak-info')) return { type: 'flatpak' };
        if (env.APPIMAGE) return { type: 'appimage' };

        return { type: 'package' };
    }

    return { type: 'unsupported' };
}

function publish(patch) {
    state = { ...state, ...patch }

    const win = getWindow?.()
    if (win && !win.isDestroyed()) {
        win.webContents.send('update-state-changed', { ...state })
    }
}

async function checkForUpdates() {
    if (checking) return checking;

    publish({ status: 'checking' })

    checking = (async () => {
        try {
            const result = await selfUpdate.stageUpdate({
                feedUrl: options.feedUrl || updateFeedUrl,
                currentVersion: state.currentVersion,
                updatesDir: options.updatesDir || overlay.updatesRoot(),
                fetchImpl: options.fetchImpl,
                allowInsecure: options.allowInsecure,
                userAgent: `UltraYT/${state.currentVersion}`
            })

            publish({ status: result.status, latestVersion: result.latestVersion })
        } catch (err) {
            console.error('[Updater] Failed to check for updates:', err)
            publish({ status: 'error' })
        }

        checking = null;
        return { ...state };
    })()

    return checking;
}

//turns the stored new version on right away
function installUpdate() {
    if (state.status !== 'ready') return false;

    electron.app.relaunch()
    electron.app.quit()
    return true;
}

function onPreferenceChanged() {
    if (isAutoUpdateEnabled() && state.status === 'idle') void checkForUpdates()
}

function setup(setupOptions) {
    electron = setupOptions.electron;
    getWindow = setupOptions.getWindow;
    isAutoUpdateEnabled = setupOptions.isAutoUpdateEnabled || isAutoUpdateEnabled;
    options = setupOptions;

    const app = electron.app
    const installation = detectInstallation({
        platform: setupOptions.platform || process.platform, //platform/env overrides are for tests
        env: setupOptions.env || process.env,
        exePath: app.getPath('exe'),
        isPackaged: app.isPackaged
    })

    state = {
        ...state,
        status: 'idle',
        currentVersion: require('../package.json').version, //the version that is running, which may be a downloaded one
        installationType: installation.type
    }

    electron.ipcMain.handle('get-about-info', () => ({ ...state }))
    electron.ipcMain.handle('check-for-updates', () => checkForUpdates())
    electron.ipcMain.handle('install-update', () => installUpdate())

    //with automatic updates on, look once shortly after startup (a failed check just stays quiet)
    if (app.isPackaged && isAutoUpdateEnabled()) {
        const timer = setTimeout(() => void checkForUpdates(), setupOptions.startupDelay ?? STARTUP_CHECK_DELAY)
        timer.unref?.()
    }
}

module.exports = {
    setup,
    onPreferenceChanged,
    detectInstallation
}
