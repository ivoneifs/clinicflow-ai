import { createCipheriv, createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from './lib/prisma.js';
import { decryptSetting } from './services/runtimeConfig.js';
import { hashUserPassword } from './auth.js';

const tokenTtlSeconds = 8 * 60 * 60;
const adminConfig = () => ({ email: process.env.MASTER_ADMIN_EMAIL?.trim().toLowerCase(), password: process.env.MASTER_ADMIN_PASSWORD, secret: process.env.MASTER_ADMIN_TOKEN_SECRET || process.env.MASTER_ADMIN_PASSWORD });
const scrypt = promisify(scryptCallback);
const sign = (value: string, secret: string) => createHmac('sha256', secret).update(value).digest('base64url');
const safeEqual = (a: string, b: string) => { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
const hashPassword = async (password: string) => { const salt = randomBytes(16).toString('hex'); const derived = await scrypt(password, salt, 64) as Buffer; return `scrypt:${salt}:${derived.toString('hex')}`; };
const verifyPassword = async (password: string, encoded: string) => { const [, salt, digest] = encoded.split(':'); if (!salt || !digest) return false; const derived = await scrypt(password, salt, 64) as Buffer; return safeEqual(derived.toString('hex'), digest); };
const integrationKeys = ['OPENAI_API_KEY', 'EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE', 'N8N_AI_WEBHOOK_URL', 'WEBHOOK_SHARED_SECRET'] as const;
const encryptSetting = (value: string) => { const iv = randomBytes(12); const secret = createHash('sha256').update(adminConfig().secret || 'clinicflow-runtime-config').digest(); const cipher = createCipheriv('aes-256-gcm', secret, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`; };

async function getMasterCredential() {
  const existing = await prisma.masterCredential.findUnique({ where: { id: 'primary' } });
  if (existing) return existing;
  const config = adminConfig();
  if (!config.email || !config.password) return null;
  const passwordHash = await hashPassword(config.password);
  try { return await prisma.masterCredential.create({ data: { id: 'primary', email: config.email, passwordHash } }); } catch { return prisma.masterCredential.findUnique({ where: { id: 'primary' } }); }
}

export function createMasterToken(email: string) {
  const config = adminConfig();
  if (!config.secret) throw new Error('MASTER_ADMIN_PASSWORD não configurada.');
  const payload = Buffer.from(JSON.stringify({ sub: email, role: 'MASTER', exp: Math.floor(Date.now() / 1000) + tokenTtlSeconds })).toString('base64url');
  return `${payload}.${sign(payload, config.secret)}`;
}

export function isMasterToken(value: unknown) {
  if (typeof value !== 'string') return false;
  const config = adminConfig();
  if (!config.secret) return false;
  const [payload, signature] = value.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload, config.secret))) return false;
  try { const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: string; exp?: number }; return decoded.role === 'MASTER' && typeof decoded.exp === 'number' && decoded.exp > Math.floor(Date.now() / 1000); } catch { return false; }
}

function requireMaster(request: any, reply: any) {
  const authorization = String(request.headers.authorization || '');
  if (!isMasterToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined)) { reply.code(401).send({ error: 'Credencial MASTER inválida ou expirada.' }); return false; }
  return true;
}

const clinicInput = z.object({ name: z.string().trim().min(2), slug: z.string().trim().min(2).regex(/^[a-z0-9-]+$/), timezone: z.string().trim().min(2).default('America/Sao_Paulo'), evolutionApiUrl: z.string().url().optional().or(z.literal('')), evolutionApiKey: z.string().optional(), evolutionInstance: z.string().trim().optional() });
const patientInput = z.object({ clinicId: z.string().min(1), name: z.string().trim().min(2), phone: z.string().trim().min(8), cpf: z.string().trim().optional().or(z.literal('')), birthDate: z.coerce.date().optional(), notes: z.string().trim().optional().or(z.literal('')) });
const userInput = z.object({ clinicId: z.string().min(1), name: z.string().trim().min(2), email: z.string().email(), role: z.enum(['ADMIN', 'DOCTOR', 'ATTENDANT']), specialty: z.string().trim().optional().or(z.literal('')), active: z.boolean().default(true), password: z.string().min(12).optional().or(z.literal('')) });
const appointmentInput = z.object({ clinicId: z.string().min(1), patientId: z.string().min(1), doctorId: z.string().min(1), startsAt: z.coerce.date(), endsAt: z.coerce.date().optional(), status: z.enum(['PENDING_CONFIRMATION', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']).default('SCHEDULED'), notes: z.string().trim().optional().or(z.literal('')) });

const clinicView = (clinic: any) => ({ ...clinic, evolutionApiKey: undefined, evolutionApiKeySet: Boolean(clinic.evolutionApiKey) });

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post('/api/v1/admin/login', async (request, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(request.body);
    const credential = await getMasterCredential();
    if (!credential) return reply.code(503).send({ error: 'Credencial MASTER ainda não configurada no ambiente.' });
    if (body.email.trim().toLowerCase() !== credential.email || !(await verifyPassword(body.password, credential.passwordHash))) return reply.code(401).send({ error: 'E-mail ou senha MASTER inválidos.' });
    return { token: createMasterToken(credential.email), user: { email: credential.email, role: 'MASTER' }, expiresIn: tokenTtlSeconds };
  });
  app.get('/api/v1/admin/me', async (request, reply) => { if (!requireMaster(request, reply)) return; return { role: 'MASTER' }; });
  app.patch('/api/v1/admin/credentials', async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const body = z.object({ currentPassword: z.string().min(1), email: z.string().email(), newPassword: z.string().min(12) }).parse(request.body);
    const credential = await getMasterCredential();
    if (!credential || !(await verifyPassword(body.currentPassword, credential.passwordHash))) return reply.code(401).send({ error: 'Senha MASTER atual inválida.' });
    const updated = await prisma.masterCredential.update({ where: { id: 'primary' }, data: { email: body.email.trim().toLowerCase(), passwordHash: await hashPassword(body.newPassword), tokenVersion: { increment: 1 } } });
    return { ok: true, email: updated.email, message: 'Credencial MASTER atualizada. Faça login novamente.' };
  });
  app.get('/api/v1/admin/integrations', async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const stored = await prisma.systemSetting.findMany({ where: { key: { in: [...integrationKeys] } } });
    const storedMap = new Map(stored.map((item) => [item.key, decryptSetting(item.value)]));
    return Object.fromEntries(integrationKeys.map((key) => { const value = storedMap.get(key) || process.env[key] || ''; return [key, { configured: Boolean(value), masked: value ? `${value.slice(0, 3)}••••${value.slice(-4)}` : '' }]; }));
  });
  app.patch('/api/v1/admin/integrations', async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const body = z.object({ OPENAI_API_KEY: z.string().optional(), EVOLUTION_API_URL: z.string().url().optional().or(z.literal('')), EVOLUTION_API_KEY: z.string().optional(), EVOLUTION_INSTANCE: z.string().optional(), N8N_AI_WEBHOOK_URL: z.string().url().optional().or(z.literal('')), WEBHOOK_SHARED_SECRET: z.string().optional() }).parse(request.body);
    for (const key of integrationKeys) if (body[key]) await prisma.systemSetting.upsert({ where: { key }, update: { value: encryptSetting(body[key] as string) }, create: { key, value: encryptSetting(body[key] as string) } });
    return { ok: true, message: 'Integrações atualizadas com segurança.' };
  });
  app.get('/api/v1/admin/summary', async (request, reply) => {
    if (!requireMaster(request, reply)) return;
    const [clinics, users, patients, appointments, records, conversations, recentAppointments] = await Promise.all([
      prisma.clinic.count(), prisma.user.count({ where: { active: true } }), prisma.patient.count(), prisma.appointment.count(), prisma.medicalRecord.count(), prisma.evolutionWebhook.count({ where: { direction: 'RECEIVED' } }),
      prisma.appointment.findMany({ take: 8, orderBy: { startsAt: 'desc' }, include: { clinic: { select: { name: true } }, patient: { select: { name: true } }, doctor: { select: { name: true } } } }),
    ]);
    return { counts: { clinics, users, patients, appointments, records, conversations }, recentAppointments };
  });
  app.get('/api/v1/admin/clinics', async (request, reply) => { if (!requireMaster(request, reply)) return; return (await prisma.clinic.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { users: true, patients: true, appointments: true } } } })).map(clinicView); });
  app.post('/api/v1/admin/clinics', async (request, reply) => { if (!requireMaster(request, reply)) return; const body = clinicInput.parse(request.body); try { return clinicView(await prisma.clinic.create({ data: { ...body, evolutionApiUrl: body.evolutionApiUrl || null, evolutionApiKey: body.evolutionApiKey || null, evolutionInstance: body.evolutionInstance || null } })); } catch { return reply.code(409).send({ error: 'Slug da clínica já está em uso.' }); } });
  app.patch('/api/v1/admin/clinics/:id', async (request, reply) => { if (!requireMaster(request, reply)) return; const body = clinicInput.partial().parse(request.body); const params = z.object({ id: z.string() }).parse(request.params); try { return clinicView(await prisma.clinic.update({ where: { id: params.id }, data: { ...body, evolutionApiUrl: body.evolutionApiUrl === '' ? null : body.evolutionApiUrl, evolutionApiKey: body.evolutionApiKey === '' ? null : body.evolutionApiKey } })); } catch { return reply.code(404).send({ error: 'Clínica não encontrada.' }); } });
  app.delete('/api/v1/admin/clinics/:id', async (request, reply) => { if (!requireMaster(request, reply)) return; const params = z.object({ id: z.string() }).parse(request.params); try { await prisma.clinic.delete({ where: { id: params.id } }); return { ok: true }; } catch { return reply.code(409).send({ error: 'Não foi possível remover a clínica. Verifique os vínculos.' }); } });
  app.get('/api/v1/admin/patients', async (request, reply) => { if (!requireMaster(request, reply)) return; const query = z.object({ clinicId: z.string().optional(), q: z.string().trim().optional() }).parse(request.query); return prisma.patient.findMany({ where: { ...(query.clinicId ? { clinicId: query.clinicId } : {}), ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { phone: { contains: query.q } }] } : {}) }, include: { clinic: { select: { name: true } }, _count: { select: { appointments: true, records: true } } }, orderBy: { updatedAt: 'desc' }, take: 200 }); });
  app.post('/api/v1/admin/patients', async (request, reply) => { if (!requireMaster(request, reply)) return; const body = patientInput.parse(request.body); try { return await prisma.patient.create({ data: { ...body, phone: body.phone.replace(/\D/g, ''), cpf: body.cpf || null, notes: body.notes || null } }); } catch { return reply.code(409).send({ error: 'Paciente já existe ou os dados são inválidos.' }); } });
  app.patch('/api/v1/admin/patients/:id', async (request, reply) => { if (!requireMaster(request, reply)) return; const body = patientInput.partial().omit({ clinicId: true }).parse(request.body); const params = z.object({ id: z.string() }).parse(request.params); try { return await prisma.patient.update({ where: { id: params.id }, data: { ...body, phone: body.phone?.replace(/\D/g, ''), cpf: body.cpf === '' ? null : body.cpf, notes: body.notes === '' ? null : body.notes } }); } catch { return reply.code(404).send({ error: 'Paciente não encontrado.' }); } });
  app.delete('/api/v1/admin/patients/:id', async (request, reply) => { if (!requireMaster(request, reply)) return; const params = z.object({ id: z.string() }).parse(request.params); try { await prisma.patient.delete({ where: { id: params.id } }); return { ok: true }; } catch { return reply.code(409).send({ error: 'Paciente possui vínculos e não pode ser removido.' }); } });
  app.get('/api/v1/admin/users', async (request, reply) => { if (!requireMaster(request, reply)) return; const query = z.object({ clinicId: z.string().optional() }).parse(request.query); return prisma.user.findMany({ where: query.clinicId ? { clinicId: query.clinicId } : {}, select: { id: true, clinicId: true, name: true, email: true, role: true, specialty: true, active: true, createdAt: true, clinic: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); });
  app.post('/api/v1/admin/users', async (request, reply) => { if (!requireMaster(request, reply)) return; const body = userInput.parse(request.body); if (!body.password) return reply.code(400).send({ error: 'Defina uma senha de pelo menos 12 caracteres para o profissional.' }); const name = body.name.trim(); const email = body.email.trim().toLowerCase(); try { return await prisma.user.create({ data: { clinicId: body.clinicId, name, email, role: body.role, active: body.active, specialty: body.specialty?.trim() || null, passwordHash: await hashUserPassword(body.password) }, select: { id: true, clinicId: true, name: true, email: true, role: true, specialty: true, active: true } }); } catch { return reply.code(409).send({ error: 'E-mail já está em uso nesta clínica.' }); } });
  app.patch('/api/v1/admin/users/:id', async (request, reply) => { if (!requireMaster(request, reply)) return; const body = userInput.partial().omit({ clinicId: true }).parse(request.body); const params = z.object({ id: z.string() }).parse(request.params); try { const data = { ...(body.name !== undefined ? { name: body.name.trim() } : {}), ...(body.email !== undefined ? { email: body.email.trim().toLowerCase() } : {}), ...(body.role !== undefined ? { role: body.role } : {}), ...(body.active !== undefined ? { active: body.active } : {}), ...(body.specialty !== undefined ? { specialty: body.specialty.trim() || null } : {}), ...(body.password ? { passwordHash: await hashUserPassword(body.password) } : {}) }; return await prisma.user.update({ where: { id: params.id }, data, select: { id: true, clinicId: true, name: true, email: true, role: true, specialty: true, active: true } }); } catch { return reply.code(404).send({ error: 'Profissional não encontrado.' }); } });
  app.delete('/api/v1/admin/users/:id', async (request, reply) => { if (!requireMaster(request, reply)) return; const params = z.object({ id: z.string() }).parse(request.params); try { return await prisma.user.update({ where: { id: params.id }, data: { active: false }, select: { id: true, active: true } }); } catch { return reply.code(404).send({ error: 'Profissional não encontrado.' }); } });
  app.get('/api/v1/admin/appointments', async (request, reply) => { if (!requireMaster(request, reply)) return; const query = z.object({ clinicId: z.string().optional(), status: z.string().optional() }).parse(request.query); return prisma.appointment.findMany({ where: { ...(query.clinicId ? { clinicId: query.clinicId } : {}), ...(query.status ? { status: query.status as any } : {}) }, include: { clinic: { select: { name: true } }, patient: { select: { name: true, phone: true } }, doctor: { select: { name: true } } }, orderBy: { startsAt: 'desc' }, take: 200 }); });
  app.post('/api/v1/admin/appointments', async (request, reply) => { if (!requireMaster(request, reply)) return; const body = appointmentInput.parse(request.body); try { return await prisma.appointment.create({ data: { ...body, endsAt: body.endsAt || new Date(body.startsAt.getTime() + 30 * 60000), notes: body.notes || null } }); } catch { return reply.code(409).send({ error: 'Não foi possível criar o agendamento.' }); } });
  app.patch('/api/v1/admin/appointments/:id', async (request, reply) => { if (!requireMaster(request, reply)) return; const body = appointmentInput.partial().omit({ clinicId: true }).parse(request.body); const params = z.object({ id: z.string() }).parse(request.params); try { return await prisma.appointment.update({ where: { id: params.id }, data: { ...body, notes: body.notes === '' ? null : body.notes } }); } catch { return reply.code(404).send({ error: 'Agendamento não encontrado.' }); } });
  app.delete('/api/v1/admin/appointments/:id', async (request, reply) => { if (!requireMaster(request, reply)) return; const params = z.object({ id: z.string() }).parse(request.params); try { await prisma.appointment.delete({ where: { id: params.id } }); return { ok: true }; } catch { return reply.code(409).send({ error: 'Agendamento possui prontuário vinculado.' }); } });
  app.get('/api/v1/admin/records', async (request, reply) => { if (!requireMaster(request, reply)) return; return prisma.medicalRecord.findMany({ include: { clinic: { select: { name: true } }, patient: { select: { name: true } }, author: { select: { name: true } }, appointment: { select: { startsAt: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); });
}
