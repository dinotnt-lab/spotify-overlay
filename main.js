const { app, BrowserWindow, ipcMain, Tray, Menu, screen } = require('electron')
const path = require('path')
const fetch = require('node-fetch')
const fs = require('fs')
const { shell } = require('electron')
const http = require('http')
const url = require('url')

let win
let tray = null
let callbackServer = null
let isClickThrough = false
let isProgrammaticResize = false

// Spotify configuration
const SPOTIFY_KEYS_FILE = path.join(__dirname, 'spotify-overlay-keys.json')

// Spotify OAuth settings
const SPOTIFY_APP_CONFIG_FILE = path.join(__dirname, 'spotify-overlay-app-config.json')

// Window settings
const WINDOW_SETTINGS_FILE = path.join(__dirname, 'spotify-overlay-window-settings.json')

// Load Spotify app configuration
function loadSpotifyAppConfig() {
	try {
		if (fs.existsSync(SPOTIFY_APP_CONFIG_FILE)) {
			const data = fs.readFileSync(SPOTIFY_APP_CONFIG_FILE, 'utf8')
			return JSON.parse(data)
		}
	} catch (error) {
		console.error('Error loading Spotify app config:', error)
	}
}

// Get current app config
const appConfig = loadSpotifyAppConfig()
const SPOTIFY_CLIENT_ID = appConfig.clientId
const SPOTIFY_CLIENT_SECRET = appConfig.clientSecret
const SPOTIFY_REDIRECT_URI = appConfig.redirectUri
const SPOTIFY_SCOPES = appConfig.scopes

// Load Spotify configuration
function loadSpotifyConfig() {
	try {
		if (fs.existsSync(SPOTIFY_KEYS_FILE)) {
			const data = fs.readFileSync(SPOTIFY_KEYS_FILE, 'utf8')
			return JSON.parse(data)
		}
	} catch (error) {
		console.error('Error loading Spotify config:', error)
	}
	return null
}

// Save Spotify configuration
function saveSpotifyConfig(config) {
	try {
		fs.writeFileSync(SPOTIFY_KEYS_FILE, JSON.stringify(config, null, 2))
	} catch (error) {
		console.error('Error saving Spotify config:', error)
	}
}

// Load window settings
function loadWindowSettings() {
	try {
		if (fs.existsSync(WINDOW_SETTINGS_FILE)) {
			const data = fs.readFileSync(WINDOW_SETTINGS_FILE, 'utf8')
			return JSON.parse(data)
		}
	} catch (error) {
		console.error('Error loading window settings:', error)
	}
	return null
}

// Save window settings
function saveWindowSettings(settings) {
	try {
		fs.writeFileSync(WINDOW_SETTINGS_FILE, JSON.stringify(settings, null, 2))
	} catch (error) {
		console.error('Error saving window settings:', error)
	}
}

// Save current window settings
function saveCurrentWindowSettings() {
	if (!win) return
	
	try {
		const bounds = win.getBounds()
		const settings = loadWindowSettings() || {}
		settings.width = bounds.width
		settings.height = bounds.height
		settings.x = bounds.x
		settings.y = bounds.y
		// preserve autoResize flag if present
		if (settings.autoResizeToFitText === undefined) settings.autoResizeToFitText = !!settings.autoResizeToFitText
		saveWindowSettings(settings)
	} catch (error) {
		console.error('Error saving current window settings:', error)
	}
}

// Generate OAuth URL
function generateAuthUrl() {
	const params = new URLSearchParams({
		client_id: SPOTIFY_CLIENT_ID,
		response_type: 'code',
		redirect_uri: SPOTIFY_REDIRECT_URI,
		scope: SPOTIFY_SCOPES,
		show_dialog: 'true'
	})
	return `https://accounts.spotify.com/authorize?${params.toString()}`
}

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
	try {
		const response = await fetch('https://accounts.spotify.com/api/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code: code,
				redirect_uri: SPOTIFY_REDIRECT_URI
			})
		})

		if (!response.ok) {
			throw new Error(`Token exchange failed: ${response.status}`)
		}

		const data = await response.json()
		return data
	} catch (error) {
		console.error('Error exchanging code for tokens:', error)
		throw error
	}
}

// Refresh access token
async function refreshAccessToken(refreshToken) {
	try {
		const response = await fetch('https://accounts.spotify.com/api/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken
			})
		})

		if (!response.ok) {
			throw new Error(`Token refresh failed: ${response.status}`)
		}

		const data = await response.json()
		return data
	} catch (error) {
		console.error('Error refreshing token:', error)
		throw error
	}
}

// Start callback server to handle OAuth redirect
function startCallbackServer() {
	return new Promise((resolve, reject) => {
		const server = http.createServer(async (req, res) => {
			const parsedUrl = url.parse(req.url, true)
			
			if (parsedUrl.pathname === '/callback') {
				const code = parsedUrl.query.code
				const error = parsedUrl.query.error
				
				// Send success page to browser
				res.writeHead(200, { 'Content-Type': 'text/html' })
				if (code) {
					res.end(`
						<html>
							<head><title>Spotify Authorization Success</title></head>
							<body style="font-family: Arial; text-align: center; padding: 50px;">
								<h2 style="color: #1db954;">Authorization Successful!</h2>
								<p>You can close this window and return to the Spotify Overlay app.</p>
								<p style="font-size: 12px; color: #666;">Authorization code: ${code}</p>
							</body>
						</html>
					`)
				} else if (error) {
					res.end(`
						<html>
							<head><title>Spotify Authorization Error</title></head>
							<body style="font-family: Arial; text-align: center; padding: 50px;">
								<h2 style="color: #ff6b6b;">❌ Authorization Failed</h2>
								<p>Error: ${error}</p>
								<p>Please try again in the Spotify Overlay app.</p>
							</body>
						</html>
					`)
				}
				
				// Close server after handling the callback
				setTimeout(() => {
					server.close()
					callbackServer = null
				}, 1000)
				
				// Automatically complete OAuth if we got a code
				if (code) {
					try {
						const tokenData = await exchangeCodeForTokens(code)
						const config = {
							accessToken: tokenData.access_token,
							refreshToken: tokenData.refresh_token,
							expiresAt: Date.now() + (tokenData.expires_in * 1000)
						}
						saveSpotifyConfig(config)
						resolve(code)
					} catch (tokenError) {
						console.error('Error exchanging code for tokens:', tokenError)
						reject(tokenError)
					}
				} else {
					reject(new Error(error || 'No authorization code received'))
				}
			} else {
				res.writeHead(404)
				res.end('Not Found')
			}
		})
		
		// Start server on port 8888
		server.listen(8888, '127.0.0.1', (err) => {
			if (err) {
				reject(err)
			} else {
				callbackServer = server
				resolve(server)
			}
		})
	})
}

// Stop callback server
function stopCallbackServer() {
	if (callbackServer) {
		callbackServer.close()
		callbackServer = null
	}
}

// Create system tray
function createTray() {
	// Create tray icon
	tray = new Tray(path.join(__dirname, 'trayimg.png'))
	
	updateTrayMenu()
	
	tray.setToolTip('Spotify Overlay')
}

// Update tray menu to reflect current state
function updateTrayMenu() {
	const settings = loadWindowSettings() || {}
	const autoResize = !!settings.autoResizeToFitText

	const contextMenu = Menu.buildFromTemplate([
		{
			label: 'Show/Hide Overlay',
			click: () => {
				if (win.isVisible()) {
					win.hide()
				} else {
					win.show()
				}
			}
		},
		{
			label: isClickThrough ? '✓ Toggle Click-Through' : 'Toggle Click-Through',
			click: () => {
				isClickThrough = !isClickThrough
				win.setIgnoreMouseEvents(isClickThrough, { forward: true })
				// Enable/disable resizing based on click-through state
				win.setResizable(!isClickThrough)
				// Send message to renderer to show/hide resize handles
				win.webContents.send('toggle-resize-handles', !isClickThrough)
				updateTrayMenu() // Update menu to show new state
			}
		},
		{
			label: autoResize ? '✓ Auto-resize to fit title' : 'Auto-resize to fit title',
			click: () => {
				const s = loadWindowSettings() || {}
				s.autoResizeToFitText = !autoResize
				saveWindowSettings(s)
				// notify renderer
				if (win && win.webContents) {
					win.webContents.send('auto-resize-changed', s.autoResizeToFitText)
				}
				updateTrayMenu()
			}
		},
		{ type: 'separator' },
		{
			label: 'Reload',
			click: () => {
				if (win && win.webContents) {
					win.webContents.reload()
				}
			}
		},
		{ type: 'separator' },
		{
			label: 'Quit',
			click: () => {
				app.quit()
			}
		}
	])
	
	tray.setContextMenu(contextMenu)
}

function createWindow() {
	// Load saved window settings
	const savedSettings = loadWindowSettings()
	
	// Default settings
	const defaultSettings = {
		width: 420,
		height: 120,
		x: null, // Will be calculated if not saved
		y: 20,
		autoResizeToFitText: true
	}
	
	// Use saved settings or defaults
	const windowSettings = savedSettings ? { ...defaultSettings, ...savedSettings } : defaultSettings
	
	// If no saved position, calculate default position (top-right corner)
	if (!windowSettings.x) {
		const primaryDisplay = screen.getPrimaryDisplay()
		const { width } = primaryDisplay.workAreaSize
		windowSettings.x = width - windowSettings.width
	}

	win = new BrowserWindow({
		width: windowSettings.width,
		height: windowSettings.height,
		x: windowSettings.x,
		y: windowSettings.y,
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		resizable: false,
		focusable: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			nodeIntegration: false,
			contextIsolation: true
		}
	})

	// Make window click-through and draggable
	win.setIgnoreMouseEvents(false, { forward: true })
	win.setMovable(true)
	// Enable resizing initially (click-through is false by default)
	win.setResizable(true)

	// Prevent vertical resizing; allow horizontal only
	win.on('will-resize', (event, newBounds) => {
		if (isProgrammaticResize) return
		const current = win.getBounds()
		// If height is changing, lock it to current
		if (newBounds.height !== current.height) {
			event.preventDefault()
			// Apply only width change, keep height fixed
			isProgrammaticResize = true
			try {
				win.setSize(newBounds.width, current.height)
			} finally {
				isProgrammaticResize = false
			}
		}
	})

	// Ensure window stays on top and doesn't lose focus
	win.setAlwaysOnTop(true, 'screen-saver')
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

	win.loadFile('index.html')
	
	// Set initial state - click-through disabled (interactive mode)
	win.webContents.once('dom-ready', () => {
		win.webContents.send('toggle-resize-handles', true)
		// send initial auto-resize setting to renderer
		const settings = loadWindowSettings() || {}
		const auto = !!settings.autoResizeToFitText
		win.webContents.send('auto-resize-changed', auto)
	})
	
	// Save window settings when window is moved, resized, or hidden
	win.on('moved', saveCurrentWindowSettings)
	win.on('resized', saveCurrentWindowSettings)
	win.on('hide', saveCurrentWindowSettings)
	
	// Create tray after window is created
	createTray()
}

app.whenReady().then(() => {
	createWindow()
	
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow()
		}
	})
})

app.on('window-all-closed', () => {
	// Don't quit when window is closed, keep running in tray
	if (process.platform !== 'darwin') {
		// app.quit() - commented out to keep app running in tray
	}
})

app.on('before-quit', () => {
	// Save window settings before quitting
	saveCurrentWindowSettings()
	// Clean up callback server
	stopCallbackServer()
})

// Allow renderer to request window size changes
ipcMain.handle('set-window-size', async (event, width, height) => {
	try {
		if (!win) return { success: false, error: 'NO_WINDOW' }
		// clamp width/height to integers
		const w = Math.round(width)
		const h = Math.round(height)
		// Temporarily enable resizable to ensure programmatic resizing works even in click-through mode
		const wasResizable = win.isResizable()
		if (!wasResizable) {
			win.setResizable(true)
		}
		isProgrammaticResize = true
		try {
			// Allow renderer-requested height to match content precisely
			win.setSize(w, h)
		} finally {
			isProgrammaticResize = false
		}
		// Restore original resizable state
		if (!wasResizable) {
			win.setResizable(false)
		}
		// Save new size
		saveCurrentWindowSettings()
		return { success: true }
	} catch (e) {
		console.error('Error setting window size:', e)
		return { success: false, error: e.message }
	}
})

// Provide work area width for clamping
ipcMain.handle('get-workarea-width', () => {
	try {
		const primary = screen.getPrimaryDisplay()
		return primary.workAreaSize.width
	} catch (e) {
		console.error('Error getting work area width:', e)
		return 1920
	}
})

// Get current track from Spotify Web API with automatic token refresh
async function getCurrentTrack(config) {
	try {
		let accessToken = config.accessToken

		// Try to get current track
		let response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
			headers: {
				'Authorization': `Bearer ${accessToken}`
			}
		})

		// If token expired, try to refresh it
		if (response.status === 401 && config.refreshToken) {
			try {
				const refreshData = await refreshAccessToken(config.refreshToken)
				accessToken = refreshData.access_token
				
				// Update config with new token
				config.accessToken = refreshData.access_token
				if (refreshData.refresh_token) {
					config.refreshToken = refreshData.refresh_token
				}
				saveSpotifyConfig(config)

				// Retry with new token
				response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
					headers: {
						'Authorization': `Bearer ${accessToken}`
					}
				})
			} catch (refreshError) {
				console.error('Token refresh failed:', refreshError)
				return { error: 'TOKEN_EXPIRED' }
			}
		}

		if (response.status === 401) {
			// Token expired and refresh failed
			return { error: 'TOKEN_EXPIRED' }
		}

		if (response.status === 204) {
			// No track currently playing
			return null
		}

		if (!response.ok) {
			throw new Error(`Spotify API error: ${response.status}`)
		}

		const data = await response.json()
		
		if (data.item) {
			return {
				name: data.item.name,
				artist: data.item.artists.map(a => a.name).join(', '),
				album: data.item.album.name,
				albumCover: data.item.album.images[0]?.url || null,
				isPlaying: data.is_playing,
				progress: data.progress_ms,
				duration: data.item.duration_ms
			}
		}
		
		return null
	} catch (error) {
		console.error('Error fetching current track:', error)
		return { error: 'NETWORK_ERROR' }
	}
}

// IPC handler to get current Spotify track
ipcMain.handle('get-song', async () => {
	try {
		const config = loadSpotifyConfig()
		if (!config || !config.accessToken) {
			return { error: 'NO_TOKEN' }
		}

		const track = await getCurrentTrack(config)
		return track
	} catch (error) {
		console.error('Error getting song info:', error)
		return { error: 'UNKNOWN_ERROR' }
	}
})

// IPC handler to start OAuth flow
ipcMain.handle('start-oauth', async () => {
	try {
		// Start the callback server
		await startCallbackServer()
		
		// Generate and open auth URL
		const authUrl = generateAuthUrl()
		await shell.openExternal(authUrl)
		
		return { success: true, message: 'Please complete the authorization in your browser. The app will automatically detect when you authorize.' }
	} catch (error) {
		console.error('Error starting OAuth:', error)
		return { success: false, error: error.message }
	}
})

// IPC handler to complete OAuth with authorization code
ipcMain.handle('complete-oauth', async (event, code) => {
	try {
		const tokenData = await exchangeCodeForTokens(code)
		
		const config = {
			accessToken: tokenData.access_token,
			refreshToken: tokenData.refresh_token,
			expiresAt: Date.now() + (tokenData.expires_in * 1000)
		}
		
		saveSpotifyConfig(config)
		return { success: true }
	} catch (error) {
		console.error('Error completing OAuth:', error)
		return { success: false, error: error.message }
	}
})

// IPC handler to wait for OAuth completion
ipcMain.handle('wait-for-oauth', async () => {
	return new Promise((resolve) => {
		const checkCallback = () => {
			if (callbackServer) {
				setTimeout(checkCallback, 500)
			} else {
				// Server closed, OAuth completed
				resolve({ success: true })
			}
		}
		checkCallback()
	})
})

// IPC handler to check if user is authenticated
ipcMain.handle('check-auth', async () => {
	try {
		const config = loadSpotifyConfig()
		return { 
			authenticated: !!(config && config.accessToken),
			hasRefreshToken: !!(config && config.refreshToken)
		}
	} catch (error) {
		console.error('Error checking auth:', error)
		return { authenticated: false, hasRefreshToken: false }
	}
})

// Skip to next track
async function skipToNext(config) {
	try {
		let accessToken = config.accessToken

		let response = await fetch('https://api.spotify.com/v1/me/player/next', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${accessToken}`
			}
		})

		// If token expired, try to refresh it
		if (response.status === 401 && config.refreshToken) {
			try {
				const refreshData = await refreshAccessToken(config.refreshToken)
				accessToken = refreshData.access_token
				
				// Update config with new token
				config.accessToken = refreshData.access_token
				if (refreshData.refresh_token) {
					config.refreshToken = refreshData.refresh_token
				}
				saveSpotifyConfig(config)

				// Retry with new token
				response = await fetch('https://api.spotify.com/v1/me/player/next', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${accessToken}`
					}
				})
			} catch (refreshError) {
				console.error('Token refresh failed:', refreshError)
				return { success: false, error: 'TOKEN_EXPIRED' }
			}
		}

		if (response.status === 401) {
			return { success: false, error: 'TOKEN_EXPIRED' }
		}

		if (response.status === 403) {
			return { success: false, error: 'INSUFFICIENT_PERMISSIONS' }
		}

		if (!response.ok) {
			throw new Error(`Spotify API error: ${response.status}`)
		}

		return { success: true }
	} catch (error) {
		console.error('Error skipping to next track:', error)
		return { success: false, error: 'NETWORK_ERROR' }
	}
}

// Skip to previous track
async function skipToPrevious(config) {
	try {
		let accessToken = config.accessToken

		let response = await fetch('https://api.spotify.com/v1/me/player/previous', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${accessToken}`
			}
		})

		// If token expired, try to refresh it
		if (response.status === 401 && config.refreshToken) {
			try {
				const refreshData = await refreshAccessToken(config.refreshToken)
				accessToken = refreshData.access_token
				
				// Update config with new token
				config.accessToken = refreshData.access_token
				if (refreshData.refresh_token) {
					config.refreshToken = refreshData.refresh_token
				}
				saveSpotifyConfig(config)

				// Retry with new token
				response = await fetch('https://api.spotify.com/v1/me/player/previous', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${accessToken}`
					}
				})
			} catch (refreshError) {
				console.error('Token refresh failed:', refreshError)
				return { success: false, error: 'TOKEN_EXPIRED' }
			}
		}

		if (response.status === 401) {
			return { success: false, error: 'TOKEN_EXPIRED' }
		}

		if (response.status === 403) {
			return { success: false, error: 'INSUFFICIENT_PERMISSIONS' }
		}

		if (!response.ok) {
			throw new Error(`Spotify API error: ${response.status}`)
		}

		return { success: true }
	} catch (error) {
		console.error('Error skipping to previous track:', error)
		return { success: false, error: 'NETWORK_ERROR' }
	}
}

// Toggle play/pause
async function togglePlayPause(config) {
	try {
		let accessToken = config.accessToken

		// First get current playback state to determine action
		let getResponse = await fetch('https://api.spotify.com/v1/me/player', {
			headers: {
				'Authorization': `Bearer ${accessToken}`
			}
		})

		// If token expired, try to refresh it
		if (getResponse.status === 401 && config.refreshToken) {
			try {
				const refreshData = await refreshAccessToken(config.refreshToken)
				accessToken = refreshData.access_token
				
				// Update config with new token
				config.accessToken = refreshData.access_token
				if (refreshData.refresh_token) {
					config.refreshToken = refreshData.refresh_token
				}
				saveSpotifyConfig(config)

				// Retry with new token
				getResponse = await fetch('https://api.spotify.com/v1/me/player', {
					headers: {
						'Authorization': `Bearer ${accessToken}`
					}
				})
			} catch (refreshError) {
				console.error('Token refresh failed:', refreshError)
				return { success: false, error: 'TOKEN_EXPIRED' }
			}
		}

		if (getResponse.status === 401) {
			return { success: false, error: 'TOKEN_EXPIRED' }
		}

		if (!getResponse.ok) {
			throw new Error(`Spotify API error: ${getResponse.status}`)
		}

		const playerData = await getResponse.json()
		const isPlaying = playerData.is_playing

		// Toggle play/pause based on current state
		const endpoint = isPlaying ? 'pause' : 'play'
		
		const response = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
			method: 'PUT',
			headers: {
				'Authorization': `Bearer ${accessToken}`
			}
		})

		// If token expired during the PUT request, try to refresh it
		if (response.status === 401 && config.refreshToken) {
			try {
				const refreshData = await refreshAccessToken(config.refreshToken)
				accessToken = refreshData.access_token
				
				// Update config with new token
				config.accessToken = refreshData.access_token
				if (refreshData.refresh_token) {
					config.refreshToken = refreshData.refresh_token
				}
				saveSpotifyConfig(config)

				// Retry with new token
				const retryResponse = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
					method: 'PUT',
					headers: {
						'Authorization': `Bearer ${accessToken}`
					}
				})

				if (!retryResponse.ok) {
					throw new Error(`Spotify API error: ${retryResponse.status}`)
				}
			} catch (refreshError) {
				console.error('Token refresh failed:', refreshError)
				return { success: false, error: 'TOKEN_EXPIRED' }
			}
		} else if (response.status === 401) {
			return { success: false, error: 'TOKEN_EXPIRED' }
		} else if (!response.ok) {
			throw new Error(`Spotify API error: ${response.status}`)
		}

		return { success: true }
	} catch (error) {
		console.error('Error toggling play/pause:', error)
		return { success: false, error: 'NETWORK_ERROR' }
	}
}

// IPC handler to skip to previous track
ipcMain.handle('skip-previous', async () => {
	try {
		const config = loadSpotifyConfig()
		if (!config || !config.accessToken) {
			return { success: false, error: 'NO_TOKEN' }
		}

		const result = await skipToPrevious(config)
		return result
	} catch (error) {
		console.error('Error skipping to previous track:', error)
		return { success: false, error: 'UNKNOWN_ERROR' }
	}
})

// IPC handler to skip to next track
ipcMain.handle('skip-next', async () => {
	try {
		const config = loadSpotifyConfig()
		if (!config || !config.accessToken) {
			return { success: false, error: 'NO_TOKEN' }
		}

		const result = await skipToNext(config)
		return result
	} catch (error) {
		console.error('Error skipping to next track:', error)
		return { success: false, error: 'UNKNOWN_ERROR' }
	}
})

// IPC handler to toggle play/pause
ipcMain.handle('toggle-play-pause', async () => {
	try {
		const config = loadSpotifyConfig()
		if (!config || !config.accessToken) {
			return { success: false, error: 'NO_TOKEN' }
		}

		const result = await togglePlayPause(config)
		return result
	} catch (error) {
		console.error('Error toggling play/pause:', error)
		return { success: false, error: 'UNKNOWN_ERROR' }
	}
})
