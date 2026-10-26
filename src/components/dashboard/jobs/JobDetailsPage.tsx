import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  MapPin,
  Users,
  Calendar,
  Clock,
  Link as LinkIcon,
  Check,
  Briefcase,
  Timer,
  CircleDollarSign,
  Gift,
  Target,
  Star,
  HelpCircle,
} from 'lucide-react';
import { getStatusColor, getStatusShortText, deriveCandidateStatus } from '../../../utils/candidateStatus';
import { getJobDisplayStatus, getJobStatusColor, getJobStatusLabel } from '../../../utils/jobStatus';
import LoadingSpinner from '../../ui/LoadingSpinner';
import useDarkMode from '../../../hooks/useDarkMode';
import { useAuth } from '../../../hooks/useAuth';
import { supabase } from '../../../integrations/supabase/client';
import Button from '../../ui/Button';
import Avatar from '../../ui/Avatar';
import StatusMessage from '../../ui/StatusMessage';
import { toast } from '../../ui/Toast';
import { Candidate, JobWithStats } from '../../../types/company';
import TestInterviewPanel from './TestInterviewPanel';

interface JobWithCompany extends JobWithStats {
  company: {
    id: string;
    name: string;
  };
}

const WORK_MODEL_LABELS: Record<string, string> = {
  remoto: 'Remoto',
  hibrido: 'Híbrido',
  presencial: 'Presencial',
};

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  'full-time': 'Tempo integral',
  'part-time': 'Meio período',
  'contract': 'Contrato',
  'freelance': 'Freelance',
  'internship': 'Estágio',
};

function parseJsonArray<T>(value: unknown): T[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as T[] : null;
    } catch {
      return null;
    }
  }
  return null;
}

function JobDetailsPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobWithCompany | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const { darkMode } = useDarkMode();
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!jobId || !userId) return;
    let cancelled = false;

    const fetchJobDetails = async () => {
      try {
        const { data: companies, error: companyError } = await supabase
          .from('companies')
          .select('id, name')
          .eq('user_id', userId);

        if (companyError) throw companyError;
        if (!companies || companies.length === 0) {
          throw new Error('Empresa não encontrada');
        }

        const company = companies[0];

        const { data: jobData, error: jobError } = await supabase
          .from('jobs')
          .select(`
            *,
            candidates(count)
          `)
          .eq('id', jobId)
          .eq('company_id', company.id)
          .single();

        if (jobError) throw jobError;
        if (!jobData) throw new Error('Vaga não encontrada');

        const transformedJob: JobWithCompany = {
          ...jobData,
          location: jobData.location || undefined,
          mandatory_requirements: parseJsonArray<string>(jobData.mandatory_requirements),
          desirable_requirements: parseJsonArray<string>(jobData.desirable_requirements),
          pre_interview_questions: parseJsonArray<{ id: number; question: string }>(jobData.pre_interview_questions),
          candidatesCount: jobData.candidates?.[0]?.count || 0,
          candidates: jobData.candidates,
          status: (jobData.status as 'open' | 'closed' | 'paused') || 'open',
          created_at: jobData.created_at || new Date().toISOString(),
          updated_at: jobData.updated_at || new Date().toISOString(),
          company,
        };

        if (!cancelled) setJob(transformedJob);

        const { data: candidatesData, error: candidatesError } = await supabase
          .from('candidates')
          .select('*, interview_reports(status)')
          .eq('job_id', jobId)
          .order('created_at', { ascending: false });

        if (candidatesError) throw candidatesError;

        const transformedCandidates: Candidate[] = (candidatesData || []).map(candidate => {
          // interview_reports.interview_id is unique, so this is a one-to-one embed: an object, not an array.
          const report = candidate.interview_reports as { status: string } | null;
          return {
            ...candidate,
            phone: candidate.phone || undefined,
            resume_url: candidate.resume_url || undefined,
            notes: candidate.notes || undefined,
            interview_started_at: candidate.interview_started_at || undefined,
            interview_completed_at: candidate.interview_completed_at || undefined,
            status: deriveCandidateStatus(report?.status),
            is_favorite: candidate.is_favorite || false,
            pre_interview_answers: candidate.pre_interview_answers as Record<string, unknown> | null,
            created_at: candidate.created_at || new Date().toISOString(),
            updated_at: candidate.updated_at || new Date().toISOString(),
          };
        });

        if (!cancelled) setCandidates(transformedCandidates);
      } catch (err) {
        console.error('Error fetching job details:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar detalhes da vaga');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchJobDetails();
    return () => { cancelled = true; };
  }, [jobId, userId]);

  const copyApplicationLink = () => {
    const url = `${window.location.origin}/apply/${jobId}`;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success('Link de candidatura copiado', {
          description: 'Compartilhe com os candidatos para que eles se inscrevam.',
        });
      },
      () => toast.error('Não foi possível copiar o link', {
        description: 'Copie manualmente: ' + url,
      }),
    );
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error || !job) {
    return (
      <div className="max-w-6xl mx-auto py-12">
        <Button
          onClick={() => navigate('/dashboard/jobs')}
          variant="outline"
          size="sm"
          icon={ArrowLeft}
          iconPosition="left"
          darkMode={darkMode}
        >
          Voltar para vagas
        </Button>
        <div className="mt-8">
          <StatusMessage
            type="error"
            title="Vaga não encontrada"
            message={error || 'A vaga solicitada não foi encontrada'}
            darkMode={darkMode}
          />
        </div>
      </div>
    );
  }

  const displayStatus = getJobDisplayStatus(job);
  const workModel = job.work_model ? WORK_MODEL_LABELS[job.work_model] || job.work_model : null;
  const contractType = job.contract_type ? CONTRACT_TYPE_LABELS[job.contract_type] || job.contract_type : null;

  const metaItems = [
    workModel && { icon: Briefcase, label: 'Modelo de trabalho', value: workModel },
    job.location && { icon: MapPin, label: 'Localização', value: job.location },
    contractType && { icon: Users, label: 'Tipo de contrato', value: contractType },
    job.interview_duration_minutes && { icon: Timer, label: 'Duração da entrevista', value: `${job.interview_duration_minutes} min` },
    { icon: Calendar, label: 'Criada em', value: new Date(job.created_at).toLocaleDateString('pt-BR') },
    job.deadline && { icon: Clock, label: 'Prazo final', value: new Date(job.deadline).toLocaleDateString('pt-BR') },
  ].filter(Boolean) as Array<{ icon: typeof MapPin; label: string; value: string }>;

  const sectionTitle = (title: string) => (
    <h2 className={`font-heading text-2xl pb-4 border-b mb-6 ${darkMode ? 'text-white border-gray-800' : 'text-triagen-primary border-triagen-border-light'}`}>
      {title}
    </h2>
  );

  const requirementList = (items: string[], Icon: typeof Target, title: string) => (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Icon className={`h-4 w-4 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`} />
        <h3 className={`text-xs uppercase tracking-widest font-bold ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
          {title}
        </h3>
      </div>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-3">
            <span className={`mt-[0.55rem] w-1.5 h-1.5 rounded-full shrink-0 ${darkMode ? 'bg-gray-500' : 'bg-triagen-secondary'}`} />
            <span className={`text-sm md:text-base leading-relaxed ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`}>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex flex-col max-w-6xl mx-auto pb-16">

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-6 mb-12">
        <button
          onClick={() => navigate('/dashboard/jobs')}
          className={`flex items-center gap-2 text-xs uppercase tracking-widest font-semibold hover:opacity-70 transition-opacity ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}
        >
          <ArrowLeft className="w-4 h-4" /> Vagas
        </button>
        <Button
          variant={copied ? 'secondary' : 'primary'}
          size="sm"
          onClick={copyApplicationLink}
          icon={copied ? Check : LinkIcon}
          iconPosition="left"
          darkMode={darkMode}
        >
          {copied ? 'Link copiado!' : 'Copiar link de candidatura'}
        </Button>
      </div>

      <div className="mb-12 -mt-6 flex justify-end">
        <TestInterviewPanel jobId={job.id} darkMode={darkMode} />
      </div>

      {/* Header */}
      <div className={`flex flex-col gap-6 pb-10 mb-12 border-b ${darkMode ? 'border-gray-800' : 'border-triagen-border-light'}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`px-2.5 py-1 rounded-full text-[0.65rem] font-bold tracking-widest uppercase ${getJobStatusColor(displayStatus)}`}>
            {getJobStatusLabel(displayStatus)}
          </span>
          <span className={`text-[0.65rem] uppercase tracking-widest font-semibold ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
            {job.company.name}
          </span>
        </div>
        <h1 className={`text-4xl md:text-6xl font-heading font-normal tracking-tight leading-tight break-words ${darkMode ? 'text-white' : 'text-triagen-primary'}`}>
          {job.title}
        </h1>

        {/* Meta strip */}
        <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-5 mt-2">
          {metaItems.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex flex-col gap-1 min-w-0">
              <dt className={`flex items-center gap-1.5 text-[0.6rem] uppercase tracking-widest font-semibold ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                <Icon className="w-3 h-3" /> {label}
              </dt>
              <dd className={`text-sm font-medium truncate ${darkMode ? 'text-gray-200' : 'text-triagen-primary'}`}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Main column */}
        <div className="lg:col-span-8 flex flex-col gap-12">
          {/* Description */}
          <section>
            {sectionTitle('Sobre a vaga')}
            <p className={`text-base leading-relaxed whitespace-pre-line max-w-3xl text-justify ${darkMode ? 'text-gray-300' : 'text-triagen-secondary'}`}>
              {job.description}
            </p>
          </section>

          {/* Team context */}
          {job.team_context && (
            <section>
              {sectionTitle('Sobre o time')}
              <p className={`text-base leading-relaxed whitespace-pre-line max-w-3xl text-justify ${darkMode ? 'text-gray-300' : 'text-triagen-secondary'}`}>
                {job.team_context}
              </p>
            </section>
          )}

          {/* Requirements */}
          {((job.mandatory_requirements?.length || 0) > 0 || (job.desirable_requirements?.length || 0) > 0) && (
            <section>
              {sectionTitle('Requisitos e diferenciais')}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                {job.mandatory_requirements && job.mandatory_requirements.length > 0 &&
                  requirementList(job.mandatory_requirements, Target, 'Requisitos obrigatórios')}
                {job.desirable_requirements && job.desirable_requirements.length > 0 &&
                  requirementList(job.desirable_requirements, Star, 'Diferenciais desejáveis')}
              </div>
            </section>
          )}

          {/* Salary and Benefits */}
          {(job.salary_range || job.salary_info || job.benefits) && (
            <section>
              {sectionTitle('Remuneração e benefícios')}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                {(job.salary_range || job.salary_info) && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <CircleDollarSign className={`h-4 w-4 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`} />
                      <h3 className={`text-xs uppercase tracking-widest font-bold ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
                        Faixa salarial
                      </h3>
                    </div>
                    {job.salary_range && (
                      <p className={`text-base font-medium ${darkMode ? 'text-gray-200' : 'text-triagen-primary'}`}>{job.salary_range}</p>
                    )}
                    {job.salary_info && (
                      <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>{job.salary_info}</p>
                    )}
                  </div>
                )}
                {job.benefits && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Gift className={`h-4 w-4 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`} />
                      <h3 className={`text-xs uppercase tracking-widest font-bold ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
                        Benefícios
                      </h3>
                    </div>
                    <p className={`text-sm md:text-base leading-relaxed whitespace-pre-line text-justify ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`}>
                      {job.benefits}
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Screening questions */}
          {job.pre_interview_questions && job.pre_interview_questions.length > 0 && (
            <section>
              {sectionTitle('Perguntas de triagem')}
              <ol className="flex flex-col gap-3">
                {job.pre_interview_questions.map((q, index) => (
                  <li key={q.id} className="flex items-start gap-4">
                    <span className={`font-heading text-lg leading-relaxed ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="flex items-start gap-2 pt-[0.3rem]">
                      <HelpCircle className={`w-4 h-4 mt-0.5 shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      <span className={`text-sm md:text-base leading-relaxed ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`}>{q.question}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {/* Sidebar: candidates */}
        <div className="lg:col-span-4">
          <div className={`p-6 rounded border sticky top-24 ${darkMode ? 'border-gray-800 bg-gray-900/50' : 'border-triagen-border-light bg-white'}`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className={`text-xs uppercase tracking-widest font-bold ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>
                Candidatos ({candidates.length})
              </h2>
              {candidates.length > 0 && (
                <button
                  onClick={() => navigate(`/dashboard/candidates?job=${job.id}`)}
                  className={`text-[0.65rem] font-semibold tracking-widest uppercase transition-colors ${darkMode ? 'text-gray-400 hover:text-white' : 'text-triagen-secondary hover:text-triagen-primary'}`}
                >
                  Ver todos
                </button>
              )}
            </div>

            {candidates.length === 0 ? (
              <div className="text-center py-8">
                <Users className={`h-8 w-8 mx-auto mb-3 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
                <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
                  Nenhum candidato ainda.
                </p>
                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Compartilhe o link de candidatura para receber os primeiros candidatos.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {candidates.slice(0, 5).map((candidate) => (
                  <button
                    key={candidate.id}
                    onClick={() => navigate(`/dashboard/candidates/${candidate.id}`)}
                    className={`p-3 rounded border text-left transition-colors flex items-center gap-3 ${
                      darkMode
                        ? 'border-gray-800 bg-gray-800/30 hover:border-gray-600'
                        : 'border-neutral-100 bg-neutral-50/60 hover:border-neutral-300'
                    }`}
                  >
                    <Avatar name={candidate.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-medium text-sm truncate ${darkMode ? 'text-white' : 'text-triagen-primary'}`}>
                          {candidate.name}
                        </span>
                        {candidate.is_favorite && (
                          <Star className="h-3 w-3 shrink-0 text-amber-500" fill="currentColor" />
                        )}
                      </div>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[0.55rem] font-bold tracking-widest uppercase ${getStatusColor(candidate.status)}`}>
                        {getStatusShortText(candidate.status)}
                      </span>
                    </div>
                  </button>
                ))}

                {candidates.length > 5 && (
                  <button
                    onClick={() => navigate(`/dashboard/candidates?job=${job.id}`)}
                    className={`text-xs font-semibold py-2 transition-colors ${darkMode ? 'text-gray-400 hover:text-white' : 'text-triagen-secondary hover:text-triagen-primary'}`}
                  >
                    Ver mais {candidates.length - 5} candidatos
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default JobDetailsPage;
