# Ottawa 67's Broadcast Toolkit

A game log, player stats tracker (with faceoffs and plus/minus), goal-by-goal
strength log, and pre-game spotting board with line-photo upload — built as a
real web app with a Node/Express backend and a SQLite database, so it can be
deployed and reached from any device, not just the browser it's opened in.

## Project structure

```
ottawa67s-app/
  server.js        Express server + REST API
  db.js             SQLite schema and connection
  seed.js           Optional: loads one sample preseason game
  package.json
  public/
    index.html      Frontend markup (4 tabs)
    style.css
    app.js          Frontend logic — calls the API instead of localStorage
  data/             SQLite database file lives here (created automatically)
```

## Running it locally

You'll need [Node.js](https://nodejs.org) 18 or newer installed.

```bash
cd ottawa67s-app
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

Optional — load one sample game to explore the app with data already in it:

```bash
node seed.js
```

## Deploying to Railway (so it's live on the internet)

1. **Push this folder to a GitHub repository.**
   ```bash
   cd ottawa67s-app
   git init
   git add .
   git commit -m "Initial commit"
   ```
   Create a new repo on GitHub, then follow GitHub's instructions to push
   (something like `git remote add origin <your-repo-url>` then
   `git push -u origin main`).

2. **Create a Railway account** at [railway.app](https://railway.app) if you
   don't have one, and click **New Project → Deploy from GitHub repo**.
   Select the repository you just pushed.

3. Railway will detect the Node app automatically from `package.json` and run
   `npm install` then `npm start`. No extra configuration is required for a
   first deploy.

4. **Add a persistent Volume** (important — without this, your data resets
   every time you redeploy):
   - In your Railway project, go to your service → **Settings → Volumes**.
   - Add a volume and mount it at, for example, `/data`.
   - Go to **Variables** and add: `DB_PATH=/data/toolkit.db`
   - Redeploy. The database will now live on the persistent volume.

5. Once deployed, Railway gives you a public URL (Settings → Networking →
   Generate Domain). That URL is your live site — open it from your phone,
   laptop, or share it with anyone else in your broadcast booth.

## Notes

- Photos (uploaded line graphics) are stored as base64 text directly in the
  database. This is simple and works well for a handful of images, but if
  you upload many large, uncompressed photos over a season, consider
  switching to a dedicated file storage approach (e.g. Railway Volumes for
  files, or an object storage service) — ask if you'd like that added.
- The season aggregates in the app only include games marked as the currently
  selected type filter (defaults to "All Games" — switch it to "Regular
  Season" once your real season is underway so preseason games don't affect
  your record and stat trends).
- This is a single-user tool with no login — anyone with the URL can view and
  edit data. If you want to share the live link publicly (e.g. with viewers)
  while keeping editing private, let me know and I can add basic
  password-protected admin access.
