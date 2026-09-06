import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { getRuntimeConfig } from './runtimeConfig.js';

type EvolutionInstance = { name?: string; connectionStatus?: string };

export const toBrazilianNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
};

export class EvolutionService {
  async getStatus() {
    const config = await getRuntimeConfig();
    if (!config.EVOLUTION_API_URL || !config.EVOLUTION_API_KEY) throw new Error('Evolution API não configurada.');
    const response = await fetch(`${config.EVOLUTION_API_URL.replace(/\/$/, '')}/instance/fetchInstances`, { headers: { apikey: config.EVOLUTION_API_KEY } });
    if (!response.ok) throw new Error(`Evolution API respondeu ${response.status}.`);
    const instances = await response.json() as EvolutionInstance[];
    const instance = instances.find((item) => item.name?.toLowerCase() === config.EVOLUTION_INSTANCE?.toLowerCase());
    if (!instance) return { instance: config.EVOLUTION_INSTANCE, status: 'not_found', connected: false };
    return { instance: instance.name, status: instance.connectionStatus || 'unknown', connected: instance.connectionStatus === 'open' };
  }

  async sendText({ instance, number, text }: { instance: string; number: string; text: string }): Promise<Prisma.InputJsonValue> {
    const config = await getRuntimeConfig();
    if (!config.EVOLUTION_API_URL || !config.EVOLUTION_API_KEY) throw new Error('Evolution API não configurada.');
    const response = await fetch(`${config.EVOLUTION_API_URL.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: { apikey: config.EVOLUTION_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ number: toBrazilianNumber(number), text }),
    });
    const responseText = await response.text();
    if (!response.ok) {
      const details = responseText.replace(/\s+/g, ' ').trim().slice(0, 240);
      throw new Error(`Evolution API respondeu ${response.status} ao enviar mensagem${details ? `: ${details}` : '.'}`);
    }
    try { return JSON.parse(responseText) as Prisma.InputJsonValue; } catch { return { ok: true }; }
  }
}

export const evolutionService = new EvolutionService();
