# Finger Crush and Slide

A server-authoritative, two-player browser game. Node.js 20+.

## Run locally

    npm install
    npm start

Visit http://localhost:3000 in two browser sessions. On phones use your computer's LAN address and open port 3000.

## Deploy on Render

Upload this project to a Git repository. In Render, create a Web Service from that repository; choose Node, the Free instance, build command `npm install`, and start command `npm start`. Render assigns a public URL. The server uses Render's `PORT` environment variable. Free services may sleep and restart; active rooms are in memory and do not survive a restart.

## Notes

Rooms are limited to two players; session tokens are retained in sessionStorage to reconnect in the same browser tab. Rooms expire after two minutes disconnected. The server estimates time via clock synchronization and accepts a bounded 350ms window for late inputs. Real network conditions affect fairness, especially with high jitter or latencies beyond this allowance. The prototype has not been security audited or load tested. A public deployment should be tested with two real devices and connections before submission.
