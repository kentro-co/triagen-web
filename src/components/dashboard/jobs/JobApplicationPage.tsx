import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Send, ArrowLeft, MapPin, Building2, CircleDollarSign, Gift, Target, Star } from 'lucide-react';
import useDarkMode from '../../../hooks/useDarkMode';
import { supabase } from '../../../integrations/supabase/client';
import { createApplication } from '../../../api/application';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import StatusMessage from '../../ui/StatusMessage';
import PageHeader from '../../ui/PageHeader';
import LoadingSpinner from '../../ui/LoadingSpinner';
import { Input, Textarea } from '../../ui/Field';
import ResumeUploadField from '../../ui/ResumeUploadField';
import { JobWithCompany } from '../../../types/company';
import { isJobAcceptingApplications } from '../../../utils/jobStatus';

const WORK_MODEL_LABELS: Record<string, string> = {
  remoto: 'Remoto',
  hibrido: 'Híbrido',
  presencial: 'Presencial',
};

function parseJsonbField<T>(field: unknown): T[] | null {
  if (!field) return null;
  if (Array.isArray(field)) return field as T[];
  if (typeof field === 'string') {
    try {
      const parsed = JSON.parse(field);
      return Array.isArray(parsed) ? parsed as T[] : null;
    } catch {
      return null;
    }
  }
  return null;
}

function JobApplicationPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobWithCompany | null>(null);
  const [acceptingApplications, setAcceptingApplications] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [resumeMode, setResumeMode] = useState<'upload' | 'manual'>('upload');
  const { darkMode } = useDarkMode();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    resume_text: '',
    pre_interview_answers: {} as Record<string, string>
  });

  useEffect(() => {
    if (!jobId) {
      setError('Link de candidatura inválido.');
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchJob = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('jobs')
          .select(`
            *,
            company:companies(
              id,
              name,
              contact_email,
              address
            )
          `)
          .eq('id', jobId)
          .eq('status', 'open')
          .maybeSingle();

        if (fetchError) {
          console.error('Error fetching job:', fetchError);
          if (!cancelled) setError('Não foi possível carregar a vaga. Tente novamente em instantes.');
          return;
        }

        if (!data) {
          if (!cancelled) setError('Vaga não encontrada ou não está mais disponível.');
          return;
        }

        const transformedJob: JobWithCompany = {
          id: data.id,
          title: data.title,
          description: data.description,
          location: data.location || undefined,
          work_model: data.work_model,
          mandatory_requirements: parseJsonbField<string>(data.mandatory_requirements),
          desirable_requirements: parseJsonbField<string>(data.desirable_requirements),
          salary_range: data.salary_range || undefined,
          benefits: data.benefits || undefined,
          pre_interview_questions: parseJsonbField<{ id: number; question: string }>(data.pre_interview_questions),
          company: data.company as JobWithCompany['company'],
        };

        if (!cancelled) {
          setJob(transformedJob);
          setAcceptingApplications(isJobAcceptingApplications({
            status: data.status as 'open' | 'closed' | 'paused',
            deadline: data.deadline,
          }));
        }
      } catch (err) {
        console.error('Error fetching job:', err);
        if (!cancelled) setError('Erro inesperado ao carregar a vaga.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchJob();
    return () => { cancelled = true; };
  }, [jobId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
    let formatted = digits;
    if (digits.length > 10) {
      formatted = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    } else if (digits.length > 6) {
      formatted = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    } else if (digits.length > 2) {
      formatted = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    } else if (digits.length > 0) {
      formatted = `(${digits}`;
    }
    setFormData(prev => ({ ...prev, phone: formatted }));
  };

  const handleResumeExtracted = (text: string) => {
    setFormData(prev => ({ ...prev, resume_text: text }));
  };

  const handleResumeRemoved = () => {
    setFormData(prev => ({ ...prev, resume_text: '' }));
  };

  const toggleResumeMode = () => {
    setResumeMode(prev => (prev === 'upload' ? 'manual' : 'upload'));
    setFormData(prev => ({ ...prev, resume_text: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.email) {
      setError('Nome e e-mail são obrigatórios');
      return;
    }

    if (job?.pre_interview_questions) {
      for (const q of job.pre_interview_questions) {
        if (!formData.pre_interview_answers[String(q.id)]?.trim()) {
          setError(`A pergunta "${q.question}" é obrigatória`);
          return;
        }
      }
    }

    setSubmitting(true);
    setError('');

    try {
      if (!jobId) throw new Error('Link de candidatura inválido.');

      await createApplication({
        name: formData.name,
        email: formData.email,
        phone: formData.phone || undefined,
        job_id: jobId,
        // The API requires the field; an empty string means "no resume".
        resume_text: formData.resume_text,
        pre_interview_answers: Object.keys(formData.pre_interview_answers).length > 0
          ? formData.pre_interview_answers
          : undefined
      });
      setSuccess(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      console.error('Error submitting application:', err);
      setError('Não foi possível enviar sua candidatura. Se você já se candidatou a esta vaga com este e-mail, confira sua caixa de entrada; senão, tente novamente em instantes.');
    } finally {
      setSubmitting(false);
    }
  };

  const pageShell = (content: React.ReactNode) => (
    <div className={`min-h-screen font-sans ${darkMode ? 'bg-gray-900' : 'bg-triagen-neutral'}`}>
      <PageHeader darkMode={darkMode} />
      {content}
    </div>
  );

  if (loading) {
    return pageShell(
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <LoadingSpinner label="Carregando vaga" />
      </div>
    );
  }

  if (error && !job) {
    return pageShell(
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] px-4">
        <div className="max-w-md w-full">
          <Card darkMode={darkMode}>
            <StatusMessage
              type="error"
              title="Vaga não encontrada"
              message={error}
              darkMode={darkMode}
            />
            <div className="mt-6">
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => navigate('/')}
                icon={ArrowLeft}
                iconPosition="left"
              >
                Voltar ao início
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (success) {
    return pageShell(
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] px-4">
        <div className="max-w-md w-full rise-in">
          <Card darkMode={darkMode} padding="lg">
            <div className="text-center py-4">
              <div className={`w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center ${darkMode ? 'bg-triagen-secondary-green/20' : 'bg-triagen-sage-tint'}`}>
                <Send className={`h-7 w-7 ${darkMode ? 'text-emerald-400' : 'text-triagen-secondary-green'}`} aria-hidden="true" />
              </div>

              <h1 className={`font-heading font-normal tracking-tight text-3xl mb-4 ${darkMode ? 'text-white' : 'text-triagen-primary'}`}>
                Candidatura enviada
              </h1>

              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
                Recebemos sua candidatura. O próximo passo é a entrevista por voz
                com a IA — o link chega por e-mail em instantes.
              </p>

              <StatusMessage
                type="info"
                title="Fique de olho no e-mail"
                message="Se não encontrar a mensagem, verifique também a caixa de spam."
                darkMode={darkMode}
              />
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const workModelLabel = job?.work_model ? WORK_MODEL_LABELS[job.work_model] || job.work_model : null;

  const infoTag = (Icon: typeof MapPin, text: string) => (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-triagen-secondary'}`}>
      <Icon className="w-4 h-4" aria-hidden="true" /> {text}
    </span>
  );

  const requirementBlock = (Icon: typeof Target, title: string, items: string[]) => (
    <div className={`p-5 rounded border text-left ${darkMode ? 'bg-gray-800/40 border-gray-700' : 'bg-white border-triagen-border-light'}`}>
      <h3 className={`flex items-center gap-2 text-xs uppercase tracking-widest font-bold mb-3 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
        <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5">
            <span className={`mt-[0.5rem] w-1 h-1 rounded-full shrink-0 ${darkMode ? 'bg-gray-500' : 'bg-triagen-secondary'}`} />
            <span className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`}>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return pageShell(
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative">
      {/* Job Header */}
      <div className="mb-10 rise-in">
        <p className={`text-[0.65rem] uppercase tracking-[0.2em] font-bold mb-3 ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>
          Vaga aberta
        </p>
        <h1 className={`font-heading text-4xl md:text-5xl font-normal tracking-tight leading-tight mb-4 ${darkMode ? 'text-white' : 'text-triagen-primary'}`}>
          {job?.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {job?.company && infoTag(Building2, job.company.name)}
          {workModelLabel && infoTag(MapPin, [workModelLabel, job?.location].filter(Boolean).join(' • '))}
        </div>
      </div>

      {/* Description */}
      <div className="mb-10">
        <p className={`font-sans leading-relaxed whitespace-pre-line text-justify ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`}>
          {job?.description}
        </p>
      </div>

      {/* Requirements */}
      {((job?.mandatory_requirements?.length || 0) > 0 || (job?.desirable_requirements?.length || 0) > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          {job?.mandatory_requirements && job.mandatory_requirements.length > 0 &&
            requirementBlock(Target, 'Requisitos obrigatórios', job.mandatory_requirements)}
          {job?.desirable_requirements && job.desirable_requirements.length > 0 &&
            requirementBlock(Star, 'Diferenciais desejáveis', job.desirable_requirements)}
        </div>
      )}

      {/* Salary and Benefits */}
      {(job?.salary_range || job?.benefits) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
          {job.salary_range && (
            <div className={`p-5 rounded border ${darkMode ? 'bg-gray-800/40 border-gray-700' : 'bg-white border-triagen-border-light'}`}>
              <h3 className={`flex items-center gap-2 text-xs uppercase tracking-widest font-bold mb-2 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
                <CircleDollarSign className="w-3.5 h-3.5" aria-hidden="true" /> Faixa salarial
              </h3>
              <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`}>{job.salary_range}</p>
            </div>
          )}
          {job.benefits && (
            <div className={`p-5 rounded border ${darkMode ? 'bg-gray-800/40 border-gray-700' : 'bg-white border-triagen-border-light'}`}>
              <h3 className={`flex items-center gap-2 text-xs uppercase tracking-widest font-bold mb-2 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
                <Gift className="w-3.5 h-3.5" aria-hidden="true" /> Benefícios
              </h3>
              <p className={`text-sm leading-relaxed whitespace-pre-line text-justify ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`}>{job.benefits}</p>
            </div>
          )}
        </div>
      )}

      {/* Application Form or closed notice */}
      {acceptingApplications ? (
        <Card darkMode={darkMode} padding="lg">
          <h2 className={`font-heading text-2xl font-normal mb-2 ${darkMode ? 'text-white' : 'text-triagen-primary'}`}>
            Candidate-se à vaga
          </h2>
          <p className={`text-sm mb-8 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
            Preencha seus dados abaixo. Depois, você receberá por e-mail o link para uma entrevista por voz com nossa IA.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input
                label="Nome completo *"
                id="name"
                name="name"
                darkMode={darkMode}
                value={formData.name}
                onChange={handleInputChange}
                placeholder="Seu nome completo"
                autoComplete="name"
                required
              />
              <Input
                label="E-mail *"
                id="email"
                name="email"
                type="email"
                darkMode={darkMode}
                value={formData.email}
                onChange={handleInputChange}
                placeholder="seu@email.com"
                autoComplete="email"
                required
              />
            </div>

            <Input
              label="Telefone"
              id="phone"
              name="phone"
              type="tel"
              darkMode={darkMode}
              value={formData.phone}
              onChange={handlePhoneChange}
              placeholder="(11) 99999-9999"
              autoComplete="tel"
            />

            {resumeMode === 'upload' ? (
              <div>
                <ResumeUploadField
                  darkMode={darkMode}
                  onTextExtracted={handleResumeExtracted}
                  onRemove={handleResumeRemoved}
                />
                <button
                  type="button"
                  onClick={toggleResumeMode}
                  className={`mt-2 text-xs font-medium underline underline-offset-2 ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-triagen-secondary hover:text-triagen-primary'}`}
                >
                  Prefere escrever? Preencha manualmente
                </button>
              </div>
            ) : (
              <div>
                <Textarea
                  label="Resumo do seu currículo (opcional)"
                  id="resume_text"
                  name="resume_text"
                  darkMode={darkMode}
                  value={formData.resume_text}
                  onChange={handleInputChange}
                  placeholder="Descreva brevemente sua experiência profissional, formação e principais habilidades..."
                  rows={4}
                  hint="Essas informações ajudam nossa IA a personalizar a entrevista para você."
                />
                <button
                  type="button"
                  onClick={toggleResumeMode}
                  className={`mt-2 text-xs font-medium underline underline-offset-2 ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-triagen-secondary hover:text-triagen-primary'}`}
                >
                  Prefere anexar um arquivo? Volte para o upload
                </button>
              </div>
            )}

            {job?.pre_interview_questions && job.pre_interview_questions.length > 0 && (
              <div className="space-y-4 pt-2">
                <h3 className={`font-heading text-lg font-normal ${darkMode ? 'text-white' : 'text-triagen-primary'}`}>
                  Perguntas da vaga
                </h3>
                {job.pre_interview_questions.map((q) => (
                  <Textarea
                    key={q.id}
                    label={`${q.question} *`}
                    darkMode={darkMode}
                    value={formData.pre_interview_answers[String(q.id)] || ''}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      pre_interview_answers: { ...prev.pre_interview_answers, [String(q.id)]: e.target.value }
                    }))}
                    rows={2}
                    placeholder="Sua resposta..."
                  />
                ))}
              </div>
            )}

            {error && (
              <StatusMessage
                type="error"
                message={error}
                darkMode={darkMode}
              />
            )}

            <StatusMessage
              type="info"
              title="Próximo passo: entrevista com IA"
              message="Após o envio, nossa IA analisará seu perfil e criará uma entrevista personalizada. O link chegará por e-mail."
              darkMode={darkMode}
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              isLoading={submitting}
              disabled={!formData.name || !formData.email}
              icon={Send}
              iconPosition="left"
            >
              {submitting ? 'Enviando candidatura...' : 'Enviar candidatura'}
            </Button>
          </form>
        </Card>
      ) : (
        <StatusMessage
          type="warning"
          title="Candidaturas encerradas"
          message="O prazo de candidatura desta vaga já foi encerrado. Fique de olho em novas oportunidades da empresa."
          darkMode={darkMode}
        />
      )}
    </div>
  );
}

export default JobApplicationPage;
