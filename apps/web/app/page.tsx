'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Bell, CalendarDays, Check, ChevronDown, Clock3, FileText, LayoutDashboard, MessageCircle, MoreHorizontal, Plus, Search, Settings2, Sparkles, Stethoscope, Users, Video } from 'lucide-react';

type AppointmentStatus = 'PENDING_CONFIRMATION' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
type Appointment = { id: string; startsAt: string; patient: { name: string }; doctor: { name: string; specialty: string | null }; status: AppointmentStatus };
type Conversation = { id: string; patient: { name: string } | null; messageText: string | null; createdAt: string };
type DashboardData = { appointments: Appointment[]; conversations: Conversation[]; waiting: number };
type PatientSummary = { id?: string; name: string; phone: string; lastVisit: string; recordsCount?: number };
type TeamMember = { id: string; name: string; specialty: string | null; role: string };
type IntegrationStatus = { instance: string; status: string; connected: boolean };

const fallbackAppointments: Appointment[] = [
  { id: 'fallback-1', startsAt: '2026-09-04T08:30:00-03:00', patient: { name: 'Marina Azevedo' }, doctor: { name: 'Dra. Helena Martins', specialty: 'Cardiologia' }, status: 'SCHEDULED' },
  { id: 'fallback-2', startsAt: '2026-09-04T09:15:00-03:00', patient: { name: 'Rafael Gomes' }, doctor: { name: 'Dr. Caio Nunes', specialty: 'Ortopedia' }, status: 'IN_PROGRESS' },
  { id: 'fallback-3', startsAt: '2026-09-04T10:00:00-03:00', patient: { name: 'Beatriz Sampaio' }, doctor: { name: 'Dra. Helena Martins', specialty: 'Dermatologia' }, status: 'SCHEDULED' },
  { id: 'fallback-4', startsAt: '2026-09-04T11:30:00-03:00', patient: { name: 'Lucas Ribeiro' }, doctor: { name: 'Dr. Caio Nunes', specialty: 'Clínica geral' }, status: 'PENDING_CONFIRMATION' },
];
const fallbackConversations: Conversation[] = [
  { id: 'fallback-c1', patient: { name: 'Ana Souza' }, messageText: 'Queria confirmar meu horário de amanhã...', createdAt: new Date().toISOString() },
  { id: 'fallback-c2', patient: { name: 'Felipe Martins' }, messageText: 'A Dra. Helena atende convênio?', createdAt: new Date(Date.now() - 8 * 60000).toISOString() },
  { id: 'fallback-c3', patient: { name: 'Paula Costa' }, messageText: 'Perfeito, obrigada!', createdAt: new Date(Date.now() - 22 * 60000).toISOString() },
];
const fallbackData: DashboardData = { appointments: fallbackAppointments, conversations: fallbackConversations, waiting: 1 };
const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:3333';
const clinicId = process.env.NEXT_PUBLIC_CLINIC_ID;

function initials(name: string) { return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function formatDate(date: Date) { return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(date); }
function formatTime(value: string) { return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function relativeTime(value: string) { const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); return minutes < 1 ? 'agora' : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h`; }
function appointmentTone(status: AppointmentStatus) { return status === 'IN_PROGRESS' ? 'amber' : status === 'PENDING_CONFIRMATION' ? 'blue' : 'mint'; }
function appointmentLabel(status: AppointmentStatus) { return status === 'IN_PROGRESS' ? 'aguardando' : status === 'PENDING_CONFIRMATION' ? 'pendente' : status === 'COMPLETED' ? 'concluído' : 'confirmado'; }

function StatusPill({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`status status-${tone}`}><span className="status-dot" />{children}</span>;
}

function SectionIntro({ eyebrow, title, description, action, onAction }: { eyebrow: string; title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="section-intro"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subheading">{description}</p></div>{action && <button className="primary-button" onClick={onAction}><Plus size={17} />{action}</button>}</div>;
}

function AppointmentRows({ appointments, checkedIn, onCheckIn }: { appointments: Appointment[]; checkedIn: string[]; onCheckIn: (id: string) => void }) {
  if (!appointments.length) return <div className="empty-state">Nenhuma consulta cadastrada para hoje.</div>;
  return <div className="agenda-list">{appointments.map((item) => { const tone = appointmentTone(item.status); return <div className="appointment-row" key={item.id}><div className="appointment-time">{formatTime(item.startsAt)}</div><div className={`appointment-status-line ${tone}`} /><div className="appointment-person"><div className={`avatar avatar-${tone}`}>{initials(item.patient.name)}</div><div><strong>{item.patient.name}</strong><span>Consulta · {item.doctor.specialty || 'Clínica geral'}</span></div></div><div className="appointment-doctor"><span>Profissional</span><strong>{item.doctor.name}</strong></div><div className="appointment-action">{item.status === 'IN_PROGRESS' ? <button className="checkin-button" onClick={() => onCheckIn(item.id)}>{checkedIn.includes(item.id) ? <><Check size={14} /> Na sala</> : 'Check-in'}</button> : <StatusPill tone={tone}>{appointmentLabel(item.status)}</StatusPill>}<button className="dots" aria-label={`Mais ações para ${item.patient.name}`}><MoreHorizontal size={17} /></button></div></div>; })}</div>;
}

function ConversationList({ conversations, selectedId, onSelect }: { conversations: Conversation[]; selectedId?: string; onSelect: (id: string) => void }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return <div className="conversation-list">{conversations.length === 0 ? <div className="empty-state">Nenhuma conversa recebida hoje.</div> : conversations.map((conversation, index) => <button className={`conversation ${conversation.id === selectedId ? 'conversation-selected' : ''}`} key={conversation.id} onClick={() => onSelect(conversation.id)}><div className={`avatar avatar-${['coral', 'violet', 'green'][index % 3]}`}>{initials(conversation.patient?.name || 'Paciente')}</div><div className="conversation-copy"><div><strong>{conversation.patient?.name || 'Paciente'}</strong>{index < 2 && <span className="unread-dot" />}</div><p>{conversation.messageText || 'Mensagem sem texto'}</p></div><time>{hydrated ? relativeTime(conversation.createdAt) : '—'}</time></button>)}</div>;
}

function Overview({ data, appointments, conversations, loading, displayDate, checkedIn, onCheckIn, onNewAppointment = () => undefined, onOpenSection = () => undefined }: { data: DashboardData; appointments: Appointment[]; conversations: Conversation[]; loading: boolean; displayDate: string; checkedIn: string[]; onCheckIn: (id: string) => void; onNewAppointment?: () => void; onOpenSection?: (section: string) => void }) {
  return <><div className="welcome-row"><div><p className="eyebrow">{displayDate.toUpperCase()}</p><h1>Bom dia, Mariana <span>✦</span></h1><p className="subheading">Aqui está o pulso da sua clínica hoje.</p></div><button className="primary-button" onClick={onNewAppointment}><Plus size={17} />Novo agendamento</button></div>
    <div className="metric-grid"><div className="metric-card accent-lime"><div className="metric-head"><span>Consultas hoje</span><CalendarDays size={18} /></div><strong>{loading ? '—' : data.appointments.length}</strong><small><em>{data.waiting} aguardando</em> atendimento</small><div className="sparkline lime-line"><i /><i /><i /><i /><i /><i /><i /><i /></div></div><div className="metric-card accent-coral"><div className="metric-head"><span>Conversas abertas</span><MessageCircle size={18} /></div><strong>{loading ? '—' : data.conversations.length}</strong><small><em>WhatsApp</em> em acompanhamento</small><div className="sparkline coral-line"><i /><i /><i /><i /><i /><i /><i /><i /></div></div><div className="metric-card accent-blue"><div className="metric-head"><span>Tempo de resposta</span><Clock3 size={18} /></div><strong>1m 42s</strong><small><em>−28%</em> com a assistente IA</small><div className="sparkline blue-line"><i /><i /><i /><i /><i /><i /><i /><i /></div></div><div className="metric-card accent-violet"><div className="metric-head"><span>Taxa de confirmação</span><Check size={18} /></div><strong>92<sup>%</sup></strong><small><em>+5%</em> nesta semana</small><div className="sparkline violet-line"><i /><i /><i /><i /><i /><i /><i /><i /></div></div></div>
    <div className="dashboard-grid"><div className="panel agenda-panel"><div className="panel-header"><div><h2>Agenda de hoje</h2><p>{displayDate.split(' de ')[0]} <span>·</span> {data.appointments.length} consultas</p></div><button className="ghost-button" onClick={() => onOpenSection('Agenda')}>Ver agenda completa <ArrowUpRight size={15} /></button></div><AppointmentRows appointments={appointments} checkedIn={checkedIn} onCheckIn={onCheckIn} /></div><div className="panel inbox-panel"><div className="panel-header"><div><h2>Atendimento</h2><p>WhatsApp <span className="live-dot" /> ao vivo</p></div><button className="circle-add" aria-label="Nova conversa" onClick={() => onOpenSection('Atendimento')}><Plus size={17} /></button></div><div className="inbox-tabs"><button className="tab-active">Todas <b>{data.conversations.length}</b></button><button>Não lidas <b>{Math.min(data.conversations.length, 4)}</b></button></div><ConversationList conversations={conversations} onSelect={() => onOpenSection('Atendimento')} /><button className="inbox-footer" onClick={() => onOpenSection('Atendimento')}>Abrir central de atendimento <ArrowUpRight size={15} /></button></div></div>
    <div className="bottom-grid"><div className="panel ai-panel"><div className="ai-orb"><Sparkles size={19} /></div><div><p className="eyebrow">ASSISTENTE CLINICFLOW</p><h2>A clínica não para quando você sai.</h2><p>A IA acolheu <strong>64 conversas</strong> esta semana e converteu <strong>18 agendamentos</strong> automaticamente.</p></div><div className="ai-chart"><span style={{ height: '38%' }} /><span style={{ height: '54%' }} /><span style={{ height: '44%' }} /><span style={{ height: '78%' }} /><span style={{ height: '62%' }} /><span style={{ height: '92%' }} /></div></div><div className="panel tele-panel"><div className="tele-heading"><div className="tele-icon"><Video size={18} /></div><div><h2>Próxima teleconsulta</h2><p>Começa em 01h 18min</p></div></div><div className="tele-person"><div className="avatar avatar-blue">LR</div><div><strong>Lucas Ribeiro</strong><span>Clínica geral · 11:30</span></div><button className="ghost-button">Abrir sala <ArrowUpRight size={14} /></button></div></div></div></>;
}

function SectionScreen({ section, data, appointments, conversations, checkedIn, onCheckIn, selectedConversationId, onSelectConversation, aiEnabled, onToggleAi, suggestion, suggesting, onSuggestReply, evolutionStatus, patientRecords, team, onNewPatient, onNewAppointment }: { section: string; data: DashboardData; appointments: Appointment[]; conversations: Conversation[]; checkedIn: string[]; onCheckIn: (id: string) => void; selectedConversationId?: string; onSelectConversation: (id: string) => void; aiEnabled: boolean; onToggleAi: () => void; suggestion: string; suggesting: boolean; onSuggestReply: (conversation?: Conversation) => void; evolutionStatus?: IntegrationStatus; patientRecords: PatientSummary[]; team: TeamMember[]; onNewPatient: () => void; onNewAppointment?: () => void }) {
  const fallbackPatients = useMemo(() => {
    const entries: Array<[string, PatientSummary]> = [
      ...appointments.map((item): [string, PatientSummary] => [item.patient.name, { name: item.patient.name, phone: '(11) 99842-1204', lastVisit: formatTime(item.startsAt) }]),
      ...conversations.filter((item) => item.patient).map((item): [string, PatientSummary] => [item.patient!.name, { name: item.patient!.name, phone: '(11) 99102-7781', lastVisit: relativeTime(item.createdAt) }]),
    ];
    return Array.from(new Map(entries).values());
  }, [appointments, conversations]);
  const patients = patientRecords.length ? patientRecords : fallbackPatients;
  const doctors = team.length ? team.filter((member) => member.role === 'DOCTOR').map((member) => ({ name: member.name, specialty: member.specialty })) : Array.from(new Map(appointments.map((item) => [item.doctor.name, item.doctor])).values());
  if (section === 'Agenda') return <><SectionIntro eyebrow="OPERAÇÃO · AGENDA" title="Agenda" description="Organize o dia da equipe com uma visão simples e viva." action="Novo agendamento" onAction={onNewAppointment} /><div className="section-grid"><div className="panel"><div className="panel-header"><div><h2>Quinta-feira, hoje</h2><p>{appointments.length} consultas programadas</p></div><div className="date-chip"><CalendarDays size={14} />04 set</div></div><AppointmentRows appointments={appointments} checkedIn={checkedIn} onCheckIn={onCheckIn} /></div><div className="panel insight-panel"><p className="eyebrow">RESUMO DO DIA</p><div className="big-number">{data.waiting}</div><h2>paciente aguardando</h2><p>O próximo horário livre aparece assim que um profissional libera a agenda.</p><div className="mini-stat"><span>Confirmadas</span><strong>{appointments.filter((item) => item.status === 'SCHEDULED').length}</strong></div><div className="mini-stat"><span>Pendentes</span><strong>{appointments.filter((item) => item.status === 'PENDING_CONFIRMATION').length}</strong></div></div></div></>;
  if (section === 'Atendimento') { const selected = conversations.find((item) => item.id === selectedConversationId) || conversations[0]; return <><SectionIntro eyebrow="CANAIS · WHATSAPP" title="Central de atendimento" description="Acompanhe as conversas e deixe a IA cuidar do primeiro acolhimento." action="Nova conversa" /><div className="inbox-screen-grid"><div className="panel inbox-full-panel"><div className="inbox-tabs"><button className="tab-active">Todas <b>{conversations.length}</b></button><button>Não lidas <b>{Math.min(conversations.length, 4)}</b></button><button>Com IA <b>8</b></button></div><ConversationList conversations={conversations} selectedId={selected?.id} onSelect={onSelectConversation} /></div><div className="panel conversation-detail"><div className="detail-top"><div className="avatar avatar-coral">{initials(selected?.patient?.name || 'Paciente')}</div><div><h2>{selected?.patient?.name || 'Selecione uma conversa'}</h2><p>WhatsApp · {selected ? relativeTime(selected.createdAt) : 'sem mensagens'}</p></div><span className="live-badge">online</span></div><div className="message-bubble">{selected?.messageText || 'Escolha uma conversa para visualizar o histórico.'}</div>{suggestion && <div className="suggestion-bubble"><Sparkles size={13} /><span>{suggestion}</span></div>}<div className="reply-box">{suggesting ? 'A assistente está preparando uma sugestão...' : suggestion || 'Escreva uma resposta...'}<div className="reply-actions"><button className="ai-reply-button" onClick={() => onSuggestReply(selected)} disabled={!selected || suggesting}><Sparkles size={14} />Sugerir com IA</button><button className="send-button"><ArrowUpRight size={15} /></button></div></div></div></div></>; }
  if (section === 'Pacientes') return <><SectionIntro eyebrow="RELACIONAMENTO · PACIENTES" title="Pacientes" description="Uma visão rápida das pessoas que movimentam a clínica." action="Cadastrar paciente" onAction={onNewPatient} /><div className="panel table-panel"><div className="table-toolbar"><strong>{patients.length} pacientes recentes</strong><button className="ghost-button">Exportar lista <ArrowUpRight size={14} /></button></div><div className="patient-table"><div className="table-row table-head"><span>Paciente</span><span>Telefone</span><span>Último contato</span><span>Status</span></div>{patients.length ? patients.map((patient, index) => <div className="table-row" key={patient.id || patient.name}><span className="table-person"><span className={`avatar avatar-${['coral', 'mint', 'violet'][index % 3]}`}>{initials(patient.name)}</span><strong>{patient.name}</strong></span><span>{patient.phone}</span><span>{patient.lastVisit}</span><StatusPill tone={index % 2 ? 'mint' : 'blue'}>{patient.recordsCount ? `${patient.recordsCount} registro${patient.recordsCount > 1 ? 's' : ''}` : index % 2 ? 'ativo' : 'retorno hoje'}</StatusPill></div>) : <div className="empty-state">Nenhum paciente recente.</div>}</div></div></>;
  if (section === 'Prontuários') return <><SectionIntro eyebrow="CUIDADO · HISTÓRICO CLÍNICO" title="Prontuários" description="Acesse o contexto certo antes de cada atendimento." /><div className="record-grid">{patients.map((patient, index) => <div className="panel record-card" key={patient.name}><div className="record-heading"><div className={`avatar avatar-${['coral', 'mint', 'violet'][index % 3]}`}>{initials(patient.name)}</div><div><h2>{patient.name}</h2><p>Último atendimento {patient.lastVisit}</p></div><MoreHorizontal size={16} /></div><div className="record-line"><FileText size={14} /><span>{index % 2 ? 'Anamnese e evolução' : 'Retorno · documentação completa'}</span></div><button className="ghost-button">Abrir prontuário <ArrowUpRight size={14} /></button></div>)}</div></>;
  if (section === 'Equipe') return <><SectionIntro eyebrow="GESTÃO · PROFISSIONAIS" title="Equipe clínica" description="Veja quem está online e como as agendas estão distribuídas." action="Adicionar profissional" /><div className="team-grid">{[...doctors.map((doctor) => ({ name: doctor.name, specialty: doctor.specialty || 'Clínica geral', tone: 'blue' })), { name: 'Mariana Costa', specialty: 'Administradora', tone: 'lime' }].map((person) => <div className="panel team-card" key={person.name}><div className={`avatar avatar-${person.tone}`}>{initials(person.name)}</div><div><h2>{person.name}</h2><p>{person.specialty}</p></div><span className="online-indicator" /></div>)}</div></>;
  return <><SectionIntro eyebrow="CONFIGURAÇÕES · CLINICFLOW" title="Configurações" description="Ajuste a operação da clínica e o comportamento da assistente." /><div className="settings-list"><div className="panel setting-row"><div className="setting-icon"><Sparkles size={17} /></div><div><h2>Assistente IA</h2><p>Responde novas conversas fora do horário comercial.</p></div><button className={`toggle ${aiEnabled ? 'toggle-on' : ''}`} onClick={onToggleAi} aria-label="Alternar assistente IA"><span /></button></div><div className="panel setting-row"><div className="setting-icon setting-blue"><Clock3 size={17} /></div><div><h2>Horário de funcionamento</h2><p>Segunda a sexta · 08:00 às 18:00</p></div><button className="ghost-button">Editar <ArrowUpRight size={14} /></button></div><div className="panel setting-row"><div className="setting-icon setting-coral"><MessageCircle size={17} /></div><div><h2>WhatsApp conectado</h2><p>Instância {evolutionStatus?.instance || 'nova'} · {evolutionStatus?.connected ? 'sincronizada agora' : evolutionStatus?.status === 'not_found' ? 'instância não encontrada' : 'verificando conexão'}</p></div>{evolutionStatus?.connected ? <StatusPill tone="mint">conectado</StatusPill> : <StatusPill tone="amber">{evolutionStatus?.status || 'verificando'}</StatusPill>}</div></div></>;
}

function AppointmentModal({ form, setForm, saving, error, onClose, onSubmit }: { form: { patientName: string; phone: string; doctorId: string; date: string; time: string; notes: string }; setForm: (value: { patientName: string; phone: string; doctorId: string; date: string; time: string; notes: string }) => void; saving: boolean; error: string; onClose: () => void; onSubmit: () => void }) {
  return <div className="modal-backdrop" role="presentation"><form className="modal-card" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><div className="modal-heading"><div><p className="eyebrow">AGENDA · NOVO HORÁRIO</p><h2>Novo agendamento</h2></div><button type="button" className="dots" onClick={onClose} aria-label="Fechar">×</button></div><label>Nome do paciente<input required value={form.patientName} onChange={(event) => setForm({ ...form, patientName: event.target.value })} /></label><label>Telefone<input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="(11) 99999-9999" /></label><label>Profissional<select value={form.doctorId} onChange={(event) => setForm({ ...form, doctorId: event.target.value })}><option value="doctor-helena">Dra. Helena Martins</option><option value="doctor-caio">Dr. Caio Nunes</option></select></label><div className="form-grid"><label>Data<input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label><label>Horário<input required type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} /></label></div><label>Observações<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>{error && <p className="form-warning">{error}</p>}<div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Reservando...' : 'Confirmar horário'}</button></div></form></div>;
}

export default function Home() {
  const [authReady, setAuthReady] = useState(false);
  const [section, setSection] = useState('Visão geral');
  const [showNotifications, setShowNotifications] = useState(false);
  const [checkedIn, setCheckedIn] = useState<string[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>();
  const [aiEnabled, setAiEnabled] = useState(true);
  const [suggestion, setSuggestion] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [evolutionStatus, setEvolutionStatus] = useState<IntegrationStatus>();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<DashboardData>(fallbackData);
  const [loading, setLoading] = useState(Boolean(clinicId));
  const [syncError, setSyncError] = useState(false);
  const [patientRecords, setPatientRecords] = useState<PatientSummary[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [savingPatient, setSavingPatient] = useState(false);
  const [patientForm, setPatientForm] = useState({ name: '', phone: '', notes: '' });
  const [showAppointmentForm, setShowAppointmentForm] = useState(false);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [appointmentError, setAppointmentError] = useState('');
  const [appointmentForm, setAppointmentForm] = useState({ patientName: '', phone: '', doctorId: 'doctor-helena', date: new Date().toISOString().slice(0, 10), time: '09:00', notes: '' });

  useEffect(() => {
    if (!sessionStorage.getItem('clinicflow_user_token')) { window.location.replace('/login'); return; }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    if (section === 'Agenda' && clinicId) setShowAppointmentForm(true);
  }, [section]);

  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    const load = async () => { try { const response = await fetch(`${apiUrl}/api/v1/dashboard/summary?clinicId=${encodeURIComponent(clinicId)}`, { cache: 'no-store' }); if (!response.ok) throw new Error(`summary-${response.status}`); const next = await response.json() as DashboardData; if (!cancelled) { setData(next); setSyncError(false); } } catch { if (!cancelled) setSyncError(true); } finally { if (!cancelled) setLoading(false); } };
    void load(); const timer = window.setInterval(load, 30000); return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadEvolutionStatus = async () => { try { const response = await fetch(`${apiUrl}/api/v1/integrations/evolution/status`, { cache: 'no-store' }); if (!response.ok) throw new Error('evolution-status'); const next = await response.json() as IntegrationStatus; if (!cancelled) setEvolutionStatus(next); } catch { if (!cancelled) setEvolutionStatus(undefined); } };
    void loadEvolutionStatus();
    const timer = window.setInterval(loadEvolutionStatus, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!clinicId) return;
    const params = `clinicId=${encodeURIComponent(clinicId)}`;
    void Promise.all([
      fetch(`${apiUrl}/api/v1/patients?${params}`, { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('patients'))),
      fetch(`${apiUrl}/api/v1/team?${params}`, { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('team'))),
    ]).then(([nextPatients, nextTeam]) => {
      setPatientRecords((nextPatients as Array<{ id: string; name: string; phone: string; lastAppointment?: { startsAt: string } | null; recordsCount?: number }>).map((patient) => ({ id: patient.id, name: patient.name, phone: patient.phone, lastVisit: patient.lastAppointment ? formatTime(patient.lastAppointment.startsAt) : 'sem histórico', recordsCount: patient.recordsCount })));
      setTeam(nextTeam as TeamMember[]);
    }).catch(() => undefined);
  }, []);

  const appointments = useMemo(() => data.appointments.filter((item) => item.status !== 'CANCELED' && (!query || item.patient.name.toLowerCase().includes(query.toLowerCase()))).slice(0, 8), [data.appointments, query]);
  const conversations = useMemo(() => data.conversations.filter((item) => !query || (item.patient?.name || '').toLowerCase().includes(query.toLowerCase()) || (item.messageText || '').toLowerCase().includes(query.toLowerCase())).slice(0, 8), [data.conversations, query]);
  const displayDate = useMemo(() => formatDate(new Date()), []);
  const handleCheckIn = (id: string) => {
    setCheckedIn((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    if (clinicId) void fetch(`${apiUrl}/api/v1/appointments/${encodeURIComponent(id)}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clinicId, status: 'IN_PROGRESS' }) });
  };
  const handleCreatePatient = async () => {
    if (!clinicId || !patientForm.name.trim() || !patientForm.phone.trim()) return;
    setSavingPatient(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/patients`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clinicId, ...patientForm }) });
      if (!response.ok) throw new Error('patient');
      const created = await response.json() as { id: string; name: string; phone: string };
      setPatientRecords((current) => [{ id: created.id, name: created.name, phone: created.phone, lastVisit: 'sem histórico' }, ...current]);
      setPatientForm({ name: '', phone: '', notes: '' });
      setShowPatientForm(false);
    } finally { setSavingPatient(false); }
  };
  const handleBookAppointment = async () => {
    if (!clinicId) return;
    setSavingAppointment(true); setAppointmentError('');
    try {
      const response = await fetch(`${apiUrl}/api/v1/appointments/book`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-clinic-id': clinicId }, body: JSON.stringify({ ...appointmentForm, clinicId, dateTime: new Date(`${appointmentForm.date}T${appointmentForm.time}:00`).toISOString() }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Não foi possível reservar o horário.');
      const refreshed = await fetch(`${apiUrl}/api/v1/dashboard/summary?clinicId=${encodeURIComponent(clinicId)}`);
      if (refreshed.ok) setData(await refreshed.json() as DashboardData);
      setShowAppointmentForm(false);
      setAppointmentForm({ patientName: '', phone: '', doctorId: 'doctor-helena', date: new Date().toISOString().slice(0, 10), time: '09:00', notes: '' });
    } catch (error) { setAppointmentError(error instanceof Error ? error.message : 'Não foi possível reservar o horário.'); } finally { setSavingAppointment(false); }
  };
  const handleSuggestReply = async (conversation?: Conversation) => {
    if (!conversation?.patient?.name || !conversation.messageText) return;
    setSuggesting(true); setSuggestion('');
    try { const response = await fetch(`${apiUrl}/api/v1/assistant/suggest-reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patientName: conversation.patient.name, messageText: conversation.messageText }) }); const body = await response.json() as { suggestion?: string; error?: string }; if (!response.ok) throw new Error(body.error || 'Não foi possível gerar a sugestão.'); setSuggestion(body.suggestion || ''); } catch (error) { setSuggestion(error instanceof Error ? error.message : 'Não foi possível gerar a sugestão.'); } finally { setSuggesting(false); }
  };

  if (!authReady) return null;
  if (showAppointmentForm) return <AppointmentModal form={appointmentForm} setForm={setAppointmentForm} saving={savingAppointment} error={appointmentError} onClose={() => { setShowAppointmentForm(false); setAppointmentError(''); }} onSubmit={() => { void handleBookAppointment(); }} />;
  return <main className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Activity size={18} strokeWidth={2.7} /></span><span>clinic<span>flow</span></span><span className="brand-beta">AI</span></div><div className="workspace-switcher"><div className="clinic-avatar">CV</div><div><strong>Clínica Vitta</strong><small>Unidade Jardins</small></div><ChevronDown size={15} /></div><nav><p className="nav-label">Workspace</p>{[[LayoutDashboard, 'Visão geral'], [MessageCircle, 'Atendimento', '12'], [CalendarDays, 'Agenda'], [Users, 'Pacientes'], [FileText, 'Prontuários']].map(([Icon, label, count]: any) => <button className={section === label ? 'nav-item active' : 'nav-item'} onClick={() => { setSection(label); setSuggestion(''); }} key={label}><Icon size={18} />{label}{count && <span className="nav-count">{count}</span>}</button>)}<p className="nav-label space-top">Gestão</p>{[[Stethoscope, 'Equipe'], [Settings2, 'Configurações']].map(([Icon, label]: any) => <button className={section === label ? 'nav-item active' : 'nav-item'} onClick={() => setSection(label)} key={label}><Icon size={18} />{label}</button>)}</nav><div className="sidebar-bottom"><div className="pulse-card"><div className="pulse-icon"><Sparkles size={15} /></div><div><strong>IA em operação</strong><span>Atendimento 24/7 ativo</span></div><i /></div><div className="user-chip"><div className="avatar avatar-lime">MC</div><div><strong>Mariana Costa</strong><small>Administradora</small></div><MoreHorizontal size={17} /></div></div></aside><section className="content"><header className="topbar"><div className="crumb"><span>Workspace</span><b>/</b><strong>{section}</strong></div><div className="top-actions"><div className="search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar paciente, conversa..." /></div><button className="icon-button notification" onClick={() => setShowNotifications(!showNotifications)}><Bell size={19} /><span /></button>{showNotifications && <div className="notification-pop"><strong>Notificações</strong><p>{data.conversations.length} conversas carregadas no painel.</p><p>{data.waiting} paciente{data.waiting === 1 ? '' : 's'} aguardando atendimento.</p></div>}<div className="avatar avatar-coral">MC</div></div></header><div className="main-scroll">{section === 'Visão geral' ? <Overview data={data} appointments={appointments} conversations={conversations} loading={loading} displayDate={displayDate} checkedIn={checkedIn} onCheckIn={handleCheckIn} onNewAppointment={() => setShowAppointmentForm(true)} onOpenSection={setSection} /> : <SectionScreen section={section} data={data} appointments={appointments} conversations={conversations} checkedIn={checkedIn} onCheckIn={handleCheckIn} selectedConversationId={selectedConversationId} onSelectConversation={setSelectedConversationId} aiEnabled={aiEnabled} onToggleAi={() => setAiEnabled((value) => !value)} suggestion={suggestion} suggesting={suggesting} onSuggestReply={handleSuggestReply} evolutionStatus={evolutionStatus} patientRecords={patientRecords} team={team} onNewPatient={() => setShowPatientForm(true)} onNewAppointment={() => setShowAppointmentForm(true)} />}{syncError && <p className="sync-note">API indisponível; exibindo os últimos dados de demonstração. Configure o banco e recarregue para sincronizar.</p>}<footer><span>ClinicFlow AI · Operação clínica em um só lugar</span><a href="https://deerflow.tech" target="_blank" rel="noreferrer">Created By Deerflow</a></footer></div></section>{showPatientForm && <div className="modal-backdrop" role="presentation"><form className="modal-card" onSubmit={(event) => { event.preventDefault(); void handleCreatePatient(); }}><div className="modal-heading"><div><p className="eyebrow">NOVO CADASTRO</p><h2>Cadastrar paciente</h2></div><button type="button" className="dots" onClick={() => setShowPatientForm(false)} aria-label="Fechar">×</button></div><label>Nome completo<input required value={patientForm.name} onChange={(event) => setPatientForm({ ...patientForm, name: event.target.value })} /></label><label>Telefone<input required value={patientForm.phone} onChange={(event) => setPatientForm({ ...patientForm, phone: event.target.value })} placeholder="(11) 99999-9999" /></label><label>Observações<textarea value={patientForm.notes} onChange={(event) => setPatientForm({ ...patientForm, notes: event.target.value })} /></label>{!clinicId && <p className="form-warning">Configure NEXT_PUBLIC_CLINIC_ID para salvar no banco.</p>}<div className="modal-actions"><button type="button" className="ghost-button" onClick={() => setShowPatientForm(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={savingPatient || !clinicId}>{savingPatient ? 'Salvando...' : 'Salvar paciente'}</button></div></form></div>}</main>;
}
