# 14all Showcase Recording — Hygiene Checklist

Goal: produce a clean screen recording of **ai-14all** for the public OSS launch that leaks nothing about the real machine, the operator's identity, or unreleased sibling projects.

This checklist is derived from a privacy review of the first recording (`showcase.mov`), which exposed:

- macOS username + hostname in the terminal prompt (`vuphan@vpmac`)
- absolute paths revealing the username (`/Users/vuphan/...`, `~/Dev/ai-14all/.worktrees/...`, `~/.ai-pref-nsync/...`)
- unreleased sibling project codenames in the workspace sidebar (`ai-ezio`, `ai-samantha`, `ai-whisper`, `ai-xavier`) — visible in nearly every frame
- internal roadmap via design/spec filenames in the file picker
- a full unreleased-product README (ai-samantha) and crypto internals (ai-xavier)

The strategy: **record as a dedicated, throwaway macOS user with synthetic repos.** This removes the username everywhere (prompt *and* absolute paths) and gives full control over what appears in the workspace.

---

## 1. Identity — the throwaway demo account (do this once)

Recording under your own user means absolute paths printed by commands/docs still say `/Users/vuphan/...`. A separate account fixes this at the OS level.

```sh
# Create a standard demo user (run in your normal admin account)
sysadminctl -addUser demo -fullName "Demo" -password -   # prompts for a password

# Neutralize the hostname so the shell prompt shows "demo@demo", not "...@vpmac"
sudo scutil --set HostName demo
sudo scutil --set LocalHostName demo
sudo scutil --set ComputerName demo
```

Log out and into the `demo` account to record. Everything below happens in that account.

> If you cannot make a separate account, see the fallback in §6 — but know that absolute paths will still leak your real username.

## 2. Shell prompt

A fresh account has no dotfiles, so the prompt defaults to something plain. To guarantee a clean, branded-looking prompt with no `user@host`, drop this in the demo user's `~/.zshrc`:

```sh
# Minimal, identity-free prompt for recording
export PROMPT='%F{cyan}~%1~%f %# '
# If starship/oh-my-posh is installed globally, either disable it for this user
# or point STARSHIP_CONFIG at a minimal config that omits username/hostname.
```

Verify before recording: open the terminal, confirm no real username, hostname, or `/Users/<you>` appears.

## 3. Synthetic repo playground

Create fake repos with neutral, demo-friendly names so the **workspace sidebar shows only demo projects** — never `ai-ezio` / `ai-samantha` / `ai-whisper` / `ai-xavier`.

- Put them under the demo home, e.g. `~/Dev/acme-web`, `~/Dev/acme-api`, `~/Dev/notes-app`.
- Use believable but obviously-generic names. Avoid anything that hints at internal projects or clients.
- Seed each with a small, real-looking git history (`git init`, a few commits) so the Commits/Changes tabs look alive.
- Write synthetic README/spec/docs content. **Do not** copy real specs — the file picker lists every filename, and those names leak roadmap.

## 4. App / workspace state

- Load **only** the synthetic workspaces in ai-14all. Close/remove every real sibling workspace before recording.
- Double-check the **left sidebar** at all times — it was the single biggest persistent leak. If a real project name can appear there, it will end up in the footage.
- Watch panes that print real paths: the agent/collab panes, file pickers, command palette, and any `ls`/`pwd`/git output.

## 5. Screen & desktop

- **Do Not Disturb / Focus on** — no notification banners (Slack, Mail, calendar).
- Quit other apps; close all browser windows (tab titles + URLs leak).
- Neutral desktop wallpaper; hide desktop icons if any are named.
- Hide the menu-bar clutter and Dock if they show personal apps/badges.
- Record the app window only (not full screen) when possible.
- Consider a fresh recording resolution that matches the target (1080p) to skip rescaling.

## 6. Fallback (recording as your own user)

Only if a demo account isn't possible:

- Set the identity-free prompt from §2 in your own `~/.zshrc` (or temporarily `export PROMPT=...` in the recording shell).
- Use synthetic repos under a path that avoids your home if you can (still leaks `/Users/<you>` in absolute output — unavoidable here).
- Accept that any command/doc printing an absolute path will show your real username. This is why the demo account is preferred.

Blurring the username in post is **not recommended**: the terminal prompt scrolls, so a fixed blur box won't track it reliably, and a single missed frame ships the leak.

## 7. Post-record verification (do not skip)

Before publishing, re-run the same privacy check used on the first cut:

```sh
# Extract a full-res frame every 3s and eyeball every one
mkdir -p /tmp/showcase-frames
ffmpeg -hide_banner -loglevel error -i NEW_RECORDING.mp4 \
  -vf "fps=1/3" -q:v 2 /tmp/showcase-frames/frame_%03d.jpg
```

Review each frame for: username, hostname, absolute paths, sibling codenames, real doc/spec filenames, secrets/tokens, notifications, other windows.

## 8. Final encode (3× speed, web-ready mp4 — reused from the first pass)

```sh
ffmpeg -i NEW_RECORDING.mov -filter:v "setpts=PTS/3,scale=1920:-2" -r 60 \
  -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p \
  -movflags +faststart -an showcase_3x.mp4
```

For a lightweight GIF (README/landing embeds):

```sh
ffmpeg -i showcase_3x.mp4 \
  -filter_complex "fps=10,scale=600:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  showcase_3x.gif
```
