const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spotify', {
	getSong: () => ipcRenderer.invoke('get-song'),
	startOAuth: () => ipcRenderer.invoke('start-oauth'),
	completeOAuth: (code) => ipcRenderer.invoke('complete-oauth', code),
	waitForOAuth: () => ipcRenderer.invoke('wait-for-oauth'),
	checkAuth: () => ipcRenderer.invoke('check-auth'),
	skipPrevious: () => ipcRenderer.invoke('skip-previous'),
	skipNext: () => ipcRenderer.invoke('skip-next'),
	togglePlayPause: () => ipcRenderer.invoke('toggle-play-pause'),
	onToggleResizeHandles: (callback) => ipcRenderer.on('toggle-resize-handles', callback),
	// new: renderer requests main to resize window
	setWindowSize: (w, h) => ipcRenderer.invoke('set-window-size', w, h),
	// new: get primary display work area width for clamping
	getWorkAreaWidth: () => ipcRenderer.invoke('get-workarea-width'),
	// new: listen for auto-resize setting changes
	onAutoResizeChanged: (callback) => ipcRenderer.on('auto-resize-changed', callback)
})
