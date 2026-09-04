import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const whatsappQueue = new Queue('clinicflow-whatsapp', {
  connection: redis,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1500 }, removeOnComplete: 1000, removeOnFail: 5000 },
});

export const enqueueIncomingMessage = (payload: { clinicId: string; webhookId: string; phone: string; text: string }) =>
  whatsappQueue.add('process-incoming-message', payload);
