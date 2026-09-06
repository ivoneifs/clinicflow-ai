import { createHmac } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { assistantService } from './AssistantService.js';
import { getRuntimeConfig } from './runtimeConfig.js';
import { evolutionService } from './EvolutionService.js';

type AgentJob = {
  clinicId: string;
  webhookId: string;
  phone: string;
  remoteJid?: string;
  text: string;
  messageType?: string;
  instance?: string;
  payload?: Record<string, unknown>;
};

type N8nResult = {
  replyText?: string;
  reply?: string;
  text?: string;
  output?: string;
  sendViaEvolution?: boolean;
  send?: boolean;
  message?: { text?: string };
};

const signatureFor = (body: string, secret?: string) => secret ? `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` : undefined;
const toBrazilianNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
};

const extractReplyText = (value: unknown): string => {
  const result = Array.isArray(value) ? value[0] : value;
  if (typeof result === 'string') return result.trim();
  if (!result || typeof result !== 'object') return '';
  const output = result as N8nResult & { body?: unknown; data?: unknown; result?: unknown };
  const direct = [output.replyText, output.reply, output.text, output.message?.text, typeof output.output === 'string' ? output.output : ''].find((item) => typeof item === 'string' && item.trim());
  if (direct) return direct.trim();
  return extractReplyText(output.body) || extractReplyText(output.data) || extractReplyText(output.result) || (typeof output.output === 'object' ? extractReplyText(output.output) : '');
};

const extractN8nResult = (value: unknown) => {
  const result = Array.isArray(value) ? value[0] : value;
  const replyText = extractReplyText(result);
  const output = result && typeof result === 'object' ? result as N8nResult : null;
  const hasExplicitSendFlag = Boolean(output && ('sendViaEvolution' in output || 'send' in output));
  return { replyText, sendViaEvolution: Boolean(replyText) && (!hasExplicitSendFlag || output?.sendViaEvolution === true || output?.send === true) };
};

export class AttendantAgentService {
  async process(job: AgentJob) {
    const config = await getRuntimeConfig();
    const clinic = await prisma.clinic.findUnique({ where: { id: job.clinicId } });
    if (!clinic) throw new Error('Clínica do agente não encontrada.');
    const aiConfig = clinic.aiConfig && typeof clinic.aiConfig === 'object' && !Array.isArray(clinic.aiConfig) ? clinic.aiConfig as { autoReply?: boolean } : {};
    if (aiConfig.autoReply === false) return { mode: 'manual', replySentByBackend: false, responseReceived: false };

    const sourceWebhook = await prisma.evolutionWebhook.findUnique({ where: { id: job.webhookId }, select: { patientId: true } });
    const patient = sourceWebhook?.patientId ? await prisma.patient.findUnique({ where: { id: sourceWebhook.patientId } }) : null;
    const history = await prisma.evolutionWebhook.findMany({
      where: { clinicId: job.clinicId, remoteJid: job.remoteJid || undefined },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { direction: true, messageText: true, createdAt: true },
    });
    const appointments = patient ? await prisma.appointment.findMany({
      where: { clinicId: job.clinicId, patientId: patient.id, startsAt: { gte: new Date() }, status: { not: 'CANCELED' } },
      orderBy: { startsAt: 'asc' },
      take: 5,
      include: { doctor: { select: { name: true, specialty: true } } },
    }) : [];
    const orderedHistory = [...history].reverse();
    const body = JSON.stringify({
      event: 'clinicflow.attendant.incoming',
      clinicId: job.clinicId,
      webhookId: job.webhookId,
      phone: job.phone,
      remoteJid: job.remoteJid,
      text: job.text,
      messageType: job.messageType || 'text',
      instance: job.instance || clinic.evolutionInstance || config.EVOLUTION_INSTANCE,
      agent: { name: 'ClinicFlow Atendente', version: '1.0', channel: 'whatsapp', instance: job.instance || clinic.evolutionInstance || config.EVOLUTION_INSTANCE },
      clinic: { id: clinic.id, name: clinic.name, timezone: clinic.timezone },
      patient: patient ? { id: patient.id, name: patient.name, phone: patient.phone, notes: patient.notes } : { phone: job.phone },
      message: { id: job.webhookId, type: job.messageType || 'text', text: job.text, phone: job.phone, remoteJid: job.remoteJid, source: job.payload },
      context: {
        history: orderedHistory.map((item) => ({ direction: item.direction, text: item.messageText, createdAt: item.createdAt })),
        appointments: appointments.map((item) => ({ startsAt: item.startsAt, status: item.status, doctor: item.doctor })),
      },
      capabilities: ['acolher', 'tirar_duvidas_operacionais', 'consultar_agenda', 'solicitar_agendamento', 'encaminhar_para_recepcao'],
      responseContract: { sendViaEvolution: 'retorne true somente se o backend deverá enviar replyText pela Evolution; caso contrário o n8n pode enviar diretamente.' },
    });

    if (config.N8N_AI_WEBHOOK_URL) {
      const response = await fetch(config.N8N_AI_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-clinicflow-event': 'clinicflow.attendant.incoming',
          ...(signatureFor(body, config.WEBHOOK_SHARED_SECRET) ? { 'x-clinicflow-signature': signatureFor(body, config.WEBHOOK_SHARED_SECRET)! } : {}),
        },
        body,
      });
      if (!response.ok) throw new Error(`n8n respondeu ${response.status}`);
      const raw = await response.text();
      let parsed: unknown = raw;
      try { parsed = raw ? JSON.parse(raw) : {}; } catch { /* resposta textual é válida */ }
      const result = extractN8nResult(parsed);
      if (result.sendViaEvolution && result.replyText) await this.sendReply({ ...job, text: result.replyText }, job.instance || clinic.evolutionInstance || config.EVOLUTION_INSTANCE || 'Nova');
      return { mode: 'n8n', replySentByBackend: result.sendViaEvolution && Boolean(result.replyText), responseReceived: true };
    }

    if (!config.OPENAI_API_KEY) throw new Error('Configure N8N_AI_WEBHOOK_URL ou OPENAI_API_KEY para ativar o agente.');
    const replyText = await assistantService.generateReply({
      patientName: patient?.name || 'Paciente',
      messageText: job.text,
      history: orderedHistory.map((item) => `${item.direction === 'RECEIVED' ? 'Paciente' : 'Atendente'}: ${item.messageText || ''}`),
      appointments: appointments.map((item) => `${item.startsAt.toISOString()} · ${item.doctor.name}`),
    });
    await this.sendReply({ ...job, text: replyText }, job.instance || clinic.evolutionInstance || config.EVOLUTION_INSTANCE || 'Nova');
    return { mode: 'openai-fallback', replySentByBackend: true };
  }

  private async sendReply(job: AgentJob, instance: string) {
    const sent = await evolutionService.sendText({ instance, number: toBrazilianNumber(job.remoteJid?.split('@')[0] || job.phone), text: job.text });
    await prisma.evolutionWebhook.create({ data: { clinicId: job.clinicId, patientId: (await prisma.evolutionWebhook.findUnique({ where: { id: job.webhookId }, select: { patientId: true } }))?.patientId || undefined, direction: 'SENT', event: 'AGENT_REPLY', instance, remoteJid: job.remoteJid, messageText: job.text, payload: { source: 'clinicflow-attendant-agent', evolution: sent } } });
  }
}

export const attendantAgentService = new AttendantAgentService();
