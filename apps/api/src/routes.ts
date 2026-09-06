import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { evolutionWebhookController } from './controllers/EvolutionWebhookController.js';
import { appointmentService } from './services/AppointmentService.js';
import { prisma } from './lib/prisma.js';
import { assistantService } from './services/AssistantService.js';
import { evolutionService } from './services/EvolutionService.js';
import { registerAdminRoutes } from './admin.js';
import { registerAuthRoutes } from './auth.js';
import { readUserToken } from './auth.js';
import { isMasterToken } from './admin.js';

const clinicId = (request: { headers: Record<string, any>; query?: any; body?: any }) => String(request.headers['x-clinic-id'] ?? request.query?.clinicId ?? request.body?.clinicId ?? '');

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', service: 'clinicflow-api' }));
  app.addHook('preHandler', async (request: any, reply: any) => {
    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/v1/') || path === '/api/v1/webhooks/evolution' || path === '/api/v1/appointments/available-slots' || path === '/api/v1/appointments/book' || path.startsWith('/api/v1/auth/') || path.startsWith('/api/v1/admin/')) return;
    const authorization = String(request.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (isMasterToken(token)) return;
    const user = readUserToken(token);
    if (!user) return reply.code(401).send({ error: 'Faça login para continuar.' });
    const suppliedClinicId = String(request.headers['x-clinic-id'] ?? request.query?.clinicId ?? request.body?.clinicId ?? '');
    if (suppliedClinicId && suppliedClinicId !== user.clinicId) return reply.code(403).send({ error: 'Usuário sem acesso a esta clínica.' });
    request.auth = user;
  });
  await registerAuthRoutes(app);
  app.post('/api/v1/webhooks/evolution', (request, reply) => evolutionWebhookController.handle(request as any, reply));
  app.get('/api/v1/patients', async (request, reply) => {
    const query = z.object({ clinicId: z.string().optional(), q: z.string().trim().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const id = clinicId({ headers: request.headers, query });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const search = query.q ? { contains: query.q, mode: 'insensitive' as const } : undefined;
    const patients = await prisma.patient.findMany({
      where: { clinicId: id, ...(query.q ? { OR: [{ name: search }, { phone: search }, { cpf: search }] } : {}) },
      include: { appointments: { orderBy: { startsAt: 'desc' }, take: 1, select: { startsAt: true, status: true } }, _count: { select: { records: true } } },
      orderBy: { updatedAt: 'desc' },
      take: query.limit,
    });
    return patients.map(({ appointments, _count, ...patient }) => ({ ...patient, lastAppointment: appointments[0] ?? null, recordsCount: _count.records }));
  });
  app.post('/api/v1/patients', async (request, reply) => {
    const body = z.object({ clinicId: z.string().optional(), name: z.string().trim().min(2), phone: z.string().trim().min(8), cpf: z.string().trim().optional(), birthDate: z.coerce.date().optional(), notes: z.string().trim().optional() }).parse(request.body);
    const id = clinicId({ headers: request.headers, body });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const phone = body.phone.replace(/\D/g, '');
    try {
      return await prisma.patient.upsert({ where: { clinicId_phone: { clinicId: id, phone } }, update: { name: body.name, cpf: body.cpf, birthDate: body.birthDate, notes: body.notes }, create: { clinicId: id, name: body.name, phone, cpf: body.cpf, birthDate: body.birthDate, notes: body.notes } });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Não foi possível cadastrar o paciente.' });
    }
  });
  app.get('/api/v1/patients/:id', async (request, reply) => {
    const query = z.object({ clinicId: z.string().optional() }).parse(request.query);
    const params = z.object({ id: z.string() }).parse(request.params);
    const id = clinicId({ headers: request.headers, query });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const patient = await prisma.patient.findFirst({ where: { id: params.id, clinicId: id }, include: { appointments: { include: { doctor: { select: { name: true, specialty: true } } }, orderBy: { startsAt: 'desc' }, take: 20 }, records: { include: { appointment: true, author: { select: { name: true } } }, orderBy: { createdAt: 'desc' } } } });
    if (!patient) return reply.code(404).send({ error: 'Paciente não encontrado.' });
    return patient;
  });
  app.patch('/api/v1/patients/:id', async (request, reply) => {
    const body = z.object({ clinicId: z.string().optional(), name: z.string().trim().min(2).optional(), phone: z.string().trim().min(8).optional(), cpf: z.string().trim().nullable().optional(), birthDate: z.coerce.date().nullable().optional(), notes: z.string().trim().nullable().optional() }).parse(request.body);
    const params = z.object({ id: z.string() }).parse(request.params);
    const id = clinicId({ headers: request.headers, body });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const patient = await prisma.patient.findFirst({ where: { id: params.id, clinicId: id } });
    if (!patient) return reply.code(404).send({ error: 'Paciente não encontrado.' });
    return prisma.patient.update({ where: { id: patient.id }, data: { ...body, clinicId: undefined, phone: body.phone ? body.phone.replace(/\D/g, '') : undefined } });
  });
  app.get('/api/v1/team', async (request, reply) => {
    const query = z.object({ clinicId: z.string().optional() }).parse(request.query);
    const id = clinicId({ headers: request.headers, query });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    return prisma.user.findMany({ where: { clinicId: id, active: true }, select: { id: true, name: true, email: true, role: true, specialty: true, professionalId: true, agendaConfig: true, schedules: { where: { active: true }, orderBy: { weekday: 'asc' } } }, orderBy: { name: 'asc' } });
  });
  app.get('/api/v1/appointments', async (request, reply) => {
    const query = z.object({ clinicId: z.string().optional(), date: z.coerce.date().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(request.query);
    const id = clinicId({ headers: request.headers, query });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const start = query.from ?? (query.date ? new Date(query.date) : new Date());
    if (!query.from) start.setHours(0, 0, 0, 0);
    const end = query.to ?? new Date(start);
    if (!query.to) end.setDate(end.getDate() + 1);
    return prisma.appointment.findMany({ where: { clinicId: id, startsAt: { gte: start, lt: end } }, include: { patient: true, doctor: { select: { name: true, specialty: true } }, room: true }, orderBy: { startsAt: 'asc' } });
  });
  app.patch('/api/v1/appointments/:id/status', async (request, reply) => {
    const body = z.object({ clinicId: z.string().optional(), status: z.enum(['PENDING_CONFIRMATION', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']) }).parse(request.body);
    const params = z.object({ id: z.string() }).parse(request.params);
    const id = clinicId({ headers: request.headers, body });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const appointment = await prisma.appointment.findFirst({ where: { id: params.id, clinicId: id } });
    if (!appointment) return reply.code(404).send({ error: 'Agendamento não encontrado.' });
    return prisma.appointment.update({ where: { id: appointment.id }, data: { status: body.status }, include: { patient: true, doctor: { select: { name: true, specialty: true } } } });
  });
  app.get('/api/v1/medical-records', async (request, reply) => {
    const query = z.object({ clinicId: z.string().optional(), patientId: z.string().optional() }).parse(request.query);
    const id = clinicId({ headers: request.headers, query });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    return prisma.medicalRecord.findMany({ where: { clinicId: id, ...(query.patientId ? { patientId: query.patientId } : {}) }, include: { patient: true, appointment: true, author: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
  });
  app.post('/api/v1/medical-records', async (request, reply) => {
    const body = z.object({ clinicId: z.string().optional(), patientId: z.string(), appointmentId: z.string(), authorId: z.string().optional(), anamnesis: z.string().trim().optional(), prescription: z.string().trim().optional(), transcriptionRaw: z.string().optional(), aiSummary: z.string().optional(), attachments: z.array(z.unknown()).optional() }).parse(request.body);
    const id = clinicId({ headers: request.headers, body });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const appointment = await prisma.appointment.findFirst({ where: { id: body.appointmentId, clinicId: id, patientId: body.patientId } });
    if (!appointment) return reply.code(404).send({ error: 'Agendamento não encontrado para este paciente.' });
    const recordData = { patientId: body.patientId, appointmentId: body.appointmentId, authorId: body.authorId, anamnesis: body.anamnesis, prescription: body.prescription, transcriptionRaw: body.transcriptionRaw, aiSummary: body.aiSummary, attachments: body.attachments as Prisma.InputJsonValue | undefined };
    return prisma.medicalRecord.upsert({ where: { appointmentId: body.appointmentId }, update: recordData, create: { ...recordData, clinicId: id, attachments: (body.attachments ?? []) as Prisma.InputJsonValue }, include: { patient: true, appointment: true, author: { select: { name: true } } } });
  });
  app.get('/api/v1/appointments/available-slots', async (request, reply) => {
    const query = z.object({ date: z.coerce.date(), doctorId: z.string().optional(), specialty: z.string().optional(), clinicId: z.string().optional() }).parse(request.query);
    const id = clinicId({ headers: request.headers, query });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    return { date: query.date.toISOString().slice(0, 10), slots: await appointmentService.listAvailableSlots({ clinicId: id, date: query.date, doctorId: query.doctorId, specialty: query.specialty }) };
  });
  app.post('/api/v1/appointments/book', async (request, reply) => {
    const body = z.object({ phone: z.string(), patientName: z.string().min(2), doctorId: z.string(), dateTime: z.coerce.date(), notes: z.string().optional(), clinicId: z.string().optional() }).parse(request.body);
    const id = clinicId({ headers: request.headers, body });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    try { return await appointmentService.book({ ...body, clinicId: id }); } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : 'Não foi possível reservar.' }); }
  });
  app.get('/api/v1/dashboard/summary', async (request, reply) => {
    const id = clinicId({ headers: request.headers, query: request.query });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
    const [appointments, waiting] = await Promise.all([
      prisma.appointment.findMany({ where: { clinicId: id, startsAt: { gte: start, lt: end } }, include: { patient: true, doctor: { select: { name: true, specialty: true } } }, orderBy: { startsAt: 'asc' } }),
      prisma.appointment.count({ where: { clinicId: id, startsAt: { gte: start, lt: end }, status: 'IN_PROGRESS' } }),
    ]);
    return { appointments, conversations: [], waiting };
  });
  app.get('/api/v1/conversations', async (request, reply) => {
    const query = z.object({ clinicId: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    const id = clinicId({ headers: request.headers, query });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const messages = await prisma.evolutionWebhook.findMany({ where: { clinicId: id }, include: { patient: true }, orderBy: { createdAt: 'desc' }, take: Math.max(query.limit * 4, 30) });
    const latestByPatient = new Map<string, (typeof messages)[number]>();
    for (const message of messages) {
      const key = message.patientId || message.remoteJid || message.id;
      if (!latestByPatient.has(key)) latestByPatient.set(key, message);
    }
    return Array.from(latestByPatient.values()).slice(0, query.limit);
  });
  app.post('/api/v1/conversations', async (request, reply) => {
    const body = z.object({ clinicId: z.string().optional(), phone: z.string().trim().min(8), patientName: z.string().trim().min(2), messageText: z.string().trim().min(1).max(4000) }).parse(request.body);
    const id = clinicId({ headers: request.headers, body });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) return reply.code(404).send({ error: 'Clínica não encontrada.' });
    const phone = body.phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (!/^\d{10,15}$/.test(phone)) return reply.code(422).send({ error: 'Número de WhatsApp inválido.' });
    const instance = clinic.evolutionInstance || process.env.EVOLUTION_INSTANCE || 'Nova';
    try {
      const delivery = await evolutionService.sendText({ instance, number: phone, text: body.messageText });
      const patient = await prisma.patient.upsert({ where: { clinicId_phone: { clinicId: id, phone } }, update: { name: body.patientName }, create: { clinicId: id, phone, name: body.patientName } });
      const message = await prisma.evolutionWebhook.create({ data: { clinicId: id, patientId: patient.id, direction: 'SENT', event: 'MESSAGES_UPSERT', instance, remoteJid: `${phone}@s.whatsapp.net`, messageText: body.messageText, payload: { delivery } }, include: { patient: true } });
      return message;
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.' });
    }
  });
  app.post('/api/v1/assistant/suggest-reply', async (request, reply) => {
    const body = z.object({ patientName: z.string().min(1), messageText: z.string().min(1) }).parse(request.body);
    try {
      return { suggestion: await assistantService.suggestReply(body) };
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : 'Não foi possível gerar uma sugestão.' });
    }
  });
  app.get('/api/v1/integrations/evolution/status', async (_request, reply) => {
    try { return await evolutionService.getStatus(); } catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : 'Não foi possível consultar a Evolution.' }); }
  });
  app.get('/api/v1/settings/ai', async (request, reply) => {
    const query = z.object({ clinicId: z.string().optional() }).parse(request.query);
    const id = clinicId({ headers: request.headers, query });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const clinic = await prisma.clinic.findUnique({ where: { id }, select: { aiConfig: true } });
    if (!clinic) return reply.code(404).send({ error: 'Clínica não encontrada.' });
    const config = clinic.aiConfig && typeof clinic.aiConfig === 'object' && !Array.isArray(clinic.aiConfig) ? clinic.aiConfig as Record<string, unknown> : {};
    return { enabled: config.autoReply !== false };
  });
  app.patch('/api/v1/settings/ai', async (request, reply) => {
    const body = z.object({ clinicId: z.string().optional(), enabled: z.boolean() }).parse(request.body);
    const id = clinicId({ headers: request.headers, body });
    if (!id) return reply.code(400).send({ error: 'clinicId é obrigatório.' });
    const clinic = await prisma.clinic.findUnique({ where: { id }, select: { aiConfig: true } });
    if (!clinic) return reply.code(404).send({ error: 'Clínica não encontrada.' });
    const current = clinic.aiConfig && typeof clinic.aiConfig === 'object' && !Array.isArray(clinic.aiConfig) ? clinic.aiConfig as Record<string, unknown> : {};
    await prisma.clinic.update({ where: { id }, data: { aiConfig: { ...current, autoReply: body.enabled } as Prisma.InputJsonValue } });
    return { enabled: body.enabled };
  });
  await registerAdminRoutes(app);
}
