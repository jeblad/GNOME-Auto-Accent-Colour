// TODO: Experiment with ColorThief palettes
// TODO: Preferences window to allow user to pick which palette entry to use (e.g overall or highlight)
// TODO: Reorganise functions
// TODO: Run script on background and color-scheme change
// TODO: Add Extensions store page support
// TODO: Add checker/installer for Python venv
// TODO: Add some kind of fullscreen mode checker to prevent performance loss?

import St from 'gi://St'
import Gio from 'gi://Gio'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'

const INTERFACE_SCHEMA = 'org.gnome.desktop.interface'
const BACKGROUND_SCHEMA = 'org.gnome.desktop.background'

// Thank you to andy.holmes on StackOverflow for this Promise wrapper
// https://stackoverflow.com/a/61150669
function execCommand(argv, input = null, cancellable = null) {
    let flags = Gio.SubprocessFlags.STDOUT_PIPE;

    if (input !== null)
        flags |= Gio.SubprocessFlags.STDIN_PIPE;

    let proc = new Gio.Subprocess({
        argv: argv,
        flags: flags
    });
    proc.init(cancellable);

    return new Promise((resolve, reject) => {
        proc.communicate_utf8_async(input, cancellable, (proc, res) => {
            try {
                resolve(proc.communicate_utf8_finish(res)[1]);
            } catch (e) {
                reject(e);
            }
        });
    });
}

class AccentColour {
    constructor(name, r, g, b) {
        this.name = name,
        this.r = r
        this.g = g
        this.b = b
    }
}

const accentColours = [
    new AccentColour("blue", 53, 131, 227), // Blue
    new AccentColour("teal", 33, 144, 164), // Teal
    new AccentColour("green", 58, 148, 74), // Green
    new AccentColour("yellow", 200, 136, 0), // Yellow
    new AccentColour("orange", 237, 91, 0), // Orange
    new AccentColour("red", 230, 45, 66), // Red
    new AccentColour("pink", 213, 97, 153), // Pink
    new AccentColour("purple", 145, 65, 172), // Purple
    new AccentColour("slate", 111, 131, 150) // Slate
]

function getSquaredEuclideanDistance(r1, g1, b1, r2, g2, b2) {
    return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2
}

function getClosestAccentColour(r, g, b) {
    let shortestDistance = Number.MAX_VALUE
    let closestAccent = ''

    for (let accent of accentColours) {
        let squaredEuclideanDistance = getSquaredEuclideanDistance(r, g, b,
            accent.r, accent.g, accent.b)

        if (squaredEuclideanDistance < shortestDistance) {
            shortestDistance = squaredEuclideanDistance
            closestAccent = accent.name
        }
    }

    console.log("Closest accent: " + closestAccent)

    return closestAccent
}

// TODO: check for existance of imagemagick
async function convert(imagePath, extensionPath) {
    const cacheDir = extensionPath + '/cached/'
    await execCommand(['mkdir', cacheDir])
    await execCommand(['magick', imagePath, cacheDir + '/converted_bg.jpg'])
}

async function getDominantColour(extensionPath, backgroundSettings, interfaceSettings) {
    try {
        const colorScheme = interfaceSettings.get_string('color-scheme')
        const backgroundUriKey = (
        	colorScheme == 'prefer-dark' ? 'picture-uri-dark' : 'picture-uri'
        )
        const backgroundUri = backgroundSettings.get_string(backgroundUriKey)
        const backgroundPath = backgroundUri.replace('file://', '')
        const backgroundFileExtension = backgroundPath.split('.').pop()
        let rasterPath = ''

        if (['svg', 'jxl'].includes(backgroundFileExtension)) {
            await convert(backgroundPath, extensionPath)
        	rasterPath = extensionPath + '/cached/converted_bg.jpg'
        } else {
            rasterPath = backgroundPath
        }

        const wallpaperColourStr = await execCommand([
            extensionPath + '/venv/bin/python',
            extensionPath + '/tools/get-colour.py',
            rasterPath
        ])
        console.log('Wallpaper colour: ' + wallpaperColourStr)


        const wallpaperColourTuple = wallpaperColourStr
            .replace(/\(|\)|\n/g, '')
            .split(',')
        for (let i in wallpaperColourTuple) {
            wallpaperColourTuple[i] = Number(wallpaperColourTuple[i])
        }
        console.log('Parsed R: ' + wallpaperColourTuple[0])
        console.log('Parsed G: ' + wallpaperColourTuple[1])
        console.log('Parsed B: ' + wallpaperColourTuple[2])

        return wallpaperColourTuple
    } catch (e) {
        logError(e)
    }
}

async function applyClosestAccent(
	extensionPath,
	backgroundSettings,
	interfaceSettings
) {
    const [wall_r, wall_g, wall_b] = await getDominantColour(
        extensionPath,
        backgroundSettings,
        interfaceSettings
    )
    const closestAccent = getClosestAccentColour(wall_r, wall_g, wall_b)

    interfaceSettings.set_string('accent-color', closestAccent)
}

export default class AutoAccentColourExtension extends Extension {
    enable() {
        this._backgroundSettings = new Gio.Settings({ schema: BACKGROUND_SCHEMA })
		this._interfaceSettings = new Gio.Settings({ schema: INTERFACE_SCHEMA })

		const extensionPath = this.path
		const backgroundSettings = this._backgroundSettings
		const interfaceSettings = this._interfaceSettings

		function setAccent() {
			applyClosestAccent(extensionPath, backgroundSettings, interfaceSettings)
		}

        setAccent()

        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false)

        const icon = new St.Icon({
            icon_name: 'org.gnome.Settings-color-symbolic',
            style_class: 'system-status-icon'
        })
        this._indicator.add_child(icon)

        Main.panel.addToStatusArea(this.uuid, this._indicator)

		// Watch for light background change
		this._backgroundSettings.connect(
			'changed::picture-uri',
			() => {
			    if (this._interfaceSettings.get_string('color-scheme') !== 'prefer-dark') {
    				console.log('Setting accent from picture-uri change.')
				    setAccent()
			    }
			}
		)

		// Watch for dark background change
		this._backgroundSettings.connect(
			'changed::picture-uri-dark',
			() => {
				if (this._interfaceSettings.get_string('color-scheme') === 'prefer-dark') {
				    console.log('Setting accent from picture-uri-dark change.')
				    setAccent()
				}
			}
		)

        // Watch for light/dark theme change
		this._interfaceSettings.connect(
			'changed::color-scheme',
			() => {
			    if (this._backgroundSettings.get_string('picture-uri') !== this._backgroundSettings.get_string('picture-uri-dark')) {
			        console.log('Setting accent from color-scheme change.')
			        setAccent()
			    }
			}
		)
    }

    disable() {
        this._indicator?.destroy()
        this._indicator = null
    }
}
