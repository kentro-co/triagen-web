import { useState, useEffect, useRef } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  LocalAudioTrack,
  RemoteAudioTrack,
  ParticipantKind,
  DisconnectReason,
  type Participant,
} from 'livekit-client';
import { Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import useDarkMode from '../hooks/useDarkMode';
import { config } from '../utils/config';
import StatusMessage from './ui/StatusMessage';
import Button from './ui/Button';
import { MIC_DENIED_MESSAGE } from '../utils/interviewMessages';
import VoiceBars from './ui/VoiceBars';
import RemoteAudioTrackComponent from './RemoteAudioTrack';

interface InterviewRoomProps {
  jwtToken: string;
  onFinished: () => void;
}

// LiveKit Agents publishes its speech (and the candidate's STT) on this text
// stream topic, and its lifecycle state as a participant attribute.
const TRANSCRIPTION_TOPIC = 'lk.transcription';
const AGENT_STATE_ATTRIBUTE = 'lk.agent.state';
const AGENT_JOIN_TIMEOUT_MS = 30_000;

type AgentState = 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking';

function agentStateLabel(state: AgentState | null): string {
  switch (state) {
    case 'listening':
    case 'idle':
      return 'Ouvindo você…';
    case 'thinking':
      return 'Pensando…';
    case 'speaking':
      return 'Falando…';
    default:
      return 'Preparando a entrevista…';
  }
}

function InterviewRoom({ jwtToken, onFinished }: Readonly<InterviewRoomProps>) {
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [localAudioTrack, setLocalAudioTrack] = useState<LocalAudioTrack | null>(null);
  const [remoteAudioTracks, setRemoteAudioTracks] = useState<RemoteAudioTrack[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  // The agent's current (or last complete) utterance; kept until it speaks again.
  const [agentCaption, setAgentCaption] = useState('');
  const [candidateCaption, setCandidateCaption] = useState('');

  const { darkMode } = useDarkMode();
  const [agentJoined, setAgentJoined] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  // Long answers scroll inside the caption box; keep the newest words in view.
  useEffect(() => {
    const el = captionRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agentCaption]);

  // Timer
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs > 0 ? `${hrs.toString().padStart(2, '0')}:` : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    let cancelled = false;
    const roomInstance = new Room();
    roomRef.current = roomInstance;

    // Ends the session from our side on a failure, without showing the
    // "interview finished" page.
    const fail = (message: string) => {
      if (cancelled) return;
      setError(message);
      roomInstance.removeAllListeners();
      roomInstance.disconnect();
    };

    roomInstance.on(RoomEvent.Connected, () => setIsConnected(true));
    roomInstance.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      setIsConnected(false);
      setLocalAudioTrack(null);
      roomRef.current = null;
      // The agent ends the call by deleting the room; the candidate ends it with
      // "Encerrar". Anything else is a lost connection, not a finished interview.
      if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.CLIENT_INITIATED) {
        onFinished();
      } else {
        setConnectionLost(true);
      }
    });
    roomInstance.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      setAudioBlocked(!roomInstance.canPlaybackAudio);
    });
    roomInstance.on(RoomEvent.TrackSubscribed, (track: Track) => {
      if (track.kind === Track.Kind.Audio) {
        setRemoteAudioTracks(prev => [...prev.filter(t => t.sid !== track.sid), track as RemoteAudioTrack]);
      }
    });
    roomInstance.on(RoomEvent.TrackUnsubscribed, (track: Track) => {
      if (track.kind === Track.Kind.Audio) {
        setRemoteAudioTracks(prev => prev.filter(t => t.sid !== track.sid));
      }
    });

    const readAgentState = (participant: Participant) => {
      if (participant.kind !== ParticipantKind.AGENT) return;
      setAgentJoined(true);
      const state = participant.attributes[AGENT_STATE_ATTRIBUTE];
      if (state) setAgentState(state as AgentState);
    };
    roomInstance.on(RoomEvent.ParticipantConnected, readAgentState);
    roomInstance.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => readAgentState(participant));

    // Registered before connect so the agent's opening line isn't missed.
    roomInstance.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader, participantInfo) => {
      const fromCandidate = participantInfo.identity === roomInstance.localParticipant.identity;
      try {
        if (fromCandidate) {
          // STT sends interim then final versions of each segment; show finals only.
          const text = await reader.readAll();
          if (reader.info.attributes?.['lk.transcription_final'] === 'true' && text.trim()) {
            setCandidateCaption(text.trim());
          }
          return;
        }
        // The agent's speech arrives as one stream per utterance, written word
        // by word in sync with the audio.
        let text = '';
        setAgentCaption('');
        for await (const chunk of reader) {
          text += chunk;
          setAgentCaption(text);
        }
      } catch {
        // A stream can be cut off mid-read (interruption, reconnect); keep what arrived.
      }
    });

    const connectToRoom = async () => {
      try {
        await roomInstance.connect(config.livekitUrl, jwtToken, { autoSubscribe: true });
      } catch {
        fail('Não foi possível conectar à entrevista. Verifique sua internet e tente novamente.');
        return;
      }
      if (cancelled) return;
      roomInstance.remoteParticipants.forEach(readAgentState);
      setAudioBlocked(!roomInstance.canPlaybackAudio);

      try {
        await roomInstance.localParticipant.setMicrophoneEnabled(true);
      } catch (err) {
        const denied = err instanceof Error && err.name === 'NotAllowedError';
        fail(denied ? MIC_DENIED_MESSAGE : 'Não conseguimos usar o seu microfone. Feche outros apps que possam estar usando o microfone e tente novamente.');
        return;
      }

      const audioTrackPubs = Array.from(roomInstance.localParticipant.audioTrackPublications.values());
      if (audioTrackPubs.length > 0 && audioTrackPubs[0].track) {
        setLocalAudioTrack(audioTrackPubs[0].track as LocalAudioTrack);
      }
      setRoom(roomInstance);
    };

    connectToRoom();

    // If the interviewer never joins (worker down, no capacity), say so instead
    // of leaving the candidate talking to an empty room.
    const agentTimeout = setTimeout(() => {
      if (!Array.from(roomInstance.remoteParticipants.values()).some(p => p.kind === ParticipantKind.AGENT)) {
        fail('A entrevistadora não conseguiu entrar na sala. Aguarde alguns minutos e abra o link novamente.');
      }
    }, AGENT_JOIN_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(agentTimeout);
      roomInstance.unregisterTextStreamHandler(TRANSCRIPTION_TOPIC);
      roomInstance.removeAllListeners();
      roomInstance.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jwtToken]);

  // Keep the phone screen on during the interview, where supported.
  useEffect(() => {
    if (!isConnected || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      navigator.wakeLock.request('screen').then(l => { lock = l; }).catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [isConnected]);

  // Leaving the page ends the interview for good, so ask first (desktop browsers).
  useEffect(() => {
    if (!isConnected) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isConnected]);

  const toggleMute = () => {
    if (room?.localParticipant) {
      const newMutedState = !isMuted;
      room.localParticipant.setMicrophoneEnabled(!newMutedState);
      setIsMuted(newMutedState);
    }
  };

  const disconnect = () => {
    room?.disconnect();
  };

  const startAudio = () => {
    roomRef.current?.startAudio().then(() => setAudioBlocked(false)).catch(() => {});
  };

  const muted = darkMode ? 'text-gray-400' : 'text-triagen-secondary';
  const shell = `min-h-[100dvh] flex flex-col font-sans ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-triagen-neutral text-triagen-primary'}`;

  if (error || connectionLost) {
    return (
      <div className={`${shell} items-center justify-center px-4 py-10`}>
        <div className="w-full max-w-md flex flex-col gap-6">
          <StatusMessage
            type="error"
            title={connectionLost ? 'A conexão caiu' : 'Não foi possível continuar'}
            message={connectionLost ? 'Sua entrevista foi interrompida por uma falha de conexão. Toque abaixo para voltar.' : error}
            darkMode={darkMode}
          />
          <Button variant="primary" size="lg" fullWidth onClick={() => window.location.reload()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className={`${shell} items-center justify-center`}>
        <div className={`w-12 h-12 rounded-full border-2 border-t-transparent animate-spin mb-4 ${darkMode ? 'border-gray-500' : 'border-triagen-primary'}`} />
        <p className={`text-sm uppercase tracking-widest ${muted}`}>Conectando à entrevista...</p>
      </div>
    );
  }

  const dockButton = 'flex flex-col items-center justify-center flex-1 min-h-[4.5rem] rounded-xl transition-colors';

  return (
    <div className={shell}>

      {/* Remote Tracks Container (Hidden) */}
      <div className="hidden">
        {remoteAudioTracks.map((track, idx) => (
          <RemoteAudioTrackComponent key={track.sid || idx} track={track} />
        ))}
      </div>

      {/* Header */}
      <header className="w-full px-4 sm:px-6 md:px-12 pt-[max(1rem,env(safe-area-inset-top))] pb-4 flex justify-between items-center">
        <h1 className="text-xl font-heading font-semibold tracking-tight">TriaGen</h1>
        <div className={`flex items-center gap-2 text-sm font-medium tabular-nums ${muted}`}>
          <div className="w-2 h-2 rounded-full bg-triagen-secondary-green animate-pulse" />
          {formatTime(elapsedTime)}
        </div>
      </header>

      {/* Main Stage */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-4 max-w-4xl mx-auto w-full text-center">

        {/* Browsers block audio until the user taps; without this the
            candidate would never hear the interviewer on iOS. */}
        {audioBlocked && (
          <button
            onClick={startAudio}
            className="mb-6 w-full max-w-sm min-h-[3.5rem] px-5 rounded-xl bg-triagen-primary text-white dark:bg-white dark:text-triagen-primary font-semibold flex items-center justify-center gap-2 animate-pulse"
          >
            <Volume2 className="w-5 h-5" /> Toque para ouvir a entrevistadora
          </button>
        )}

        {/* Agent state — what the interviewer is doing right now */}
        <p
          className={`flex items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] font-semibold mb-6 ${muted}`}
          aria-live="polite"
        >
          <span className={`w-2 h-2 rounded-full ${agentState === 'speaking' ? 'bg-triagen-secondary-green animate-pulse' : darkMode ? 'bg-gray-500' : 'bg-triagen-secondary'}`} />
          {agentJoined ? agentStateLabel(agentState) : 'Chamando a entrevistadora…'}
        </p>

        {/* Caption of the interviewer's speech */}
        <div
          ref={captionRef}
          className="w-full max-w-2xl max-h-[42dvh] overflow-y-auto mb-6"
        >
          <p className={`text-2xl md:text-3xl font-heading font-normal leading-snug ${agentCaption ? (darkMode ? 'text-white' : 'text-triagen-primary') : muted}`}>
            {agentCaption || 'A entrevistadora vai começar em instantes.'}
          </p>
        </div>

        {candidateCaption && (
          <p className={`w-full max-w-md text-sm leading-relaxed line-clamp-2 mb-6 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <span className="font-semibold">Você: </span>{candidateCaption}
          </p>
        )}

        {/* Live voice meter — reflects the candidate's own microphone */}
        <VoiceBars
          track={localAudioTrack}
          muted={isMuted}
          darkMode={darkMode}
        />
        {isMuted && (
          <p className="flex items-center text-xs tracking-wider uppercase text-red-500 mt-2">
            <MicOff className="w-3 h-3 mr-2" /> Microfone silenciado
          </p>
        )}
      </main>

      {/* Bottom dock — in the flow (not absolute) so it never hides behind the
          mobile browser bar, and padded for the home indicator. */}
      <div className="w-full flex justify-center px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className={`w-full max-w-sm flex items-stretch gap-2 p-2 rounded-2xl shadow-sm border ${darkMode ? 'bg-gray-800/90 border-gray-700' : 'bg-white/90 border-neutral-200'}`}>
          {confirmingEnd ? (
            <>
              <button
                onClick={() => setConfirmingEnd(false)}
                className={`${dockButton} ${darkMode ? 'hover:bg-gray-700' : 'bg-neutral-100/50 hover:bg-neutral-100'}`}
              >
                <span className="text-xs uppercase tracking-widest font-semibold">Continuar</span>
              </button>
              <button
                onClick={disconnect}
                className={`${dockButton} bg-red-600 text-white hover:bg-red-700`}
              >
                <PhoneOff strokeWidth={1.5} className="w-6 h-6 mb-1" />
                <span className="text-xs uppercase tracking-widest font-semibold">Sim, encerrar</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={toggleMute}
                aria-pressed={isMuted}
                className={`${dockButton} ${isMuted ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' : darkMode ? 'hover:bg-gray-700' : 'bg-neutral-100/50 hover:bg-neutral-100'}`}
              >
                {isMuted ? <MicOff strokeWidth={1.5} className="w-6 h-6 mb-1" /> : <Mic strokeWidth={1.5} className="w-6 h-6 mb-1" />}
                <span className="text-xs uppercase tracking-widest font-semibold">{isMuted ? 'Reativar' : 'Silenciar'}</span>
              </button>
              <button
                onClick={() => setConfirmingEnd(true)}
                className={`${dockButton} text-red-600 ${darkMode ? 'hover:bg-red-500/10' : 'bg-red-50 hover:bg-red-100'}`}
              >
                <PhoneOff strokeWidth={1.5} className="w-6 h-6 mb-1" />
                <span className="text-xs uppercase tracking-widest font-semibold">Encerrar</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default InterviewRoom;
