import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, CheckCircle2, ArrowRight } from 'lucide-react';
import useDarkMode from '../hooks/useDarkMode';
import Button from './ui/Button';
import Card from './ui/Card';
import StatusMessage from './ui/StatusMessage';
import PageHeader from './ui/PageHeader';
import { MIC_DENIED_MESSAGE } from '../utils/interviewMessages';

type Step = 'mic' | 'audio';

interface PreInterviewRoomProps {
  onConfirm: () => void;
  onBack: () => void;
}

function PreInterviewRoom({ onConfirm, onBack }: Readonly<PreInterviewRoomProps>) {
  const { darkMode } = useDarkMode();
  const [step, setStep] = useState<Step>('mic');

  // --- Mic step state ---
  const [micLevel, setMicLevel] = useState(0);
  const [micPermission, setMicPermission] = useState<boolean | null>(null);
  const [micPassed, setMicPassed] = useState(false);
  // Some phones capture quietly; never leave the candidate stuck on this step.
  const [allowSkip, setAllowSkip] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const envelopeRef = useRef(0); // manual envelope follower (not state)

  // --- Audio step state ---
  const [isPlayingTest, setIsPlayingTest] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Start mic check on mount
  useEffect(() => {
    let rafId = 0;
    let cancelled = false;

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(async stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        setMicPermission(true);

        const ctx = new AudioContext();
        micCtxRef.current = ctx;
        await ctx.resume(); // ensure not suspended

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.1; // fast response
        const data = new Uint8Array(analyser.fftSize);
        ctx.createMediaStreamSource(stream).connect(analyser);

        let sustainedFrames = 0;

        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);

          // Asymmetric envelope follower: fast attack, fast release
          // smoothingTimeConstant only works for frequency domain — so we do this manually
          const gated = rms < 0.01 ? 0 : rms; // noise gate: silence below threshold
          const alpha = gated > envelopeRef.current ? 0.4 : 0.2;
          envelopeRef.current = alpha * envelopeRef.current + (1 - alpha) * gated;
          const level = Math.min(envelopeRef.current * 400, 100);
          setMicLevel(level);

          if (rms > 0.08) {
            sustainedFrames++;
            if (sustainedFrames >= 15) setMicPassed(true);
          } else {
            sustainedFrames = 0;
          }

          rafId = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => setMicPermission(false));

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      streamRef.current?.getTracks().forEach(t => t.stop());
      micCtxRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setAllowSkip(true), 10_000);
    return () => clearTimeout(t);
  }, []);

  // Clean up audio context on unmount
  useEffect(() => {
    return () => {
      audioCtxRef.current?.close();
    };
  }, []);

  const playTestSound = async () => {
    const ctx = audioCtxRef.current ?? new AudioContext();
    audioCtxRef.current = ctx;
    await ctx.resume(); // ensure not suspended — must be called inside user gesture

    setIsPlayingTest(true);

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, ctx.currentTime);
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 1.5);
    oscillator.onended = () => setIsPlayingTest(false);
  };

  const stepIcon = () => {
    if (step === 'audio') {
      return <Volume2 className={`h-8 w-8 ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`} />;
    }
    if (micPermission === false) {
      return <MicOff className="h-8 w-8 text-red-500" />;
    }
    if (micPassed) {
      return <CheckCircle2 className={`h-8 w-8 ${darkMode ? 'text-emerald-400' : 'text-triagen-secondary-green'}`} />;
    }
    return <Mic className={`h-8 w-8 ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`} />;
  };

  const stepIconBg = () => {
    if (step === 'mic' && micPermission === false) return 'bg-red-500/10';
    if (step === 'mic' && micPassed) return darkMode ? 'bg-triagen-secondary-green/20' : 'bg-triagen-sage-tint';
    return darkMode ? 'bg-gray-800' : 'bg-neutral-100';
  };

  return (
    <div className={`min-h-screen font-sans ${darkMode ? 'bg-gray-900' : 'bg-triagen-neutral'}`}>
      <PageHeader darkMode={darkMode} />

      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] px-4 sm:px-6 py-12">
        <div className="max-w-md w-full">

          {/* Step indicator */}
          <p className={`text-[0.65rem] uppercase tracking-[0.2em] font-bold mb-6 text-center ${darkMode ? 'text-gray-500' : 'text-triagen-secondary'}`}>
            Preparação — etapa {step === 'mic' ? '1' : '2'} de 2
          </p>

          <Card darkMode={darkMode} padding="lg">
            <div className="text-center mb-8">
              <div className={`w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center transition-colors ${stepIconBg()}`}>
                {stepIcon()}
              </div>
              <h1 className={`font-heading font-normal tracking-tight text-3xl mb-2 ${darkMode ? 'text-white' : 'text-triagen-primary'}`}>
                {step === 'mic' ? 'Teste de microfone' : 'Teste de áudio'}
              </h1>
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
                {step === 'mic'
                  ? (micPassed ? 'Microfone funcionando.' : 'Fale algo em voz alta para verificarmos seu microfone.')
                  : 'Toque o som de teste e confirme se consegue ouvir.'}
              </p>
            </div>

            {step === 'mic' && (
              <>
                {micPermission === false ? (
                  <StatusMessage
                    type="error"
                    title="Acesso ao microfone negado"
                    message={MIC_DENIED_MESSAGE}
                    darkMode={darkMode}
                  />
                ) : (
                  <div className="mb-8">
                    <div className={`h-2 rounded-full overflow-hidden ${darkMode ? 'bg-gray-700' : 'bg-neutral-200'}`}>
                      <div
                        className={`h-full rounded-full transition-[width] duration-75 ${micPassed ? 'bg-triagen-secondary-green' : darkMode ? 'bg-gray-400' : 'bg-triagen-secondary'}`}
                        style={{ width: `${micLevel}%` }}
                      />
                    </div>
                    <p className={`text-xs mt-3 text-center ${micPassed ? (darkMode ? 'text-emerald-400' : 'text-triagen-secondary-green') : (darkMode ? 'text-gray-500' : 'text-gray-400')}`}>
                      {micPassed ? 'Sinal detectado' : 'Aguardando sinal de áudio...'}
                    </p>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button variant="outline" size="lg" fullWidth onClick={onBack} darkMode={darkMode}>
                    Voltar
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    onClick={() => setStep('audio')}
                    disabled={!micPassed}
                    icon={ArrowRight}
                  >
                    Próximo
                  </Button>
                </div>
                {!micPassed && allowSkip && micPermission !== false && (
                  <button
                    type="button"
                    onClick={() => setStep('audio')}
                    className={`mt-4 w-full min-h-[44px] text-sm font-medium underline underline-offset-2 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}
                  >
                    O sinal não aparece? Continuar mesmo assim
                  </button>
                )}
              </>
            )}

            {step === 'audio' && (
              <>
                <div className="mb-8 flex justify-center">
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={playTestSound}
                    disabled={isPlayingTest}
                    icon={Volume2}
                    iconPosition="left"
                    darkMode={darkMode}
                  >
                    {isPlayingTest ? 'Reproduzindo...' : 'Tocar som de teste'}
                  </Button>
                </div>

                <p className={`text-sm text-center mb-6 font-medium ${darkMode ? 'text-gray-300' : 'text-triagen-primary'}`}>
                  Você conseguiu ouvir o som?
                </p>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    fullWidth
                    onClick={() => setStep('mic')}
                    darkMode={darkMode}
                  >
                    Não ouvi
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    onClick={onConfirm}
                    icon={ArrowRight}
                  >
                    Sim, iniciar entrevista
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default PreInterviewRoom;
