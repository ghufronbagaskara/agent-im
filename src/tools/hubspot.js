const STALE_DAYS = 3;

export async function hubspotPipelineSummary() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return null;

  try {
    const response = await fetch(
      "https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,hs_lastmodifieddate",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      console.error("[tool:hubspot]", response.status, await response.text());
      return null;
    }

    const { results = [] } = await response.json();
    const byStage = {};
    let total = 0;
    const stale = [];
    const big = [];
    const now = Date.now();

    for (const deal of results) {
      const properties = deal.properties || {};
      const amount = Number(properties.amount || 0);
      const stage = properties.dealstage || "unknown";

      byStage[stage] = (byStage[stage] || 0) + 1;
      total += amount;

      const modified = properties.hs_lastmodifieddate
        ? new Date(properties.hs_lastmodifieddate).getTime()
        : now;

      if ((now - modified) / 86400000 > STALE_DAYS) {
        stale.push(properties.dealname || deal.id);
      }

      if (amount >= 100_000_000) {
        big.push(
          `${properties.dealname || deal.id} (IDR ${amount.toLocaleString("id-ID")})`,
        );
      }
    }

    const stageLines = Object.entries(byStage)
      .map(([stage, count]) => `  ${stage}: ${count}`)
      .join("\n");

    return [
      `Open deals: ${results.length}`,
      `Total pipeline value: IDR ${total.toLocaleString("id-ID")}`,
      `By stage:\n${stageLines || "  none"}`,
      `Stale (>${STALE_DAYS}d): ${stale.length ? stale.join(", ") : "none"}`,
      `Big deals (>=IDR 100M): ${big.length ? big.join(", ") : "none"}`,
    ].join("\n");
  } catch (error) {
    console.error("[tool:hubspot]", error.message);
    return null;
  }
}
