import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { enqueueIncomingMessage } from '../lib/queues.js';

type EvolutionRequest = FastifyRequest<{ Body: Record<string, any> }>;

const normalizePhone = (value: string) => value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
const messageTextFrom = (data: any) => data?.message?.conversation ?? data?.message?.extendedTextMessage?.text ?? data?.message?.imageMessage?.caption ?? '';

export class EvolutionWebhookController {
  async handle(request: EvolutionRequest, reply: FastifyReply) {
    const body = request.body ?? {};
    const data = body.data ?? body;
    const key = data.key ?? {};
    const remoteJid = String(key.remoteJid ?? '');
    if (key.fromMe === true || remoteJid.endsWith('@g.us') || !remoteJid) return reply.code(202).send({ ignored: true });
    const instance = body.instance ?? body.sender ?? null;
    const clinicId = String(request.headers['x-clinic-id'] ?? body.clinicId ?? '');
    const clinic = clinicId
      ? await prisma.clinic.findFirst({ where: { id: clinicId } })
      : instance
        ? await prisma.clinic.findFirst({ where: { evolutionInstance: String(instance) } })
        : null;
    if (!clinic) return reply.code(404).send({ error: 'Clínica não identificada.' });
    const phone = normalizePhone(remoteJid.split('@')[0]);
    if (!/^\d{10,15}$/.test(phone)) return reply.code(422).send({ error: 'Número de WhatsApp inválido.' });
    const text = String(messageTextFrom(data)).trim();
    if (!text) return reply.code(202).send({ ignored: true, reason: 'message-without-text' });

    if (key.id) {
      const duplicate = await prisma.evolutionWebhook.findFirst({ where: { clinicId: clinic.id, messageId: String(key.id) }, select: { id: true } });
      if (duplicate) return reply.code(202).send({ accepted: true, duplicate: true, webhookId: duplicate.id });
    }

    const patient = await prisma.patient.upsert({ where: { clinicId_phone: { clinicId: clinic.id, phone } }, update: { name: data.pushName || undefined }, create: { clinicId: clinic.id, phone, name: data.pushName || 'Paciente WhatsApp' } });
    const webhook = await prisma.evolutionWebhook.create({ data: { clinicId: clinic.id, patientId: patient.id, direction: 'RECEIVED', event: String(body.event ?? 'MESSAGES_UPSERT'), instance, remoteJid, messageId: key.id ?? undefined, messageText: text, payload: body } });

    const quickReply = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const pending = await prisma.appointment.findFirst({ where: { clinicId: clinic.id, patientId: patient.id, status: 'PENDING_CONFIRMATION', startsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' } });
    if (pending && ['sim', 's', 'confirmo', 'confirmar'].includes(quickReply)) await prisma.appointment.update({ where: { id: pending.id }, data: { status: 'SCHEDULED' } });
    if (pending && ['nao', 'n', 'cancelar', 'cancela'].includes(quickReply)) await prisma.appointment.update({ where: { id: pending.id }, data: { status: 'CANCELED' } });

    await enqueueIncomingMessage({ clinicId: clinic.id, webhookId: webhook.id, phone, text });
    await prisma.evolutionWebhook.update({ where: { id: webhook.id }, data: { processedAt: new Date() } });
    return reply.code(202).send({ accepted: true, webhookId: webhook.id, quickReplyHandled: Boolean(pending && ['sim', 's', 'confirmo', 'confirmar', 'nao', 'n', 'cancelar', 'cancela'].includes(quickReply)) });
  }
}

export const evolutionWebhookController = new EvolutionWebhookController();
