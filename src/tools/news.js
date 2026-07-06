function decodeEntities(value) {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

export async function googleNews(query, limit = 8) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-ID&gl=ID&ceid=ID:en`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 HermesBot" },
    });
    if (!response.ok) return [];

    const xml = await response.text();
    const items = [
      ...xml.matchAll(
        /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g,
      ),
    ];

    return items.slice(0, limit).map((item) => ({
      title: decodeEntities(item[1]),
      date: item[2].trim(),
    }));
  } catch (error) {
    console.error("[tool:news]", error.message);
    return [];
  }
}
