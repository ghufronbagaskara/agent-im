---
name: fathom
description: "Pull Fathom meeting recordings, transcripts, and summaries via the Fathom REST API. Use when asked about meetings, calls, transcripts, or to generate meeting notes. Requires FATHOM_API_KEY."
version: 1.0.0
author: Hermes Migration
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Fathom, Meetings, Transcripts, Notes, API]
    related_skills: [maxy-context]
---

# Fathom API

Read-only access to Fathom meetings/transcripts. Base URL: `https://api.fathom.ai/external/v1`
Auth header: `X-Api-Key: $FATHOM_API_KEY` (set in `~/.hermes/.env`; Fathom Team plan → Settings → API).

> If `FATHOM_API_KEY` is unset, this skill cannot pull. Say so and stop — do not invent notes.

## List recent meetings (last 3 days)
```bash
curl -s "https://api.fathom.ai/external/v1/meetings?created_after=$(date -u -d '3 days ago' +%Y-%m-%dT%H:%M:%SZ)" \
  -H "X-Api-Key: $FATHOM_API_KEY"
```

## Get a transcript
```bash
curl -s "https://api.fathom.ai/external/v1/recordings/RECORDING_ID/transcript" \
  -H "X-Api-Key: $FATHOM_API_KEY"
```

## Workflow for meeting notes
1. List meetings since the last processed one.
2. For each new meeting, fetch its transcript.
3. Summarize using the meeting-notes format in the **maxy-context** skill.
4. Remember the last processed recording id in memory to avoid duplicates.
