import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evolutionWebhookController } from './controllers/EvolutionWebhookController.js';
import { appointmentService } from './services/AppointmentService.js';
import { prisma } from './lib/prisma.js';

const clinicId = (request: { headers: Record<string, any>; query?: any; body?: any }) => String(request.headers['x-clinic-id'] ?? request.query?.clinicId ?? request.body?.clinicId ?? '');

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', service: 'clinicflow-api' }));
  app.post('/api/v1/webhooks/evolution', (request, reply) => evolutionWebhookController.handle(request as any, reply));
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
    const [appointments, conversations, waiting] = await Promise.all([
      prisma.appointment.findMany({ where: { clinicId: id, startsAt: { gte: start, lt: end } }, include: { patient: true, doctor: { select: { name: true, specialty: true } } }, orderBy: { startsAt: 'asc' } }),
      prisma.evolutionWebhook.findMany({ where: { clinicId: id, direction: 'RECEIVED', createdAt: { gte: start } }, include: { patient: true }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.appointment.count({ where: { clinicId: id, startsAt: { gte: start, lt: end }, status: 'IN_PROGRESS' } }),
    ]);
    return { appointments, conversations, waiting };
  });
}
