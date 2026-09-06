import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { enqueueIncomingMessage } from '../lib/queues.js';
import { env } from '../config/env.js';

type EvolutionRequest = FastifyRequest<{ Body: Record<string, any> }>;

const normalizePhone = (value: string) => value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
const messageTypeFrom = (data: any) => {
  if (data?.message?.audioMessage || String(data?.messageType || '').toLowerCase().includes('audio')) return 'audio';
  if (data?.message?.imageMessage || String(data?.messageType || '').toLowerCase().includes('image')) return 'image';
  if (data?.message?.videoMessage || String(data?.messageType || '').toLowerCase().includes('video')) return 'video';
  if (data?.message?.documentMessage || String(data?.messageType || '').toLowerCase().includes('document')) return 'document';
  return 'text';
};
const messageTextFrom = (data: any) => {
  const text = data?.message?.conversation ?? data?.message?.extendedTextMessage?.text ?? data?.message?.imageMessage?.caption ?? data?.message?.videoMessage?.caption ?? data?.message?.documentMessage?.caption;
  if (text) return text;
  const type = messageTypeFrom(data);
  return type === 'audio' ? '[Áudio recebido]' : type === 'image' ? '[Imagem recebida]' : type === 'document' ? '[Documento recebido]' : type === 'video' ? '[Vídeo recebido]' : '';
};
const mediaFrom = (data: any) => {
  const type = messageTypeFrom(data);
  if (type === 'text') return undefined;
  const message = data?.message ?? {};
  const source = message[`${type}Message`] ?? {};
  return {
    type,
    mimetype: source.mimetype ?? source.mimeType ?? message.mimetype ?? data?.mimetype,
    fileName: source.fileName ?? source.filename ?? source.file_name,
    caption: source.caption,
    base64: message.base64 ?? source.base64 ?? data?.base64,
    url: message.mediaUrl ?? source.url ?? source.mediaUrl ?? data?.mediaUrl,
  };
};

export class EvolutionWebhookController {
  async handle(request: EvolutionRequest, reply: FastifyReply) {
    const body = request.body ?? {};
    const data = body.data ?? body;
    const key = data.key ?? {};
    const remoteJid = String(key.remoteJid ?? '');
    if (key.fromMe === true || remoteJid.endsWith('@g.us') || !remoteJid) return reply.code(202).send({ ignored: true });
    const instance = body.instance ?? body.sender ?? env.EVOLUTION_INSTANCE;
    const clinicId = String(request.headers['x-clinic-id'] ?? body.clinicId ?? '');
    const clinic = clinicId
      ? await prisma.clinic.findFirst({ where: { id: clinicId } })
      : instance
        ? await prisma.clinic.findFirst({ where: { evolutionInstance: { equals: String(instance), mode: 'insensitive' } } })
        : null;
    if (!clinic) return reply.code(404).send({ error: 'Clínica não identificada.' });
    const phone = normalizePhone(remoteJid.split('@')[0]);
    if (!/^\d{10,15}$/.test(phone)) return reply.code(422).send({ error: 'Número de WhatsApp inválido.' });
    const messageType = messageTypeFrom(data);
    const text = String(messageTextFrom(data)).trim();
    if (!text && messageType === 'text') return reply.code(202).send({ ignored: true, reason: 'message-without-text' });

    if (key.id) {
      const duplicate = await prisma.evolutionWebhook.findFirst({ where: { clinicId: clinic.id, messageId: String(key.id) }, select: { id: true } });
      if (duplicate) return reply.code(202).send({ accepted: true, duplicate: true, webhookId: duplicate.id });
    }

    const patient = await prisma.patient.upsert({ where: { clinicId_phone: { clinicId: clinic.id, phone } }, update: { name: data.pushName || undefined }, create: { clinicId: clinic.id, phone, name: data.pushName || 'Paciente WhatsApp' } });
    const resolvedInstance = String(instance || clinic.evolutionInstance || env.EVOLUTION_INSTANCE || 'Nova');
    const webhook = await prisma.evolutionWebhook.create({ data: { clinicId: clinic.id, patientId: patient.id, direction: 'RECEIVED', event: String(body.event ?? 'MESSAGES_UPSERT'), instance: resolvedInstance, remoteJid, messageId: key.id ?? undefined, messageText: text, payload: body } });

    const quickReply = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const pending = await prisma.appointment.findFirst({ where: { clinicId: clinic.id, patientId: patient.id, status: 'PENDING_CONFIRMATION', startsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' } });
    if (pending && ['sim', 's', 'confirmo', 'confirmar'].includes(quickReply)) await prisma.appointment.update({ where: { id: pending.id }, data: { status: 'SCHEDULED' } });
    if (pending && ['nao', 'n', 'cancelar', 'cancela'].includes(quickReply)) await prisma.appointment.update({ where: { id: pending.id }, data: { status: 'CANCELED' } });

    await enqueueIncomingMessage({ clinicId: clinic.id, webhookId: webhook.id, phone, remoteJid, text, messageType, instance: resolvedInstance, payload: { ...body, clinicflowMedia: mediaFrom(data) } });
    await prisma.evolutionWebhook.update({ where: { id: webhook.id }, data: { processedAt: new Date() } });
    return reply.code(202).send({ accepted: true, webhookId: webhook.id, quickReplyHandled: Boolean(pending && ['sim', 's', 'confirmo', 'confirmar', 'nao', 'n', 'cancelar', 'cancela'].includes(quickReply)) });
  }
}

export const evolutionWebhookController = new EvolutionWebhookController();
