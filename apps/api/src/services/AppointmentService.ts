import { AppointmentStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

type SlotRequest = { clinicId: string; date: Date; doctorId?: string; specialty?: string };
type BookRequest = { clinicId: string; phone: string; patientName: string; doctorId: string; dateTime: Date; notes?: string };

const atTime = (date: Date, value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
};

const overlaps = (start: Date, end: Date, appointments: { startsAt: Date; endsAt: Date }[]) =>
  appointments.some((appointment) => appointment.startsAt < end && appointment.endsAt > start);

export class AppointmentService {
  async listAvailableSlots({ clinicId, date, doctorId, specialty }: SlotRequest) {
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const weekday = dayStart.getDay();
    const holiday = await prisma.clinicHoliday.findFirst({ where: { clinicId, date: dayStart } });
    if (holiday) return [];

    const doctors = await prisma.user.findMany({
      where: { clinicId, role: 'DOCTOR', active: true, ...(doctorId ? { id: doctorId } : {}), ...(specialty ? { specialty: { equals: specialty, mode: 'insensitive' } } : {}) },
      include: { schedules: { where: { weekday, active: true } }, appointments: { where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart }, status: { not: AppointmentStatus.CANCELED } }, select: { startsAt: true, endsAt: true } } },
    });

    return doctors.flatMap((doctor) => {
      const schedule = doctor.schedules[0];
      if (!schedule) return [];
      const slots: { doctorId: string; doctorName: string; startsAt: string; endsAt: string }[] = [];
      const slotMinutes = schedule.slotMinutes || 30;
      for (let cursor = atTime(dayStart, schedule.startsAt); cursor < atTime(dayStart, schedule.endsAt); cursor = new Date(cursor.getTime() + slotMinutes * 60000)) {
        const end = new Date(cursor.getTime() + slotMinutes * 60000);
        const inBreak = schedule.breakFrom && schedule.breakTo && cursor < atTime(dayStart, schedule.breakTo) && end > atTime(dayStart, schedule.breakFrom);
        if (end <= atTime(dayStart, schedule.endsAt) && !inBreak && !overlaps(cursor, end, doctor.appointments)) {
          slots.push({ doctorId: doctor.id, doctorName: doctor.name, startsAt: cursor.toISOString(), endsAt: end.toISOString() });
        }
      }
      return slots;
    });
  }

  async book({ clinicId, phone, patientName, doctorId, dateTime, notes }: BookRequest) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${clinicId}:${doctorId}:${dateTime.toISOString().slice(0, 10)}`}))`;
      const doctor = await tx.user.findFirst({ where: { id: doctorId, clinicId, role: 'DOCTOR', active: true } });
      if (!doctor) throw new Error('Médico não encontrado ou inativo.');
      const schedule = await tx.userSchedule.findFirst({ where: { userId: doctorId, weekday: dateTime.getDay(), active: true } });
      if (!schedule) throw new Error('Médico não possui agenda configurada para este dia.');
      const duration = schedule.slotMinutes || 30;
      const endsAt = new Date(dateTime.getTime() + duration * 60000);
      const conflict = await tx.appointment.findFirst({ where: { clinicId, doctorId, startsAt: { lt: endsAt }, endsAt: { gt: dateTime }, status: { not: AppointmentStatus.CANCELED } } });
      if (conflict) throw new Error('Este horário acabou de ser reservado.');
      const patient = await tx.patient.upsert({ where: { clinicId_phone: { clinicId, phone } }, update: { name: patientName }, create: { clinicId, phone, name: patientName } });
      return tx.appointment.create({ data: { clinicId, patientId: patient.id, doctorId, startsAt: dateTime, endsAt, notes, status: AppointmentStatus.PENDING_CONFIRMATION }, include: { patient: true, doctor: { select: { name: true, specialty: true } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export const appointmentService = new AppointmentService();
