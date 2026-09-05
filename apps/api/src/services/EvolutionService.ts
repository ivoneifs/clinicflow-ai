import { env } from '../config/env.js';

type EvolutionInstance = { name?: string; connectionStatus?: string };

export class EvolutionService {
  async getStatus() {
    if (!env.EVOLUTION_API_URL || !env.EVOLUTION_API_KEY) throw new Error('Evolution API não configurada.');
    const response = await fetch(`${env.EVOLUTION_API_URL.replace(/\/$/, '')}/instance/fetchInstances`, { headers: { apikey: env.EVOLUTION_API_KEY } });
    if (!response.ok) throw new Error(`Evolution API respondeu ${response.status}.`);
    const instances = await response.json() as EvolutionInstance[];
    const instance = instances.find((item) => item.name === env.EVOLUTION_INSTANCE);
    if (!instance) return { instance: env.EVOLUTION_INSTANCE, status: 'not_found', connected: false };
    return { instance: instance.name, status: instance.connectionStatus || 'unknown', connected: instance.connectionStatus === 'open' };
  }
}

export const evolutionService = new EvolutionService();
