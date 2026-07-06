export async function getKnowledge(db, key) {
  const { rows } = await db.query(
    `SELECT value FROM org_knowledge WHERE key=$1`,
    [key],
  );
  return rows[0]?.value || "";
}
