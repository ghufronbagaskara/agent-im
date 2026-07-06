import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

import { generateReply } from "./llm.js";

const NOTES_SYSTEM = `You summarize meeting transcripts for Isaac Munandar (CEO, MAXY AI).
Map action items to this team first, matching by role if a name is ambiguous:
Sydney=Sales, Ika=Operations, Jose=MarCom, Andy=CTO/Tech, Jessica=University/Academic,
Stefen=Project Management, Bryan=PA to Isaac, Isaac=CEO (assign only decisions/approvals only he can do).
If a PIC cannot be determined, write TBD — never guess.

Output in English, no emojis, no filler, in EXACTLY this structure:

### Meeting Summary
**Date:** {use the date provided by the system — do not invent}
**Meeting:** {title or inferred topic}
**Attendees:** {names mentioned}

### Discussion Points
Numbered list, one distinct topic/decision each, past tense, specific.

### Action Items
| # | Task | PIC | Deadline |
Verb-led tasks. Deadline from transcript or TBD.

### Open Questions / Blockers
Only if any exist.

### CEO Notes (Isaac Only)
Max 3 bullets: decisions/approvals/strategic flags for Isaac. Omit if none.

If the transcript is in Bahasa Indonesia, summarize in English (do not translate word-for-word).
If it appears incomplete, add [Note: Transcript appears incomplete] at the top.`;

export async function generateMeetingSummary(transcript, meetingDate) {
  const userContent =
    `Meeting date and time (authoritative — use this exact date): ${meetingDate}\n\n` +
    `Transcript:\n${transcript}`;

  const { reply } = await generateReply(
    [{ role: "user", content: userContent }],
    { system: NOTES_SYSTEM, policy: "sensitive" },
  );

  return reply;
}

function approvalRow(noteId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`notes:approve:${noteId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`notes:reject:${noteId}`)
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger),
  );
}

export async function handleNotesCommand(msg, db) {
  const body = msg.content.slice("!notes".length).trim();
  const dateMatch = body.match(/^(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?)/);
  const meetingDate = dateMatch
    ? dateMatch[1]
    : new Date().toISOString().slice(0, 10);
  let transcript = dateMatch ? body.slice(dateMatch[0].length).trim() : body;

  const attachment = msg.attachments.first();
  if (attachment && /\.txt$/i.test(attachment.name || "")) {
    transcript = await (await fetch(attachment.url)).text();
  }

  if (!transcript || transcript.length < 20) {
    await msg.reply(
      "Paste the transcript after the date, or attach a .txt. Format: `!notes YYYY-MM-DD <transcript>`",
    );
    return;
  }

  await msg.channel.sendTyping();

  let summary;
  try {
    summary = await generateMeetingSummary(transcript, meetingDate);
  } catch (err) {
    console.error(err);
    await msg.reply(
      "Could not generate notes on the confidential-safe provider (Anthropic). Not falling back to a free tier for meeting data. Check the API key / limits.",
    );
    return;
  }

  const { rows } = await db.query(
    `INSERT INTO meeting_notes (channel_id, meeting_date, summary_md, created_by)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [msg.channelId, meetingDate, summary, msg.author.tag],
  );
  const noteId = rows[0].id;

  const header = `**Meeting Notes — draft (pending approval)** · id ${noteId}\n`;
  const full = header + summary;
  for (let i = 0; i < full.length; i += 1900) {
    const isLast = i + 1900 >= full.length;
    await msg.reply({
      content: full.slice(i, i + 1900),
      components: isLast ? [approvalRow(noteId)] : [],
    });
  }
}

export async function handleNotesButton(interaction, db) {
  const [, action, noteId] = interaction.customId.split(":");
  const { rows } = await db.query(
    `SELECT * FROM meeting_notes WHERE id = $1`,
    [noteId],
  );

  if (!rows.length) {
    await interaction.reply({ content: "Note not found.", ephemeral: true });
    return;
  }

  if (action === "reject") {
    await db.query(`UPDATE meeting_notes SET status='rejected' WHERE id=$1`, [
      noteId,
    ]);
    await interaction.update({
      content: `Note ${noteId} rejected. Nothing distributed.`,
      components: [],
    });
    return;
  }

  if (action === "approve") {
    await db.query(
      `UPDATE meeting_notes SET status='approved', approved_at=now() WHERE id=$1`,
      [noteId],
    );

    let distMsg = "saved to database";
    try {
      if (process.env.NOTION_TOKEN && process.env.NOTION_NOTES_DB) {
        await pushToNotion(rows[0]);
        distMsg = "saved + pushed to Notion";
      }
    } catch (err) {
      console.error("[notion]", err);
      distMsg = "saved to database (Notion push failed — check logs)";
    }

    await interaction.update({
      content: `Note ${noteId} **approved** — ${distMsg}.`,
      components: [],
    });
  }
}

async function pushToNotion(note) {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { database_id: process.env.NOTION_NOTES_DB },
      properties: {
        Name: {
          title: [
            { text: { content: `Meeting Notes — ${note.meeting_date}` } },
          ],
        },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ text: { content: note.summary_md.slice(0, 1900) } }],
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Notion ${res.status}: ${await res.text()}`);
  }
}
