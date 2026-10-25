//the real entry point: starts the newest downloaded version of the app code if there is one, otherwise the bundled code
//a downloaded version that fails to start (or never gets a page loaded in three launches) is dropped and the bundled code runs instead

const path = require('path')
const electron = require('electron')
const overlay = require('./overlay')

const bundledVersion = require('../package.json').version
const root = overlay.updatesRoot()

let chosen = null;

try {
    chosen = overlay.chooseOverlay({ root, bundledVersion })
} catch (err) {
    console.error('[Boot] Failed to look for downloaded versions', err)
}

if (chosen) {
    try {
        console.log(`[Boot] Starting downloaded version ${chosen.version} (bundled is ${bundledVersion})`)

        //once the window has finished loading something, the version is known to work
        electron.app.once('browser-window-created', (event, win) => {
            win.webContents.once('did-stop-loading', () => overlay.markGood(root, chosen.version))
        })

        require(path.join(chosen.dir, 'src', 'index.js'))
    } catch (err) {
        console.error(`[Boot] Downloaded version ${chosen.version} failed to start, using the bundled one`, err)
        overlay.markBad(root, chosen.version)
        chosen = null;
    }
}

if (!chosen) {
    require('./index.js')
}
