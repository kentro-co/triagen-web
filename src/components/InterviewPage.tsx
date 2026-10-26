import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import InterviewRoom from './InterviewRoom';
import InterviewFinishedPage from './InterviewFinishedPage';
import PreInterviewRoom from './PreInterviewRoom';
import useDarkMode from '../hooks/useDarkMode';
import Button from './ui/Button';
import Card from './ui/Card';
import StatusMessage from './ui/StatusMessage';
import PageHeader from './ui/PageHeader';
import { Input } from './ui/Field';
import { startInterviewSession } from '../api/interview';
import { ApiError } from '../api/client';

/** The API's raw messages are English and technical; candidates see these. */
function startErrorMessage(err: unknown): string {
  if (err instanceof ApiError && /already completed/i.test(err.message)) {
    return 'Esta entrevista já foi concluída. Obrigado pela participação!';
  }
  if (err instanceof ApiError && err.status < 500) {
    return 'Código de entrevista inválido. Confira o código recebido por e-mail.';
  }
  return 'Não foi possível iniciar a entrevista agora. Verifique sua internet e tente novamente em instantes.';
}

/**
 * Mobile browsers only play audio after a tap. Resuming a silent AudioContext
 * inside the "start" tap unlocks playback for the interviewer's voice later;
 * the room still shows a "tap to listen" button if this isn't enough.
 */
function unlockAudio() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
    ctx.resume().finally(() => setTimeout(() => ctx.close(), 1000));
  } catch {
    // Best effort only.
  }
}

const TIPS = [
  'Escolha um ambiente silencioso e sem interrupções.',
  'Use fones de ouvido, se possível.',
  'Fale com naturalidade — é uma conversa, não uma prova.',
];

function InterviewPage() {
  const { token: urlToken } = useParams();
  const [token, setToken] = useState(urlToken || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isPrechecking, setIsPrechecking] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [jwtToken, setJwtToken] = useState('');
  const { darkMode } = useDarkMode();

  // A link from the e-mail goes through the mic/audio check first: starting the
  // room without a tap leaves the interviewer silent on iOS, and the check
  // asks for mic permission before the interview clock starts.
  useEffect(() => {
    if (urlToken) {
      setToken(urlToken);
      setIsPrechecking(true);
    }
  }, [urlToken]);

  const handleAuthentication = async (interviewId: string) => {
    if (!interviewId.trim()) {
      setError('Insira o código da entrevista para continuar.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const session = await startInterviewSession(interviewId);
      setJwtToken(session.token);
      setIsAuthenticated(true);
    } catch (err) {
      setError(startErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsPrechecking(true);
  };

  if (isPrechecking && !isAuthenticated && !isFinished) {
    return (
      <PreInterviewRoom
        onConfirm={() => { unlockAudio(); setIsPrechecking(false); handleAuthentication(token); }}
        onBack={() => setIsPrechecking(false)}
      />
    );
  }

  if (isFinished) {
    return <InterviewFinishedPage />;
  }

  // Generating the interview plan can take a few seconds on the first start.
  if (isLoading) {
    return (
      <div className={`min-h-[100dvh] flex flex-col items-center justify-center px-6 text-center font-sans ${darkMode ? 'bg-gray-900' : 'bg-triagen-neutral'}`}>
        <div className={`w-12 h-12 rounded-full border-2 border-t-transparent animate-spin mb-4 ${darkMode ? 'border-gray-500' : 'border-triagen-primary'}`} />
        <p className={`text-sm uppercase tracking-widest ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>Preparando sua entrevista...</p>
        <p className={`text-sm mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Isso pode levar alguns segundos.</p>
      </div>
    );
  }

  // The worker saves the transcript when the session closes; the old
  // /interview/analyze call here hit an endpoint that doesn't exist.
  const handleInterviewFinished = () => setIsFinished(true);

  if (isAuthenticated) {
    return (
      <InterviewRoom
        jwtToken={jwtToken}
        onFinished={handleInterviewFinished}
      />
    );
  }

  return (
    <div className={`min-h-screen font-sans ${darkMode ? 'bg-gray-900' : 'bg-triagen-neutral'}`}>
      <PageHeader darkMode={darkMode} />

      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] px-4 sm:px-6 py-12">
        <div className="max-w-md w-full rise-in">
          <div className="mb-8">
            <p className={`text-[0.65rem] uppercase tracking-[0.2em] font-bold mb-4 ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>
              Área do candidato
            </p>
            <h1 className={`font-heading font-normal tracking-tight text-4xl mb-3 ${darkMode ? 'text-white' : 'text-triagen-primary'}`}>
              Sua entrevista com a IA
            </h1>
            <p className={`text-base leading-relaxed ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
              Insira o código que você recebeu por e-mail para iniciar a conversa.
            </p>
          </div>

          <Card darkMode={darkMode} padding="lg">
            <form onSubmit={handleSubmit} className="space-y-5">
              <Input
                label="Código da entrevista"
                id="token"
                darkMode={darkMode}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Cole aqui o código recebido"
                disabled={isLoading}
                autoComplete="off"
              />

              {error && (
                <StatusMessage type="error" message={error} darkMode={darkMode} />
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
                disabled={!token.trim()}
                icon={ArrowRight}
              >
                {isLoading ? 'Validando código...' : 'Continuar'}
              </Button>
            </form>

            <div className={`mt-8 pt-6 border-t ${darkMode ? 'border-gray-700' : 'border-triagen-border-light'}`}>
              <p className={`text-[0.65rem] uppercase tracking-widest font-bold mb-3 ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>
                Antes de começar
              </p>
              <ul className="flex flex-col gap-2">
                {TIPS.map((tip) => (
                  <li key={tip} className="flex items-start gap-2.5">
                    <span className={`mt-[0.5rem] w-1 h-1 rounded-full shrink-0 ${darkMode ? 'bg-gray-500' : 'bg-triagen-secondary'}`} />
                    <span className={`text-sm leading-relaxed ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
                      {tip}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default InterviewPage;
