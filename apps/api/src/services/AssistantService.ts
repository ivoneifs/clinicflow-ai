import OpenAI from 'openai';
import { env } from '../config/env.js';
import { getRuntimeConfig } from './runtimeConfig.js';

const systemPrompt = `Você é a assistente de atendimento da ClinicFlow, uma clínica brasileira.
Gere respostas curtas, acolhedoras e objetivas em português do Brasil.
Nunca invente horários, preços, diagnósticos ou orientações médicas.
Quando a mensagem pedir algo que depende da equipe, diga que vai encaminhar para a recepção.
Entregue somente a sugestão de mensagem, sem aspas e sem explicações.`;

export class AssistantService {
  async generateReply({ patientName, messageText, history = [], appointments = [] }: { patientName: string; messageText: string; history?: string[]; appointments?: string[] }) {
    const config = await getRuntimeConfig();
    if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada.');
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: env.OPENAI_MODEL,
      store: false,
      instructions: systemPrompt,
      input: `Paciente: ${patientName}\nHistórico recente:\n${history.join('\n') || 'Sem histórico'}\nPróximos agendamentos:\n${appointments.join('\n') || 'Nenhum agendamento confirmado'}\nMensagem recebida: ${messageText}\n\nEscreva a melhor resposta para enviar:`,
    });
    return response.output_text.trim();
  }

  async suggestReply({ patientName, messageText }: { patientName: string; messageText: string }) {
    return this.generateReply({ patientName, messageText });
  }
}

export const assistantService = new AssistantService();
