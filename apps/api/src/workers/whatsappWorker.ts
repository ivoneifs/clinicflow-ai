import { Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/queues.js';
import { getRuntimeConfig } from '../services/runtimeConfig.js';
import { attendantAgentService } from '../services/AttendantAgentService.js';

type IncomingJob = { clinicId: string; webhookId: string; phone: string; remoteJid?: string; text: string; messageType?: string; instance?: string; payload?: Record<string, unknown> };

export const whatsappWorker = new Worker<IncomingJob>('clinicflow-whatsapp', async (job) => {
  const result = await attendantAgentService.process(job.data);
  await prisma.evolutionWebhook.update({ where: { id: job.data.webhookId }, data: { processedAt: new Date() } });
  return result;
}, { connection: redis, concurrency: 10 });

whatsappWorker.on('failed', (job, error) => console.error(`[whatsapp-worker] job ${job?.id} falhou`, error));
