import { createDecipheriv, createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

const keys = ['OPENAI_API_KEY', 'EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE', 'N8N_AI_WEBHOOK_URL', 'WEBHOOK_SHARED_SECRET'] as const;
export type IntegrationKey = typeof keys[number];
const secret = () => createHash('sha256').update(process.env.MASTER_ADMIN_TOKEN_SECRET || process.env.MASTER_ADMIN_PASSWORD || 'clinicflow-runtime-config').digest();

export function decryptSetting(value: string) {
  try {
    const [ivHex, tagHex, dataHex] = value.split(':');
    if (!ivHex || !tagHex || !dataHex) return value;
    const decipher = createDecipheriv('aes-256-gcm', secret(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch { return ''; }
}

export async function getRuntimeConfig() {
  const stored = await prisma.systemSetting.findMany({ where: { key: { in: [...keys] } } });
  const values = Object.fromEntries(stored.map((item) => [item.key, decryptSetting(item.value)]));
  return {
    OPENAI_API_KEY: values.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    EVOLUTION_API_URL: values.EVOLUTION_API_URL || process.env.EVOLUTION_API_URL,
    EVOLUTION_API_KEY: values.EVOLUTION_API_KEY || process.env.EVOLUTION_API_KEY,
    EVOLUTION_INSTANCE: values.EVOLUTION_INSTANCE || process.env.EVOLUTION_INSTANCE || 'nova',
    N8N_AI_WEBHOOK_URL: values.N8N_AI_WEBHOOK_URL || process.env.N8N_AI_WEBHOOK_URL,
    WEBHOOK_SHARED_SECRET: values.WEBHOOK_SHARED_SECRET || process.env.WEBHOOK_SHARED_SECRET,
  };
}
