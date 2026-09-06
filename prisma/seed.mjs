import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: new URL('../.env', import.meta.url) });

const prisma = new PrismaClient();
const todayAt = (hour, minute) => { const date = new Date(); date.setHours(hour, minute, 0, 0); return date; };

try {
  const clinic = await prisma.clinic.upsert({ where: { id: 'clinicflow-demo' }, update: { name: 'Clínica ClinicFlow', evolutionInstance: process.env.EVOLUTION_INSTANCE || 'Nova' }, create: { id: 'clinicflow-demo', name: 'Clínica ClinicFlow', slug: 'clinicflow-demo', evolutionInstance: process.env.EVOLUTION_INSTANCE || 'Nova' } });
  const helena = await prisma.user.upsert({ where: { id: 'doctor-helena' }, update: { name: 'Dra. Helena Martins', specialty: 'Cardiologia', active: true }, create: { id: 'doctor-helena', clinicId: clinic.id, name: 'Dra. Helena Martins', email: 'helena@clinicflow.local', passwordHash: 'local-seed-only', role: 'DOCTOR', specialty: 'Cardiologia' } });
  const caio = await prisma.user.upsert({ where: { id: 'doctor-caio' }, update: { name: 'Dr. Caio Nunes', specialty: 'Ortopedia', active: true }, create: { id: 'doctor-caio', clinicId: clinic.id, name: 'Dr. Caio Nunes', email: 'caio@clinicflow.local', passwordHash: 'local-seed-only', role: 'DOCTOR', specialty: 'Ortopedia' } });
  for (const user of [helena, caio]) for (let weekday = 1; weekday <= 5; weekday += 1) await prisma.userSchedule.upsert({ where: { userId_weekday: { userId: user.id, weekday } }, update: { startsAt: '08:00', endsAt: '18:00', breakFrom: '12:00', breakTo: '13:00', slotMinutes: 30, active: true }, create: { userId: user.id, weekday, startsAt: '08:00', endsAt: '18:00', breakFrom: '12:00', breakTo: '13:00', slotMinutes: 30 } });
  const marina = await prisma.patient.upsert({ where: { clinicId_phone: { clinicId: clinic.id, phone: '11998421204' } }, update: { name: 'Marina Azevedo' }, create: { clinicId: clinic.id, name: 'Marina Azevedo', phone: '11998421204', notes: 'Paciente de demonstração' } });
  const rafael = await prisma.patient.upsert({ where: { clinicId_phone: { clinicId: clinic.id, phone: '11991027781' } }, update: { name: 'Rafael Gomes' }, create: { clinicId: clinic.id, name: 'Rafael Gomes', phone: '11991027781', notes: 'Paciente de demonstração' } });
  const beatriz = await prisma.patient.upsert({ where: { clinicId_phone: { clinicId: clinic.id, phone: '11987654321' } }, update: { name: 'Beatriz Sampaio' }, create: { clinicId: clinic.id, name: 'Beatriz Sampaio', phone: '11987654321' } });
  await prisma.appointment.upsert({ where: { id: 'appointment-marina-demo' }, update: { startsAt: todayAt(8, 30), endsAt: todayAt(9, 0), status: 'SCHEDULED' }, create: { id: 'appointment-marina-demo', clinicId: clinic.id, patientId: marina.id, doctorId: helena.id, startsAt: todayAt(8, 30), endsAt: todayAt(9, 0), status: 'SCHEDULED' } });
  await prisma.appointment.upsert({ where: { id: 'appointment-rafael-demo' }, update: { startsAt: todayAt(9, 15), endsAt: todayAt(9, 45), status: 'IN_PROGRESS' }, create: { id: 'appointment-rafael-demo', clinicId: clinic.id, patientId: rafael.id, doctorId: caio.id, startsAt: todayAt(9, 15), endsAt: todayAt(9, 45), status: 'IN_PROGRESS' } });
  await prisma.appointment.upsert({ where: { id: 'appointment-beatriz-demo' }, update: { startsAt: todayAt(10, 0), endsAt: todayAt(10, 30), status: 'PENDING_CONFIRMATION' }, create: { id: 'appointment-beatriz-demo', clinicId: clinic.id, patientId: beatriz.id, doctorId: helena.id, startsAt: todayAt(10, 0), endsAt: todayAt(10, 30), status: 'PENDING_CONFIRMATION' } });
  console.log(`Seed concluído: clinicId=${clinic.id}`);
} catch (error) { console.error(error); process.exitCode = 1; } finally { await prisma.$disconnect(); }
