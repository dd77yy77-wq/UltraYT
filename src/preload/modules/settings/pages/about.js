//about page, opened from the header's "?" button
//shows the version, how this copy is installed and the update state (the state comes from the main process, see src/updater.js)

const fs = require('fs')
const path = require('path')
const { ipcRenderer } = require('electron')

const iconPath = path.join(__dirname, '../../../../../assets/icon.png') //good lord
const iconDataUrl = `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`

let refresh = null; //re-renders the overlay, set by onOpen
let state = {
    status: 'idle',
    currentVersion: '',
    latestVersion: '',
    platform: process.platform,
    arch: process.arch,
    installationType: 'unknown'
}

ipcRenderer.on('update-state-changed', (event, next) => {
    state = next;
    refresh?.()
})

function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

function platformLabel(about) {
    const platform = about.platforms[state.platform] || state.platform;
    return `${platform} · ${about.architectures[state.arch] || state.arch}`;
}

//the notice and button text for each updater status
function updateStatus(strings) {
    const values = { version: state.latestVersion || state.currentVersion }

    switch (state.status) {
        case 'checking':
            return { tone: 'info', title: strings.checking_title, text: strings.checking_detail, button: strings.checking_button };
        case 'current':
            return { tone: 'success', title: strings.current_title, text: fill(strings.current_detail, { version: state.currentVersion }), button: strings.check_again };
        case 'ready':
            return { tone: 'warning', title: strings.ready_title, text: fill(strings.ready_detail, values), button: strings.install_update };
        case 'error':
            return { tone: 'error', title: strings.error_title, text: strings.error_detail, button: strings.try_again };
        default:
            return { tone: 'info', title: strings.idle_title, text: strings.idle_detail, button: strings.check_now };
    }
}

async function runUpdateAction() {
    if (state.status === 'ready') {
        return ipcRenderer.invoke('install-update');
    }

    state = await ipcRenderer.invoke('check-for-updates')
}

module.exports = {
    id: 'about',

    icon: iconDataUrl,
    title: 'UltraYT',
    crumb: (locale) => locale.about.title,
    description: (locale) => locale.about.description,
    badge: (locale) => state.currentVersion && fill(locale.about.version, { version: state.currentVersion }),

    async onOpen(ctx) {
        refresh = ctx.refresh;

        try {
            state = await ipcRenderer.invoke('get-about-info')
        } catch (err) {
            console.error('[About] Failed to load application information:', err)
            state = { ...state, status: 'error' }
        }
    },

    sections: (config, locale) => {
        const about = locale.about;
        const update = updateStatus(about.updates)
        const busy = state.status === 'checking'

        return [
            {
                rows: [
                    { type: 'notice', tone: update.tone, title: update.title, text: update.text },
                    { type: 'button', id: 'update-action', title: update.button, disabled: busy, run: runUpdateAction }
                ]
            },
            {
                rows: [
                    { type: 'info', title: about.platform_label, value: platformLabel(about) },
                    { type: 'info', title: about.installation_label, value: about.installations[state.installationType] || about.installations.unknown }
                ]
            }
        ];
    }
}
