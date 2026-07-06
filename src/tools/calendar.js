import { google } from "googleapis";

import { callTool, hasMcpServer } from "../mcp.js";

function nextDate(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function addActionItems(items) {
  if (
    hasMcpServer("gworkspace") &&
    process.env.GOOGLE_CALENDAR_ID &&
    process.env.MCP_TOOL_GWORKSPACE_CREATE_EVENT
  ) {
    for (const item of items) {
      if (!item.deadline || item.deadline === "TBD") continue;

      await callTool("gworkspace", process.env.MCP_TOOL_GWORKSPACE_CREATE_EVENT, {
        calendar_id: process.env.GOOGLE_CALENDAR_ID,
        summary: `[MAXY] ${item.task} (${item.pic})`,
        start_date: item.deadline,
        end_date: item.deadline,
      });
    }

    return true;
  }

  if (
    !process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    !process.env.GOOGLE_CALENDAR_ID
  ) {
    return false;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  });

  const calendar = google.calendar({ version: "v3", auth });

  for (const item of items) {
    if (!item.deadline || item.deadline === "TBD") continue;

    await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: `[MAXY] ${item.task} (${item.pic})`,
        start: { date: item.deadline },
        end: { date: nextDate(item.deadline) },
      },
    });
  }

  return true;
}
