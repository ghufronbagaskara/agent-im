export async function getKnowledge(db, key) {
  const { rows } = await db.query(
    `SELECT value FROM org_knowledge WHERE key=$1`,
    [key],
  );
  return rows[0]?.value || "";
}

const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "text-embedding-004";
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return chunks;
}

// Self-hosted RAG memory (replaces the earlier Zep/MCP "memory" server, which
// is discontinued and needed an OpenAI key we don't have). Backed by pgvector
// on the same Postgres instance, embedded with Gemini.
export async function embedText(text) {
  if (!process.env.GEMINI_API_KEY) return null;

  try {
    const response = await fetch(
      `${GEMINI_API_URL}/${EMBED_MODEL}:embedContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      },
    );

    if (!response.ok) {
      console.error("[knowledge:embed]", response.status, await response.text());
      return null;
    }

    const body = await response.json();
    return body.embedding?.values || null;
  } catch (error) {
    console.error("[knowledge:embed]", error.message);
    return null;
  }
}

export async function ingestKnowledge(db, source, text) {
  let stored = 0;
  for (const chunk of chunkText(text)) {
    const embedding = await embedText(chunk);
    if (!embedding) continue;

    await db.query(
      `INSERT INTO knowledge_chunks (source, chunk, embedding) VALUES ($1, $2, $3::vector)`,
      [source, chunk, `[${embedding.join(",")}]`],
    );
    stored += 1;
  }
  return stored;
}

export async function queryKnowledge(db, query, limit = 5) {
  const embedding = await embedText(query);
  if (!embedding) return [];

  const { rows } = await db.query(
    `SELECT source, chunk FROM knowledge_chunks
     ORDER BY embedding <-> $1::vector LIMIT $2`,
    [`[${embedding.join(",")}]`, limit],
  );
  return rows;
}
