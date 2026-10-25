//installation info for the about page
//this build never updates itself and has no update feed, so there is nothing to check or download

const fs = require('fs')
const path = require('path')

let state = {
    currentVersion: null,
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

function setup(options) {
    const app = options.electron.app
    const installation = detectInstallation({
        platform: options.platform || process.platform, //platform/env overrides are for tests
        env: options.env || process.env,
        exePath: app.getPath('exe'),
        isPackaged: app.isPackaged
    })

    state = {
        ...state,
        currentVersion: app.getVersion(),
        installationType: installation.type
    }

    options.electron.ipcMain.handle('get-about-info', () => ({ ...state }))
}

module.exports = {
    setup,
    detectInstallation
}
