# cortex-engine demo — persistent memory for AI agents
#
# Renders on Linux (VPS or CI). Requires: vhs, ttyd, ffmpeg, chromium, node 18+
# Pre-install the package globally before rendering so npx doesn't download mid-recording.
#
# Render:
#   npm install -g @fozikio/cortex-engine@latest
#   vhs demo.tape
#
# Output: demo.gif

Output demo.gif
Set Framerate 10
Set Width 1000
Set Height 520
Set FontSize 14
Set FontFamily "JetBrains Mono"
Set LetterSpacing 0
Set Theme { "name": "cortex", "black": "#1a1a2e", "red": "#ff6b6b", "green": "#50fa7b", "yellow": "#f1fa8c", "blue": "#bd93f9", "magenta": "#c792ea", "cyan": "#89ddff", "white": "#e0e0e0", "brightBlack": "#555577", "brightRed": "#ff6b6b", "brightGreen": "#50fa7b", "brightYellow": "#f1fa8c", "brightBlue": "#bd93f9", "brightMagenta": "#c792ea", "brightCyan": "#89ddff", "brightWhite": "#ffffff", "background": "#0d0d1a", "foreground": "#e0e0e0", "selection": "#44475a", "cursor": "#bd93f9" }
Set Padding 24
Set TypingSpeed 40ms

# Setup: clean slate, pre-install so npx is instant
Hide
Type "cd /tmp && rm -rf demo-agent && npm install -g @fozikio/cortex-engine@latest 2>/dev/null; clear"
Enter
Sleep 8s
Show

# Scene 1: Init
Type "npx fozikio init demo-agent"
Enter
Sleep 4s

# Scene 2: Explore
Type "cd demo-agent && ls .fozikio/"
Enter
Sleep 2s

# Scene 3: Help
Type "npx fozikio help"
Enter
Sleep 4s

# Scene 4: Easter egg
Type "npx fozikio idapixl"
Enter
Sleep 5s

# Cleanup (hidden)
Hide
Type "cd /tmp && rm -rf demo-agent"
Enter
Show
Sleep 1s
