let clientRef = null;
let opsChannelId = null;

export function initOps(client) {
  clientRef = client;
  opsChannelId = process.env.CHANNEL_OPS;
}

export async function reportError(context, err) {
  console.error(`[${context}]`, err);

  try {
    if (!clientRef || !opsChannelId) return;

    const channel = await clientRef.channels.fetch(opsChannelId);
    if (!channel?.isTextBased()) return;

    await channel.send(
      `[ops] ${context}: ${(err?.message || String(err)).slice(0, 1800)}`,
    );
  } catch {}
}
