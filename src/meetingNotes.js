import { promises as fs } from "fs";
import os from "os";
import path from "path";

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import { generateReply } from "./llm.js";
import { reportError } from "./ops.js";
import { addActionItems } from "./tools/calendar.js";
import { meetingNotesPdf } from "./tools/pdf.js";

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

function extractActionItems(summaryMd) {
  const match = summaryMd.match(
    /### Action Items\s*([\s\S]*?)(?:\n###\s|\s*$)/i,
  );
  if (!match) return [];

  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith("|") &&
        !/\|\s*#\s*\|/i.test(line) &&
        !/^\|\s*-+\s*\|/.test(line),
    )
    .map((line) => line.replace(/^\||\|$/g, ""))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4)
    .map((cells) => ({
      task: cells[1],
      pic: cells[2],
      deadline: cells[3],
    }));
}

export async function createMeetingNote(
  client,
  db,
  { channelId, transcript, meetingDate, createdBy = "fathom" },
) {
  const summary = await generateMeetingSummary(transcript, meetingDate);
  const { rows } = await db.query(
    `INSERT INTO meeting_notes (channel_id, meeting_date, summary_md, created_by)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [channelId, meetingDate, summary, createdBy],
  );
  const noteId = rows[0].id;
  const channel = await client.channels.fetch(channelId);

  if (!channel?.isTextBased()) {
    throw new Error(`Meeting channel ${channelId} is missing or not text-based`);
  }

  const full = `**Meeting Notes - draft (pending approval)** · id ${noteId}\n${summary}`;
  for (let i = 0; i < full.length; i += 1900) {
    const isLast = i + 1900 >= full.length;
    await channel.send({
      content: full.slice(i, i + 1900),
      components: isLast ? [approvalRow(noteId)] : [],
    });
  }

  return noteId;
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

  try {
    await createMeetingNote(msg.client, db, {
      channelId: msg.channelId,
      transcript,
      meetingDate,
      createdBy: msg.author.tag,
    });
  } catch (err) {
    await reportError("meetingNotes:create", err);
    await msg.reply(
      "Could not generate notes on the confidential-safe provider (Anthropic). Not falling back to a free tier for meeting data. Check the API key / limits.",
    );
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

  const note = rows[0];

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

    const distribution = ["saved to database"];
    try {
      if (process.env.NOTION_TOKEN && process.env.NOTION_NOTES_DB) {
        await pushToNotion(note);
        distribution.push("pushed to Notion");
      }
    } catch (err) {
      await reportError("meetingNotes:notion", err);
      distribution.push("Notion push failed");
    }

    try {
      if (await addActionItems(extractActionItems(note.summary_md))) {
        distribution.push("added action items to Calendar");
      }
    } catch (err) {
      await reportError("meetingNotes:calendar", err);
      distribution.push("Calendar push failed");
    }

    await interaction.update({
      content: `Note ${noteId} **approved** - ${distribution.join(", ")}.`,
      components: [],
    });

    const pdfPath = path.join(os.tmpdir(), `notes-${noteId}.pdf`);
    try {
      await meetingNotesPdf(note, pdfPath);
      await interaction.followUp({
        content: "Client-facing PDF (CEO notes stripped):",
        files: [pdfPath],
      });
    } catch (err) {
      await reportError("meetingNotes:pdf", err);
      await interaction.followUp({
        content: "PDF generation failed - check logs.",
      });
    } finally {
      await fs.unlink(pdfPath).catch(() => {});
    }
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
