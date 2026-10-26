import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  Star,
  CheckCircle,
} from 'lucide-react';
import { getStatusColor, getStatusShortText, deriveCandidateStatus } from '../../../utils/candidateStatus';
import useDarkMode from '../../../hooks/useDarkMode';
import { useAuth } from '../../../hooks/useAuth';
import { supabase } from '../../../integrations/supabase/client';
import Button from '../../ui/Button';
import StatusMessage from '../../ui/StatusMessage';
import { toast } from '../../ui/Toast';
import LoadingSpinner from '../../ui/LoadingSpinner';
import { ScoreRing } from '../../ui/Score';
import { Candidate } from '../../../types/company';
import { computeOverallScore, parseRecommendation } from '../../../utils/scoring';
import { getInterviewReport, type DashboardReportData } from '../../../api/reports';
import { ReportSummarySection, ReportCriteriaSection, RecommendationChip, RECOMMENDATION_META } from '../reports/InterviewReportView';

interface Job {
  id: string;
  title: string;
  description: string;
  criteria?: unknown;
  pre_interview_questions?: unknown;
  company: {
    id: string;
    name: string;
  };
}

const REPORT_POLL_INTERVAL_MS = 5_000;
const REPORT_POLL_MAX_MS = 30 * 60_000;

interface CandidateWithJob extends Candidate {
  job: Job;
  score?: number;
  reportId?: string;
}

function CandidateProfilePage() {
  const { candidateId } = useParams();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<CandidateWithJob | null>(null);
  const [report, setReport] = useState<DashboardReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isUpdatingFavorite, setIsUpdatingFavorite] = useState(false);
  const { darkMode } = useDarkMode();
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!candidateId || !userId) return;
    let cancelled = false;

    const fetchCandidate = async () => {
      try {
        const { data: companies, error: companyError } = await supabase
          .from('companies')
          .select('id')
          .eq('user_id', userId);

        if (companyError) throw companyError;
        if (!companies || companies.length === 0) {
          throw new Error('Empresa não encontrada');
        }

        const { data: candidateData, error: candidateError } = await supabase
          .from('candidates')
          .select(`
            *,
            job:jobs(
              id,
              title,
              description,
              criteria,
              pre_interview_questions,
              company:companies(id, name)
            ),
            interview_reports(id, status, criteria_scores, created_at)
          `)
          .eq('id', candidateId)
          .single();

        if (candidateError) throw candidateError;
        if (!candidateData) throw new Error('Candidato não encontrado');

        // Verify that this candidate belongs to a job from the user's company
        if (candidateData.job.company.id !== companies[0].id) {
          throw new Error('Acesso negado');
        }

        // interview_reports.interview_id is unique, so this is a one-to-one embed: an object, not an array.
        const report = candidateData.interview_reports as { id: string; status: string; criteria_scores: unknown } | null;
        const isCompleted = report?.status === 'completed';

        const transformed: CandidateWithJob = {
          ...candidateData,
          phone: candidateData.phone || undefined,
          resume_url: candidateData.resume_url || undefined,
          notes: candidateData.notes || undefined,
          interview_started_at: candidateData.interview_started_at || undefined,
          interview_completed_at: candidateData.interview_completed_at || undefined,
          status: deriveCandidateStatus(report?.status),
          is_favorite: candidateData.is_favorite || false,
          pre_interview_answers: candidateData.pre_interview_answers as Record<string, unknown> | null,
          created_at: candidateData.created_at || new Date().toISOString(),
          updated_at: candidateData.updated_at || new Date().toISOString(),
          job: candidateData.job,
          score: isCompleted ? computeOverallScore(report.criteria_scores, candidateData.job?.criteria) : undefined,
          reportId: isCompleted ? report.id : undefined,
        };

        if (!cancelled) setCandidate(transformed);
      } catch (err) {
        console.error('Error fetching candidate:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar candidato');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchCandidate();
    return () => { cancelled = true; };
  }, [candidateId, userId]);

  // The evaluation is part of the candidate's page, not a separate destination.
  // Until it is final, keep checking: the analysis lands a minute or two after
  // the interview ends, and the page should update on its own.
  useEffect(() => {
    if (!candidateId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const load = () => {
      getInterviewReport({ candidateId })
        .then((data) => {
          if (cancelled) return;
          setReport(data);
          const final = data?.status === 'completed' || data?.status === 'failed';
          if (!final && Date.now() - startedAt < REPORT_POLL_MAX_MS) {
            timer = setTimeout(load, REPORT_POLL_INTERVAL_MS);
          }
        })
        .catch((err) => console.error('Error fetching interview report:', err));
    };
    load();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [candidateId]);

  const toggleFavorite = async () => {
    if (!candidate) return;

    setIsUpdatingFavorite(true);
    try {
      const { error: updateError } = await supabase
        .from('candidates')
        .update({ is_favorite: !candidate.is_favorite })
        .eq('id', candidate.id);

      if (updateError) throw updateError;

      setCandidate(prev => prev ? { ...prev, is_favorite: !prev.is_favorite } : null);
      toast.success(candidate.is_favorite ? 'Removido da pré-seleção' : 'Adicionado à pré-seleção');
    } catch (err) {
      console.error('Error updating favorite:', err);
      toast.error('Não foi possível atualizar a pré-seleção', {
        description: 'Verifique sua conexão e tente novamente.',
      });
    } finally {
      setIsUpdatingFavorite(false);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error || !candidate) {
    return (
      <div className="max-w-6xl mx-auto py-12">
        <Button onClick={() => navigate('/dashboard/candidates')} variant="outline" size="sm" icon={ArrowLeft} iconPosition="left" darkMode={darkMode}>
          Voltar para candidatos
        </Button>
        <div className="mt-8">
          <StatusMessage type="error" title="Candidato não encontrado" message={error || 'O candidato solicitado não foi encontrado'} darkMode={darkMode} />
        </div>
      </div>
    );
  }

  const StarButton = (
    <Button
      variant={candidate.is_favorite ? 'primary' : 'secondary'}
      size="sm"
      onClick={toggleFavorite}
      isLoading={isUpdatingFavorite}
      icon={Star}
      iconPosition="left"
      darkMode={darkMode}
      title={candidate.is_favorite ? 'Remover da pré-seleção' : 'Adicionar à pré-seleção'}
    >
      {candidate.is_favorite ? 'Pré-selecionado' : 'Pré-selecionar'}
    </Button>
  );

  const detailItem = (icon: React.ReactNode, label: string, value: string) => (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{icon}</span>
      <div className="flex flex-col min-w-0">
        <span className={`text-[0.65rem] uppercase tracking-wider font-semibold mb-0.5 ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>{label}</span>
        <span className={`text-sm font-medium break-words ${darkMode ? 'text-gray-200' : 'text-triagen-primary'}`}>{value}</span>
      </div>
    </div>
  );

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });

  const hasEvaluation = Boolean(report && (report.criteriaScores.length > 0 || report.summary));
  const isAnalyzing = Boolean(report && !hasEvaluation && report.status !== 'failed');
  const analysisFailed = report?.status === 'failed';
  // The report can arrive after the page loaded (polling); prefer its values.
  const score = candidate.score ?? (report?.status === 'completed' ? report.overallScore : undefined);
  const status = report ? deriveCandidateStatus(report.status) : candidate.status;
  const recommendation = report ? parseRecommendation(report.summary).recommendation : null;

  // The application form stores the free-text resume summary in resume_url
  const resumeText = candidate.resume_url && !/^https?:\/\//i.test(candidate.resume_url)
    ? candidate.resume_url
    : null;

  // Screening answers are keyed by question id — join with the job's questions
  const jobQuestions = Array.isArray(candidate.job.pre_interview_questions)
    ? candidate.job.pre_interview_questions as Array<{ id: number; question: string }>
    : [];
  const questionById = new Map(jobQuestions.map(q => [String(q.id), q.question]));
  const screeningAnswers = Object.entries(candidate.pre_interview_answers || {})
    .map(([id, answer]) => ({
      question: questionById.get(id) || `Pergunta ${id}`,
      answer: typeof answer === 'string' ? answer : JSON.stringify(answer),
    }))
    .filter(entry => entry.answer.trim() !== '');

  return (
    <div className="flex flex-col max-w-6xl mx-auto pb-16">

      {/* Breadcrumb / Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-6 mb-12">
        <button
          onClick={() => navigate('/dashboard/candidates')}
          className={`flex items-center gap-2 text-xs uppercase tracking-widest font-semibold hover:opacity-70 transition-opacity ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}
        >
          <ArrowLeft className="w-4 h-4" /> Candidatos
        </button>
        <div className="flex items-center justify-end gap-3">
          {StarButton}
        </div>
      </div>

      {/* Profile Header */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-12 items-end rise-in">
        <div className="md:col-span-8 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <span className={`px-3 py-1 rounded-full text-[0.65rem] font-bold tracking-widest uppercase ${getStatusColor(status)}`}>
              {getStatusShortText(status)}
            </span>
            <span className={`text-[0.65rem] uppercase tracking-widest font-semibold ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
              {candidate.job.title}
            </span>
          </div>
          <h1 className={`text-5xl md:text-6xl font-heading font-normal tracking-tight leading-none break-words ${darkMode ? 'text-white' : 'text-triagen-primary'}`}>
            {candidate.name}
          </h1>
          {recommendation && (
            <div className="mt-1">
              <RecommendationChip recommendation={recommendation} darkMode={darkMode} />
            </div>
          )}
        </div>
        <div className="md:col-span-4 flex md:justify-end">
          <div
            className={`flex items-center gap-5 w-full md:w-auto p-6 border rounded-lg ${recommendation ? `border-t-4 ${RECOMMENDATION_META[recommendation].accent(darkMode).wash}` : ''} ${darkMode ? 'border-gray-800 bg-gray-900/50' : 'border-triagen-border-light bg-white'}`}
            style={recommendation ? { borderTopColor: RECOMMENDATION_META[recommendation].accent(darkMode).borderTopColor } : undefined}
          >
            {score !== undefined ? (
              <>
                <ScoreRing score={score} size="md" darkMode={darkMode} />
                <div className="flex flex-col">
                  <span className={`text-[0.65rem] tracking-widest uppercase font-semibold ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>Compatibilidade</span>
                  <span className={`text-sm mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`}>com a vaga, de 0 a 100</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col">
                <span className={`text-[0.65rem] tracking-widest uppercase font-semibold ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>Compatibilidade</span>
                <span className={`text-sm mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{isAnalyzing ? 'Analisando entrevista…' : 'Aguardando entrevista'}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary row: sidebar (contact + role) stays narrow beside the executive
          summary, since both are naturally short. Criteria and application
          material break out to the full page width below — a persistent
          sidebar the height of the whole page left everything else cramped. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 mb-12">
        {/* Left Sidebar: Contact & Metadata */}
        <div className="lg:col-span-4 flex flex-col gap-8">
          <div className={`p-6 rounded border ${darkMode ? 'border-gray-800 bg-gray-900/50' : 'border-triagen-border-light bg-white'}`}>
            <h2 className={`text-xs uppercase tracking-widest font-bold mb-6 ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>Dados do candidato</h2>
            <div className="flex flex-col gap-5">
              {detailItem(<Mail className="w-4 h-4" />, 'E-mail', candidate.email)}
              {candidate.phone && detailItem(<Phone className="w-4 h-4" />, 'Telefone', candidate.phone)}
              {detailItem(<Calendar className="w-4 h-4" />, 'Candidatura em', formatDate(candidate.created_at))}
              {candidate.interview_completed_at &&
                detailItem(<CheckCircle className="w-4 h-4" />, 'Entrevista concluída em', formatDate(candidate.interview_completed_at))}
            </div>
          </div>

          {/* Role context */}
          <div className={`p-6 rounded border ${darkMode ? 'border-gray-800 bg-gray-900/50' : 'border-triagen-border-light bg-white'}`}>
            <h2 className={`text-xs uppercase tracking-widest font-bold mb-4 ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>Vaga</h2>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col">
                <span className={`text-[0.65rem] uppercase tracking-wider font-semibold mb-1 ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>Posição</span>
                <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-triagen-primary'}`}>{candidate.job.title}</span>
              </div>
              <div className="flex flex-col">
                <span className={`text-[0.65rem] uppercase tracking-wider font-semibold mb-1 ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>Empresa</span>
                <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-triagen-primary'}`}>{candidate.job.company.name}</span>
              </div>
            </div>
            <div className={`mt-6 pt-6 border-t border-dashed ${darkMode ? 'border-gray-700' : 'border-neutral-300'}`}>
              <Button
                variant="secondary"
                size="sm"
                fullWidth
                onClick={() => navigate(`/dashboard/jobs/${candidate.job_id}`)}
                darkMode={darkMode}
              >
                Ver detalhes da vaga
              </Button>
            </div>
          </div>
        </div>

        {/* Right: the verdict narrative — criteria detail lives below, full width */}
        <div className="lg:col-span-8 flex flex-col gap-10">
          {hasEvaluation && report && (
            <ReportSummarySection report={report} darkMode={darkMode} />
          )}

          {!hasEvaluation && (
            <div className={`py-14 px-6 text-center border border-dashed rounded ${darkMode ? 'border-gray-800' : 'border-neutral-300'}`}>
              {isAnalyzing && (
                <div className={`w-8 h-8 mx-auto mb-4 rounded-full border-2 border-t-transparent animate-spin ${darkMode ? 'border-gray-500' : 'border-triagen-primary'}`} />
              )}
              <p className={`font-heading text-xl mb-1 ${darkMode ? 'text-gray-200' : 'text-triagen-primary'}`}>
                {isAnalyzing ? 'Analisando a entrevista…' : analysisFailed ? 'Não foi possível gerar a avaliação' : 'Avaliação ainda não disponível'}
              </p>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
                {isAnalyzing
                  ? 'A IA está avaliando a conversa critério por critério. Esta página atualiza sozinha em instantes.'
                  : analysisFailed
                    ? 'A análise desta entrevista falhou. A transcrição está salva e a análise pode ser refeita.'
                    : 'Assim que a entrevista for concluída, a análise por critério e as evidências da conversa aparecem aqui.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Full width: criteria need the room, and application material reads
          fine at this width too. */}
      <div className="flex flex-col gap-10">
        {hasEvaluation && report && (
          <ReportCriteriaSection report={report} darkMode={darkMode} />
        )}

        {(resumeText || screeningAnswers.length > 0 || candidate.notes) && (
          <h2 className={`font-heading text-2xl pb-4 border-b mt-2 ${darkMode ? 'text-white border-gray-800' : 'text-triagen-primary border-triagen-border-light'}`}>
            Material da candidatura
          </h2>
        )}

        {resumeText && (
          <section className="flex flex-col gap-4">
            <h3 className={`font-heading text-lg ${darkMode ? 'text-gray-100' : 'text-triagen-primary'}`}>
              Resumo do currículo
            </h3>
            <p className={`whitespace-pre-line leading-relaxed text-sm md:text-base max-w-3xl text-justify ${darkMode ? 'text-gray-300' : 'text-triagen-secondary'}`}>
              {resumeText}
            </p>
          </section>
        )}

        {screeningAnswers.length > 0 && (
          <section className="flex flex-col gap-4">
            <h3 className={`font-heading text-lg ${darkMode ? 'text-gray-100' : 'text-triagen-primary'}`}>
              Perguntas de triagem
            </h3>
            <div className="flex flex-col gap-6">
              {screeningAnswers.map(({ question, answer }) => (
                <div key={question} className="flex flex-col gap-2 max-w-3xl">
                  <h3 className={`text-sm font-bold tracking-tight ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`}>{question}</h3>
                  <p className={`text-sm md:text-base leading-relaxed text-justify ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
                    {answer}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {candidate.notes && (
          <section className="flex flex-col gap-4">
            <h3 className={`font-heading text-lg ${darkMode ? 'text-gray-100' : 'text-triagen-primary'}`}>
              Anotações internas
            </h3>
            <div className={`p-6 rounded border max-w-3xl ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-neutral-50 border-triagen-border-light'}`}>
              <p className={`text-sm md:text-base leading-relaxed whitespace-pre-line text-justify ${darkMode ? 'text-gray-300' : 'text-triagen-secondary'}`}>
                {candidate.notes}
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default CandidateProfilePage;
