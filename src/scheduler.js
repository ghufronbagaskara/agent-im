import { Queue, Worker } from "bullmq";

import { AGENTS } from "./agents.js";
import { reportError } from "./ops.js";
import { runAgent } from "./runner.js";

const connection = {
  host: process.env.REDIS_HOST || "hermes-redis",
  port: Number(process.env.REDIS_PORT || 6379),
};

export function startScheduler(client, db) {
  const queue = new Queue("agents", { connection });

  const worker = new Worker(
    "agents",
    async (job) => {
      await runAgent(client, db, job.data.agentId, { queue });
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    void reportError(
      `scheduler:${job?.data?.agentId || "unknown"}`,
      err,
    );
  });

  (async () => {
    for (const agent of AGENTS) {
      if (!agent.enabled || !agent.schedule) continue;
      if (!process.env[agent.channelEnv]) continue;

      await queue.add(
        "run",
        { agentId: agent.id },
        {
          repeat: {
            pattern: agent.schedule,
            tz: process.env.TZ || "Asia/Jakarta",
          },
          jobId: `agent:${agent.id}`,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
    }

    console.log("[scheduler] repeatable jobs registered");
  })().catch((error) => {
    void reportError("scheduler:register", error);
  });

  return queue;
}
