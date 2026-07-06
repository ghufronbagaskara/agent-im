import http from "http";

import { createMeetingNote } from "./meetingNotes.js";
import { reportError } from "./ops.js";

export function startWebhook(client, db) {
  const secret = process.env.WEBHOOK_SECRET;
  const port = Number(process.env.WEBHOOK_PORT || 3010);
  const meetingsChannel = process.env.CHANNEL_MEETINGS;

  if (!secret || !meetingsChannel) {
    console.log("[webhook] disabled (missing WEBHOOK_SECRET or CHANNEL_MEETINGS)");
    return null;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/fathom")) {
      res.writeHead(404);
      res.end();
      return;
    }

    const url = new URL(req.url, "http://localhost");
    if (url.searchParams.get("token") !== secret) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const meetingDate =
          payload.meeting_date || new Date().toISOString().slice(0, 16);
        const transcript = payload.transcript || payload.text || "";

        if (transcript.length < 20) {
          res.writeHead(400);
          res.end("no transcript");
          return;
        }

        await createMeetingNote(client, db, {
          channelId: meetingsChannel,
          transcript,
          meetingDate,
        });

        res.writeHead(200);
        res.end("ok");
      } catch (error) {
        await reportError("webhook", error);
        res.writeHead(500);
        res.end("error");
      }
    });
  });

  server.on("error", (error) => {
    void reportError("webhook:server", error);
  });
  server.listen(port, () => console.log(`[webhook] listening on ${port}`));
  return server;
}
