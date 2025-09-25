# Spotify Overlay

A simple Electron overlay that displays your current Spotify track and album cover with OAuth2 authentication.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a Spotify app:
   - Go to [Spotify Developer Console](https://developer.spotify.com/dashboard)
   - Log in with your Spotify account
   - Click "Create App"
   - Fill in app details (name, description)
   - Set redirect URI to: `http://127.0.0.1:8888/callback`
   - Save the app

3. Get your app credentials:
   - Go to your app settings
   - Copy your Client ID and Client Secret
   - Edit `spotify-overlay-app-config.json` and replace:
     - `"clientId": "your_client_id_here"` with your actual Client ID
     - `"clientSecret": "your_client_secret_here"` with your actual Client Secret

4. Run the app:
   ```bash
   npm start
   ```

5. Click "Login with Spotify" to authenticate

## Tray Icon

 - This creates a tray icon that'll appear on your taskbar
 - It contains the following settings:
   - Show/Hide - Shows or hides the window
   - Toggle click through
      - On: you can click through the window
      - Off: you can resize the window, use the previous, play or skip buttons and move the window
   - Auto resize to fit title - When toggled on it makes the window automatically change size to fit the song name/artist

## Notes

DO NOT SHARE `spotify-overlay-keys.json`. It contains keys that could be used to gain access to your account
