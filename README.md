# 🕹️ Friend Arcade

A browser game where you create a **private room**, invite friends with a **link or 5-letter code**, and play three multiplayer games together. It also has an optional **voice and video call** that stays connected while you play.

| Game | Players | What happens |
|---|---|---|
| 🚀 **Spaceship Sabotage** | 3–10 (2 works for testing) | An original social-deduction game. The crew do tasks around a spaceship, and a secret saboteur zaps crewmates and triggers reactor meltdowns. Players can call emergency meetings, chat and vote. |
| 🗼 **Tower Rush** | 1–10 | Race to the top of an 8-floor obstacle tower with moving platforms, narrow jumps, spikes and saws. The first player to reach the top wins. If time runs out, the highest climber wins. |
| 🏎️ **Circuit Sprint** | 1–10 | A top-down car race over 3 laps with 10 checkpoints and a time limit. You can race solo or in a **Red vs Blue team race**. |

What else it does:

* **Accounts:** sign up and sign in. Your coins, wins, best times and unlocked items are saved on the server, so they follow you to any device.
* **Avatar editor:** pick a body colour, face, hairstyle, outfit and accessory. Your avatar appears in the lobby, in every game, on the results screen and in the call.
* **Coins:** coins are awarded after every match and can be spent on cosmetics. They are earned in-game only and have **no real-money value**. You can't buy them.
* **The server is in charge:** game physics, results and coin awards all run on the server. Each match has a unique ID, and its prize is written to the database **once only**. Refreshing, reconnecting or retrying can't pay out the same prize twice.

---

## 1. Run it on your computer

You need **Node.js 22.13 or newer** (https://nodejs.org, choose the "LTS" download). That's the only requirement.

```bash
# in the project folder
npm start
```

Open **http://localhost:3000**.

There are **no npm packages to install**. The server only uses parts that come with Node:

* `node:http` for the web server
* `node:sqlite` for the database
* `node:crypto` for password hashing (scrypt)
* a small WebSocket server written in `server/ws.js`

Running `npm install` is harmless, but it isn't needed.

### Test it with two players on one computer

1. Open http://localhost:3000 in a normal browser window and **create an account** (for example `player1`).
2. Open a **private/incognito window**, or a different browser, go to http://localhost:3000 and create a second account (for example `player2`).
   Each player needs their own account. If the same account opens in two tabs, the older tab gets disconnected on purpose.
3. In window 1 click **Create a private room**, then **Copy invite link**. Paste the link into window 2. (You can also type the room code into **Join**.)
4. The host picks a game. Both players click **I'm ready!**, and the host clicks **Start game**.
5. To try the call, click **📞 Join call** in both windows, then turn on **Mic** or **Cam**. Your browser will ask for permission.

### Run the automated tests

```bash
npm test
```

There are 11 tests. They cover:

* sign-up and sign-in
* a full match over WebSockets
* refreshing in the middle of a match
* one-time prizes, including a deliberate second attempt to award the same match
* the shop and avatar ownership checks
* call signalling
* the rules of each game, including an "autopilot" car that drives 3 full laps

---

## 2. Controls

Press **H** (or the **?** button) in any game to see that game's controls.

| | Keys |
|---|---|
| **Spaceship Sabotage** | Move: **arrows / WASD**. Do a task or fix the reactor: hold **E**. Call a meeting: **E** or **F** at the red button. Report a frozen crewmate: **R**. Saboteur only: zap **Q**, start a meltdown **X**. |
| **Tower Rush** | Run: **← → / A D**. Jump: **Space / ↑ / W**. |
| **Circuit Sprint** | Accelerate: **↑ / W**. Brake or reverse: **↓ / S**. Steer: **← → / A D**. |

On phones and tablets, on-screen arrow buttons appear automatically. The Spaceship Sabotage action buttons can be tapped too.

### Game rules in detail

**Spaceship Sabotage**

* 1 saboteur is picked at random (2 saboteurs with 7 or more players). Each crewmate gets 4 tasks.
* **The crew win** when every crew task is finished, or when every saboteur has been voted out.
* **The saboteur wins** in either of these cases:
  * Enough crew are zapped (the saboteurs equal or outnumber the crew).
  * A **reactor meltdown** (40 seconds) runs out before both reactor panels are fixed.
* Emergency meetings and reports are blocked during a meltdown.
* Zapped players become ghosts. Ghosts can still finish their tasks, and they chat only with other ghosts.
* Each player can call one emergency meeting. Meetings last 60 seconds. A player is ejected only with the most votes and more votes than "skip".
* A safety timer of 10 minutes ends the match as a crew win.
* **Coins:** every member of the winning side gets 50. Everyone else gets 10.

**Tower Rush**

* The time limit is 3 minutes.
* When someone reaches the top, everyone else gets 30 more seconds at most.
* Finishers are ranked by time. Everyone else is ranked by the highest point they reached.
* **Coins:** 1st place 50, 2nd 35, 3rd 25, everyone else 15. Finishing times count as "best time" in your stats.

**Circuit Sprint**

* 3 laps through 10 checkpoints, with a time limit of 2:30. When someone finishes, everyone else gets 30 more seconds at most.
* Finishers are ranked by time. Everyone else is ranked by **lap, then checkpoint, then distance to the next checkpoint**.
* **Coins:** same as Tower Rush, by place.
* **Team race:** each racer earns placement points (1st place = the number of racers, last place = 1). A team's score is the **average** of its members' points, so uneven teams stay fair. If the scores tie, the team with the best single finisher wins. Every member of the winning team gets **+30 bonus coins**.

---

## 3. Project files

```
friend-arcade/
├── package.json          start/test scripts (no dependencies needed)
├── .env.example          sample settings, no secrets: copy to .env
├── Dockerfile            container image for hosting
├── server/
│   ├── index.js          web server, sign-in/shop API, static files
│   ├── config.js         reads settings from environment / .env
│   ├── ws.js             small WebSocket server
│   ├── db.js             SQLite: users, sessions, unlocks, stats, matches, awards
│   ├── rooms.js          rooms, ready/start, host handover, reconnects, call signalling
│   └── games/
│       ├── base.js       shared game plumbing
│       ├── sabotage.js   Spaceship Sabotage rules
│       ├── tower.js      Tower Rush physics and ranking
│       └── circuit.js    Circuit Sprint driving, checkpoints, teams
├── shared/               used by BOTH server and browser
│   ├── cosmetics.js      avatar items and prices
│   ├── sabotage-map.js   spaceship map
│   ├── tower-level.js    tower generator (same seed → same tower)
│   ├── circuit-track.js  race track
│   └── random.js
├── public/               the browser app (plain JavaScript, no build step)
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js        screens, lobby, results, call dock
│       ├── net.js        API + auto-reconnecting WebSocket
│       ├── avatar.js     draws avatars
│       ├── input.js      keyboard + touch controls
│       ├── call.js       WebRTC voice/video
│       └── games/        drawing code for each game
└── test/                 automated tests (npm test)
```

---

## 4. Put it on GitHub

**Easiest (no command line):**

1. Sign in at https://github.com, then click **+ → New repository**. Name it `friend-arcade`, keep it **Private** if you like, and click **Create repository**.
2. On the new repository page, click **"uploading an existing file"**.
3. Drag in **everything inside** the `friend-arcade` folder: the files *and* the `server`, `shared`, `public` and `test` folders. Then click **Commit changes**.
   * The `.gitignore`, `.env.example` and `.dockerignore` files start with a dot, so they may be hidden. On a Mac press **Cmd+Shift+.** in Finder to show them. On Windows tick **View → Hidden items**.

**With git:**

```bash
cd friend-arcade
git init
git add .
git commit -m "Friend Arcade"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/friend-arcade.git
git push -u origin main
```

Never upload a real `.env` file. It's already listed in `.gitignore`.

---

## 5. Put it online for friends

### What hosting you need

| Need | Why |
|---|---|
| **An always-on Node.js server** (not "static" hosting like GitHub Pages or Netlify) | The server runs the games, rooms and WebSockets. |
| **One instance only** | Rooms live in the server's memory. Don't turn on autoscaling or several replicas. |
| **A persistent disk / volume** for the SQLite file | Accounts, coins and unlocks are kept in `DB_PATH`. Without a persistent disk, many hosts **wipe the file on every redeploy or restart**, and everyone loses their accounts. |
| **HTTPS** | Browsers only allow camera and microphone on `https://` pages (or `localhost`). Hosts like Railway and Render give you HTTPS automatically. The app switches to secure `wss://` WebSockets by itself. |
| **WebSocket support** | Railway, Render, Fly.io and a normal VPS all support it. |

If the server restarts in the middle of a match, that match is cancelled and nobody gets coins for it. Saved accounts and coins are safe.

### Option A: Railway (simplest with a volume)

1. Put the project on GitHub (step 4).
2. Go to https://railway.com, then **New Project → Deploy from GitHub repo**, and pick `friend-arcade`. Railway will see the `Dockerfile` and build it.
3. Open the service, right-click the canvas (or press ⌘K), choose **Volume**, attach it to the service, and set the **mount path to `/data`**.
4. Under **Variables**, add:
   ```
   DB_PATH=/data/friend-arcade.db
   TRUST_PROXY=1
   ```
   Add TURN settings too if you have them (see section 6).
5. Go to **Settings → Networking → Generate Domain**. Railway gives you an `https://...up.railway.app` address. Send that link to your friends.

Railway's free/trial plan has small volumes. A paid plan keeps the service running all the time.

### Option B: Render

1. Go to https://render.com, then **New → Web Service**, and connect your GitHub repo. Choose **Docker** (or Runtime *Node* with Build command `npm install` and Start command `npm start`).
2. Choose a **paid instance type**. Render only lets you attach a persistent disk to paid services, and free services sleep and lose their files.
3. Under **Advanced → Add Disk**, set the mount path to `/var/data`.
4. Add these environment variables:
   * `DB_PATH=/var/data/friend-arcade.db`
   * `TRUST_PROXY=1`
   * your TURN settings, if any
5. Deploy. Your link is the `https://...onrender.com` address.

### Option C: your own server (VPS) with Caddy for HTTPS

On an Ubuntu server with a domain name pointing at it:

```bash
# install Node 22 (see nodejs.org for current instructions), then:
git clone https://github.com/YOUR-NAME/friend-arcade.git && cd friend-arcade
cp .env.example .env            # edit DB_PATH, TURN_* etc.
npm start                       # or run it with pm2 / systemd so it restarts
```

Then install Caddy and put this in `/etc/caddy/Caddyfile`. Caddy fetches HTTPS certificates automatically and passes WebSockets through.

```
arcade.example.com {
    reverse_proxy localhost:3000
}
```

Back up the `.db` file regularly.

---

## 6. Calls between friends on different networks (WebRTC)

The call is **peer-to-peer**: each player's browser sends audio and video straight to every other player. The game server only passes along short "how to connect" messages (signalling). Mic and camera **start off**, and each one has its own button. There are also **Sound on/off** (mutes everyone else on your side) and **Leave call** buttons. The call stays connected while you move between the lobby, games and results. If you refresh the page, you rejoin the call automatically with mic and camera off.

To connect, browsers need these ICE servers. The server hands them out at `/api/config`:

* **STUN (free, already set up):** tells each browser its public address. This is enough for many home Wi-Fi networks.
* **TURN (strongly recommended for friends in different houses):** a relay server for when a direct connection is blocked. That happens often on **mobile data, school/office Wi-Fi and some routers**. Without TURN, some players will see "no connection" on a video tile while the game itself keeps working fine.

Ways to get TURN:

1. **A hosted TURN service.** Examples are Metered (it has a free tier, see https://www.metered.ca/stun-turn), ExpressTURN, Twilio or Xirsys. Copy the TURN address, username and password into:
   ```
   TURN_URLS=turn:standard.relay.metered.ca:80,turns:standard.relay.metered.ca:443?transport=tcp
   TURN_USERNAME=the-username-they-give-you
   TURN_CREDENTIAL=the-password-they-give-you
   ```
   (Use the exact addresses your provider shows you. The ones above are only an example.)
2. **Host your own coturn** on a VPS. Use time-limited passwords so no fixed password is ever sent to browsers. In `/etc/turnserver.conf`:
   ```
   listening-port=3478
   tls-listening-port=5349
   fingerprint
   use-auth-secret
   static-auth-secret=CHOOSE-A-LONG-RANDOM-SECRET
   realm=turn.example.com
   cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
   pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
   min-port=49152
   max-port=65535
   ```
   Open these firewall ports: **3478 UDP+TCP**, **5349 TCP**, and **49152–65535 UDP**. Then set:
   ```
   TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
   TURN_SECRET=the-same-long-random-secret
   ```
   The server will create a fresh 1-hour TURN password for each player.

**Size limit:** in a peer-to-peer call each player uploads their video once for every other player. Voice works well for the 10-player room limit. Video is comfortable for about **4–6 people**. For bigger video groups you would need an SFU service (such as LiveKit or Daily) instead of this peer-to-peer design.

---

## 7. Settings (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on (hosts usually set this). |
| `DB_PATH` | `./data/friend-arcade.db` | SQLite file. Put it on a persistent disk when hosting. |
| `TRUST_PROXY` | off | Set to `1` behind Railway/Render/Caddy so rate limiting sees real IPs. |
| `STUN_URLS` | Google public STUN | Comma-separated STUN URLs. |
| `TURN_URLS` | empty | Comma-separated TURN/TURNS URLs. |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | empty | Fixed TURN login. |
| `TURN_SECRET` / `TURN_TTL_SECONDS` | empty / 3600 | coturn shared secret for short-lived logins (overrides the fixed login). |

---

## 8. What is finished, and what isn't tested

**Tested here (automated, plus two browser sessions in headless Chrome on one machine):**

* Sign-up and sign-in.
* Creating a room and joining by invite link.
* Ready, start, and returning the group to the lobby.
* All three games starting and rendering for both players.
* Results and coin awards, including:
  * refreshing during a match and on the results screen
  * no double awards
* The shop and buying an item.
* Team race scoring.
* The video call with fake camera/microphone devices: video arrived at the other player and stayed connected while moving from the lobby into a game.
* The call rejoining after a page refresh.

**Not tested yet (please try these yourself):**

* **Calls between different homes or networks, and with a TURN server.** Calls were only tested between two windows on the same machine.
* **Safari, Firefox, and real phones or tablets.** The touch controls have never been tried on a real touchscreen.
* **Deploying.** The `Dockerfile` was not built, and nothing was deployed to Railway or Render from here. Those steps follow the hosts' documentation but haven't been run.
* **Large games.** Spaceship Sabotage has not been played by 4 or more real people. Its rules were checked by automated tests and a 2-player browser run.
* **Climbing the tower by hand.** No one has played Tower Rush all the way to the top. A script checked that every jump on hundreds of generated towers is within jump range.
* **Game balance.** Speeds, timers and coin amounts are first guesses.

**Known limitations:**

* Rooms live in memory: one server instance only, and a restart cancels running matches.
* There is no "forgot password", because there is no email sign-up.
* Movement is handled by the server, so on a slow connection your character responds a moment late (no client-side prediction).
* Cars and players pass through each other (no collisions between players).
* The Spaceship Sabotage map is a single fixed map.
