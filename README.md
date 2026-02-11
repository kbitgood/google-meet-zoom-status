# Google Meet to Zoom Status

A silly little tool that keeps your Zoom status accurate while you're actually in Google Meet.

## What Is This?

So here's the deal: I use Google Meet for all my actual meetings, but my company uses Zoom for team chat. This means I constantly look "available" on Zoom while I'm actually in back-to-back meetings on Meet. People ping me, I don't respond, chaos ensues. (Sorry Zach, Matthew, Lucas, et al)

This project solves that *very specific* problem by automatically joining a private Zoom meeting whenever I'm in a Google Meet call. When I leave Meet, it ends the Zoom meeting. My Zoom status stays accurate, everyone's happy.

**This is an unserious side project for a very personal niche.** If you happen to have the exact same problem (like my colleagues), cool, maybe this helps. If not, this probably isn't for you.

## Disclaimer

**Use at your own risk.**

I have no idea if this is 100% aligned with Zoom's Terms of Service. Honestly? I never checked. It *seems* fine to me - we're just automating a browser to join meetings, not doing anything nefarious. But I'm not a lawyer, and I'm definitely not *your* lawyer.

If Zoom gets mad at you, that's on you. You've been warned.

## How It Actually Works

Let me break down what's happening under the hood so you can make an informed decision about whether to use this:

### The Chrome Extension

There's a Chrome extension that watches your browser tabs. When you join a Google Meet call (any URL matching `meet.google.com/*`), the extension detects this and makes a note. When you leave (close the tab, navigate away, or the meeting ends), it detects that too.

The extension itself doesn't touch Zoom at all. It just watches Meet and sends signals to a local server running on your machine.

### The Local Server

A small server runs on your computer (localhost only - nothing leaves your machine). When the extension says "hey, user just joined a Meet call," the server uses Playwright (browser automation) to:

1. Open a hidden Chromium browser
2. Navigate to Zoom's web app (`app.zoom.us`)
3. Create and join a private meeting

When you leave the Meet call, the server ends that Zoom meeting.

### The One-Time Login

The first time you run this, you need to log into Zoom manually (including MFA if you have it). The server opens a visible browser window for this. After that, your session is saved locally and future automation runs headlessly (invisibly) in the background.

### What This Means For You

- **Your Zoom credentials are stored locally** in a browser profile on your machine, managed by Playwright
- **The server runs on localhost only** - it's not accessible from the internet
- **The extension communicates only with your local server** - no external services, no cloud, no telemetry
- **Browser automation can be flaky** - Zoom sometimes changes their web UI, selectors break, things go wrong

## Getting Started

Alright, let's get you set up. I'll assume you're relatively new to this stuff.

### Prerequisites

You'll need:
- A Mac (this hasn't been tested on Windows/Linux)
- A Chromium-based browser (Chrome, Edge, Arc, Brave, Vivaldi, Opera, etc.)
- A terminal (you'll find this in Applications > Utilities > Terminal)

### Step 1: Get the Code

First, you need to download this project to your computer.

**Option A: Download as ZIP (easiest)**

1. Go to the GitHub page for this project
2. Click the green "Code" button
3. Click "Download ZIP"
4. Unzip the downloaded file somewhere you'll remember (like your Documents folder)

**Option B: Clone with Git (if you know Git)**

Open Terminal and run:

```bash
git clone https://github.com/YOUR_USERNAME/google-meet-zoom-status.git
cd google-meet-zoom-status
```

### Step 2: Install Bun

This project uses Bun as its JavaScript runtime. Open Terminal and run:

```bash
curl -fsSL https://bun.sh/install | bash
```

After it installs, **close and reopen Terminal** so it can find the `bun` command.

Verify it worked:

```bash
bun --version
```

You should see a version number. If you see "command not found," try opening a new Terminal window.

### Step 3: Install Dependencies

In Terminal, navigate to the project folder. If you downloaded to Documents:

```bash
cd ~/Documents/google-meet-zoom-status
```

Then install all the dependencies:

```bash
bun install
```

This downloads all the packages the project needs. It might take a minute.

Next, install the browser that Playwright uses for automation:

```bash
bunx playwright install chromium
```

### Step 4: Start the Server

Still in the project folder, run:

```bash
bun run server:dev
```

You should see output indicating the server is running on `http://127.0.0.1:17394`.

**Keep this terminal window open!** The server needs to keep running for everything to work.

### Step 5: Do the One-Time Zoom Login

Open a new Terminal window (Cmd+N) and run:

```bash
curl -X POST http://127.0.0.1:17394/auth/login
```

A browser window will pop up with Zoom's login page. Log in with your Zoom credentials, complete MFA if you have it, and wait until you see Zoom's main interface. Then you can close that browser window.

Your session is now saved. Future runs will work without logging in again.

### Step 6: Build the Chrome Extension

In Terminal (still in the project folder):

```bash
bun run build
```

This creates the extension files in `packages/extension/dist`.

### Step 7: Install the Chrome Extension

1. Open Chrome
2. Go to `chrome://extensions` (type this in the address bar)
3. Enable "Developer mode" using the toggle in the top-right corner
4. Click "Load unpacked"
5. Navigate to the project folder, then `packages/extension/dist`, and select that folder
6. The extension should appear in your extensions list

### Step 8: Test It!

1. Make sure the server is still running (Step 4)
2. Open a Google Meet call (you can just start a new meeting at meet.google.com)
3. Check your Zoom - you should see that you've joined a meeting
4. Leave the Google Meet call
5. Your Zoom meeting should end automatically

If something doesn't work, check the Terminal window running the server for error messages.

## Running the Server in the Background

If you don't want to keep a Terminal window open, you can run the server in the background:

```bash
nohup bun run server:dev > /tmp/zoom-automator-server.log 2>&1 &
echo $! > /tmp/zoom-automator-server.pid
```

Check if it's running:

```bash
curl http://127.0.0.1:17394/health
```

View logs:

```bash
tail -f /tmp/zoom-automator-server.log
```

Stop the server:

```bash
kill "$(cat /tmp/zoom-automator-server.pid)"
```

## API Reference

The local server exposes these endpoints on `http://127.0.0.1:17394`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Returns server health status |
| `/status` | GET | Returns current automation state (meeting active, auth status, etc.) |
| `/meeting/join` | POST | Starts a Zoom meeting (called by extension when you join Meet) |
| `/meeting/leave` | POST | Ends the Zoom meeting (called by extension when you leave Meet) |
| `/auth/login` | POST | Opens a headed browser for one-time Zoom authentication |

## Project Structure

```
packages/
  extension/          # Chrome extension (Meet detection)
    src/
    public/
    dist/             # Built extension (load this in Chrome)
  server/             # Local automation server
    index.ts
    zoom-automator.ts
```

## Development Commands

```bash
bun run build          # Build the extension once
bun run build:watch    # Build extension and watch for changes
bun run build:dist     # Build extension as a ZIP for distribution
bun run typecheck      # Run TypeScript type checking
bun run server:dev     # Run the local server
bun run server:compile # Compile server to a standalone binary
```

## The Road Ahead

The long-term vision (if I ever get around to it) is to turn this into a proper desktop app:

- **A real macOS app** - Menu bar icon, proper installation via DMG, no Terminal required
- **Chrome Web Store extension** - One-click install instead of developer mode side-loading
- **Guided onboarding** - Step-by-step setup that anyone can follow
- **Better reliability** - Retry logic, better error handling, diagnostics

Basically, something your non-technical coworker could install and use. Right now it's very much a "developer prototype" - functional but rough around the edges.

No promises on timeline. This is a side project, after all.

---

*Built with stubborn determination, a couple of my friends named Claude and Codex, and an unreasonable amount of caffeine.*
