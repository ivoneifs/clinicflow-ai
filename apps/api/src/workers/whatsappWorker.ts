import { Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/queues.js';
import { getRuntimeConfig } from '../services/runtimeConfig.js';

type IncomingJob = { clinicId: string; webhookId: string; phone: string; text: string };

export const whatsappWorker = new Worker<IncomingJob>('clinicflow-whatsapp', async (job) => {
  const config = await getRuntimeConfig();
  // Em produção, o n8n pode assumir a orquestração de IA usando este contrato estável.
  if (config.N8N_AI_WEBHOOK_URL) {
    const response = await fetch(config.N8N_AI_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(job.data) });
    if (!response.ok) throw new Error(`n8n respondeu ${response.status}`);
  }
  await prisma.evolutionWebhook.update({ where: { id: job.data.webhookId }, data: { processedAt: new Date() } });
  return { forwardedToN8n: Boolean(config.N8N_AI_WEBHOOK_URL) };
}, { connection: redis, concurrency: 10 });

whatsappWorker.on('failed', (job, error) => console.error(`[whatsapp-worker] job ${job?.id} falhou`, error));
